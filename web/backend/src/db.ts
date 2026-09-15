// ---------------------------------------------------------------------------
//  SQLite database -- schema, session store, JSON migration
// ---------------------------------------------------------------------------

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { Store, SessionData } from 'express-session';
import { LIBRARY_DIR } from './config';
import logger from './logger';

const DB_PATH = path.join(LIBRARY_DIR, 'qbit.db');

// Ensure data directory exists
fs.mkdirSync(LIBRARY_DIR, { recursive: true });

const db = new Database(DB_PATH);

// WAL mode for better concurrent read/write performance
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

// ---------------------------------------------------------------------------
//  Schema creation
// ---------------------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    sid  TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expired INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_expired ON sessions(expired);

  CREATE TABLE IF NOT EXISTS bans (
    type  TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (type, value)
  );
  CREATE INDEX IF NOT EXISTS idx_bans_type ON bans(type);

  CREATE TABLE IF NOT EXISTS users (
    userId      TEXT PRIMARY KEY,
    displayName TEXT,
    email       TEXT,
    avatar      TEXT,
    firstSeen   TEXT,
    lastSeen    TEXT
  );

  CREATE TABLE IF NOT EXISTS claims (
    deviceId   TEXT PRIMARY KEY,
    userId     TEXT,
    userName   TEXT,
    userAvatar TEXT,
    claimedAt  TEXT
  );

  CREATE TABLE IF NOT EXISTS library (
    id            TEXT PRIMARY KEY,
    filename      TEXT,
    uploader      TEXT,
    uploaderId    TEXT,
    uploadedAt    TEXT,
    size          INTEGER,
    frameCount    INTEGER,
    downloadCount INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS library_stars (
    userId    TEXT NOT NULL,
    libraryId TEXT NOT NULL,
    PRIMARY KEY (userId, libraryId),
    FOREIGN KEY (libraryId) REFERENCES library(id)
  );
  CREATE INDEX IF NOT EXISTS idx_library_stars_libraryId ON library_stars(libraryId);

  CREATE TABLE IF NOT EXISTS device_records (
    deviceId   TEXT PRIMARY KEY,
    name       TEXT,
    ip         TEXT,
    publicIp   TEXT,
    version    TEXT,
    lastSeen   TEXT,
    status     TEXT
  );
`);

// Migration: add downloadCount to library if missing (existing DBs)
try {
  db.exec('ALTER TABLE library ADD COLUMN downloadCount INTEGER DEFAULT 0');
} catch {
  // Column already exists
}

// Migration: add contentHash for duplicate detection (same content = same file, any user).
// Index on contentHash is maintained only in library.service.ts (single UNIQUE index).
try {
  db.exec('ALTER TABLE library ADD COLUMN contentHash TEXT');
} catch {
  // Column already exists
}

// Reports (user-reported accounts for admin review)
db.exec(`
  CREATE TABLE IF NOT EXISTS reports (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    reporterUserId TEXT NOT NULL,
    reporterName   TEXT,
    reportedUserId TEXT NOT NULL,
    reportedUserName TEXT,
    description  TEXT NOT NULL,
    createdAt   TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_reports_createdAt ON reports(createdAt);
`);

// Friends (symmetric: store both (a,b) and (b,a) for easy lookup)
db.exec(`
  CREATE TABLE IF NOT EXISTS friends (
    userId   TEXT NOT NULL,
    friendId TEXT NOT NULL,
    PRIMARY KEY (userId, friendId)
  );
  CREATE INDEX IF NOT EXISTS idx_friends_userId ON friends(userId);
`);

// User settings (e.g. only friends can poke my QBIT, public friend list on graph)
db.exec(`
  CREATE TABLE IF NOT EXISTS user_settings (
    userId TEXT PRIMARY KEY,
    onlyFriendsCanPoke INTEGER NOT NULL DEFAULT 0,
    publicFriends INTEGER NOT NULL DEFAULT 1
  );
`);
try {
  db.exec('ALTER TABLE user_settings ADD COLUMN publicFriends INTEGER NOT NULL DEFAULT 1');
} catch {
  // Column already exists (e.g. after first run)
}
try {
  db.exec('ALTER TABLE user_settings ADD COLUMN isGlobal INTEGER NOT NULL DEFAULT 0');
} catch {
  // Column already exists
}

// Device claim visibility on global network
try {
  db.exec('ALTER TABLE claims ADD COLUMN showInGlobal INTEGER NOT NULL DEFAULT 0');
} catch {
  // Column already exists
}

// Opaque public user id (cannot reverse to Google userId); used in device list, friends API, poke target
db.exec(`
  CREATE TABLE IF NOT EXISTS user_public_ids (
    userId TEXT PRIMARY KEY,
    publicId TEXT NOT NULL UNIQUE
  );
  CREATE INDEX IF NOT EXISTS idx_user_public_ids_publicId ON user_public_ids(publicId);
`);

// Social groups (public / private with invite code)
db.exec(`
  CREATE TABLE IF NOT EXISTS groups (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    visibility  TEXT NOT NULL CHECK (visibility IN ('public', 'private')),
    inviteCode  TEXT UNIQUE,
    ownerUserId TEXT NOT NULL,
    createdAt   TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_groups_visibility ON groups(visibility);
  CREATE INDEX IF NOT EXISTS idx_groups_inviteCode ON groups(inviteCode);

  CREATE TABLE IF NOT EXISTS group_members (
    groupId   TEXT NOT NULL,
    userId    TEXT NOT NULL,
    role      TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
    status    TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
    createdAt TEXT NOT NULL,
    PRIMARY KEY (groupId, userId),
    FOREIGN KEY (groupId) REFERENCES groups(id)
  );
  CREATE INDEX IF NOT EXISTS idx_group_members_userId ON group_members(userId);
  CREATE INDEX IF NOT EXISTS idx_group_members_status ON group_members(groupId, status);
`);

// Permission to set animation on owner's device(s)
db.exec(`
  CREATE TABLE IF NOT EXISTS animation_grants (
    id          TEXT PRIMARY KEY,
    ownerUserId TEXT NOT NULL,
    deviceId    TEXT,
    granteeType TEXT NOT NULL CHECK (granteeType IN ('user', 'group')),
    granteeId   TEXT NOT NULL,
    createdAt   TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_animation_grants_owner ON animation_grants(ownerUserId);
  CREATE INDEX IF NOT EXISTS idx_animation_grants_grantee ON animation_grants(granteeType, granteeId);
`);

// Messenger bot account links (telegram now; bale later)
db.exec(`
  CREATE TABLE IF NOT EXISTS bot_links (
    userId             TEXT NOT NULL,
    platform           TEXT NOT NULL CHECK (platform IN ('telegram', 'bale')),
    platformChatId     TEXT,
    platformUsername   TEXT,
    linkedAt           TEXT,
    verifyCode         TEXT,
    verifyExpiresAt    TEXT,
    PRIMARY KEY (userId, platform)
  );
  CREATE INDEX IF NOT EXISTS idx_bot_links_verify ON bot_links(platform, verifyCode);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_bot_links_chat ON bot_links(platform, platformChatId)
    WHERE platformChatId IS NOT NULL;
`);

// Local username/password accounts (self-registration)
db.exec(`
  CREATE TABLE IF NOT EXISTS local_accounts (
    username     TEXT PRIMARY KEY COLLATE NOCASE,
    userId       TEXT NOT NULL UNIQUE,
    passwordHash TEXT NOT NULL,
    salt         TEXT NOT NULL,
    createdAt    TEXT NOT NULL
  );
`);

// Activity feed (poke, cam, friends, …)
db.exec(`
  CREATE TABLE IF NOT EXISTS activity_events (
    id             TEXT PRIMARY KEY,
    kind           TEXT NOT NULL,
    actorUserId    TEXT,
    actorName      TEXT,
    targetUserId   TEXT,
    targetDeviceId TEXT,
    text           TEXT,
    createdAt      TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_activity_createdAt ON activity_events(createdAt);
  CREATE INDEX IF NOT EXISTS idx_activity_actor ON activity_events(actorUserId, createdAt);
  CREATE INDEX IF NOT EXISTS idx_activity_target ON activity_events(targetUserId, createdAt);
`);

// Library tags (social discovery)
db.exec(`
  CREATE TABLE IF NOT EXISTS library_tags (
    libraryId TEXT NOT NULL,
    tag       TEXT NOT NULL,
    PRIMARY KEY (libraryId, tag),
    FOREIGN KEY (libraryId) REFERENCES library(id)
  );
  CREATE INDEX IF NOT EXISTS idx_library_tags_tag ON library_tags(tag);
`);

// Scheduled pokes (cloud cron)
db.exec(`
  CREATE TABLE IF NOT EXISTS scheduled_pokes (
    id           TEXT PRIMARY KEY,
    ownerUserId  TEXT NOT NULL,
    targetType   TEXT NOT NULL CHECK (targetType IN ('device', 'user')),
    targetId     TEXT NOT NULL,
    text         TEXT NOT NULL,
    cronType     TEXT NOT NULL CHECK (cronType IN ('daily', 'weekly')),
    timeUtc      TEXT NOT NULL,
    weekday      INTEGER,
    enabled      INTEGER NOT NULL DEFAULT 1,
    lastRunAt    TEXT,
    createdAt    TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_scheduled_pokes_owner ON scheduled_pokes(ownerUserId);
  CREATE INDEX IF NOT EXISTS idx_scheduled_pokes_enabled ON scheduled_pokes(enabled);
`);

// Water tracking
db.exec(`
  CREATE TABLE IF NOT EXISTS water_settings (
    userId           TEXT PRIMARY KEY,
    enabled          INTEGER NOT NULL DEFAULT 0,
    intervalMinutes  INTEGER NOT NULL DEFAULT 90,
    reminderMode     TEXT NOT NULL DEFAULT 'poke' CHECK (reminderMode IN ('poke', 'gif', 'both')),
    pokeText         TEXT NOT NULL DEFAULT 'Drink water!',
    libraryId        TEXT,
    targetDeviceId   TEXT,
    dailyGoalMl      INTEGER NOT NULL DEFAULT 2000,
    glassMl          INTEGER NOT NULL DEFAULT 250,
    lastDrinkAt      TEXT,
    lastRemindAt     TEXT,
    updatedAt        TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS water_logs (
    id        TEXT PRIMARY KEY,
    userId    TEXT NOT NULL,
    amountMl  INTEGER NOT NULL,
    createdAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_water_logs_user ON water_logs(userId, createdAt);
`);

// ---------------------------------------------------------------------------
//  Session store backed by better-sqlite3
// ---------------------------------------------------------------------------

const stmtGetSession = db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expired > ?');
const stmtSetSession = db.prepare(
  'INSERT OR REPLACE INTO sessions (sid, sess, expired) VALUES (?, ?, ?)'
);
const stmtDestroySession = db.prepare('DELETE FROM sessions WHERE sid = ?');
const stmtCleanupSessions = db.prepare('DELETE FROM sessions WHERE expired <= ?');

// Cleanup expired sessions every 15 minutes
setInterval(() => {
  stmtCleanupSessions.run(Date.now());
}, 15 * 60 * 1000);

export class SQLiteSessionStore extends Store {
  get(sid: string, callback: (err?: Error | null, session?: SessionData | null) => void): void {
    try {
      const row = stmtGetSession.get(sid, Date.now()) as { sess: string } | undefined;
      if (row) {
        callback(null, JSON.parse(row.sess));
      } else {
        callback(null, null);
      }
    } catch (err) {
      callback(err as Error);
    }
  }

  set(sid: string, session: SessionData, callback?: (err?: Error | null) => void): void {
    try {
      const maxAge = session.cookie?.maxAge ?? 86400000;
      const expired = Date.now() + maxAge;
      stmtSetSession.run(sid, JSON.stringify(session), expired);
      callback?.(null);
    } catch (err) {
      callback?.(err as Error);
    }
  }

  destroy(sid: string, callback?: (err?: Error | null) => void): void {
    try {
      stmtDestroySession.run(sid);
      callback?.(null);
    } catch (err) {
      callback?.(err as Error);
    }
  }
}

// ---------------------------------------------------------------------------
//  Export database instance for services
// ---------------------------------------------------------------------------

export default db;
