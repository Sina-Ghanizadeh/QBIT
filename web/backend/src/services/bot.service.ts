// ---------------------------------------------------------------------------
//  Bot account linking (Telegram phase 1; Bale-ready schema)
// ---------------------------------------------------------------------------

import crypto from 'crypto';
import db from '../db';

export type BotPlatform = 'telegram' | 'bale';

export interface BotLink {
  userId: string;
  platform: BotPlatform;
  platformChatId: string | null;
  platformUsername: string | null;
  linkedAt: string | null;
  verifyCode: string | null;
  verifyExpiresAt: string | null;
}

const VERIFY_TTL_MS = 10 * 60 * 1000;

const stmtUpsert = db.prepare(`
  INSERT INTO bot_links (userId, platform, platformChatId, platformUsername, linkedAt, verifyCode, verifyExpiresAt)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(userId, platform) DO UPDATE SET
    platformChatId = excluded.platformChatId,
    platformUsername = excluded.platformUsername,
    linkedAt = excluded.linkedAt,
    verifyCode = excluded.verifyCode,
    verifyExpiresAt = excluded.verifyExpiresAt
`);
const stmtGet = db.prepare('SELECT * FROM bot_links WHERE userId = ? AND platform = ?');
const stmtByUser = db.prepare('SELECT * FROM bot_links WHERE userId = ?');
const stmtByCode = db.prepare(
  'SELECT * FROM bot_links WHERE platform = ? AND verifyCode = ?'
);
const stmtByChat = db.prepare(
  'SELECT * FROM bot_links WHERE platform = ? AND platformChatId = ?'
);
const stmtDelete = db.prepare('DELETE FROM bot_links WHERE userId = ? AND platform = ?');

function newVerifyCode(): string {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

export function listLinks(userId: string): BotLink[] {
  return stmtByUser.all(userId) as BotLink[];
}

export function getLink(userId: string, platform: BotPlatform): BotLink | null {
  return (stmtGet.get(userId, platform) as BotLink | undefined) ?? null;
}

export function getLinkByChatId(platform: BotPlatform, chatId: string): BotLink | null {
  return (stmtByChat.get(platform, chatId) as BotLink | undefined) ?? null;
}

/** Create / refresh a one-time link code for the logged-in user. */
export function startLink(userId: string, platform: BotPlatform): { verifyCode: string; expiresAt: string } {
  const verifyCode = newVerifyCode();
  const expiresAt = new Date(Date.now() + VERIFY_TTL_MS).toISOString();
  const existing = getLink(userId, platform);
  stmtUpsert.run(
    userId,
    platform,
    existing?.platformChatId ?? null,
    existing?.platformUsername ?? null,
    existing?.linkedAt ?? null,
    verifyCode,
    expiresAt
  );
  return { verifyCode, expiresAt };
}

export function completeLink(
  platform: BotPlatform,
  verifyCode: string,
  chatId: string,
  username?: string
): { ok: true; userId: string } | { error: string } {
  const row = stmtByCode.get(platform, verifyCode.trim().toUpperCase()) as BotLink | undefined;
  if (!row || !row.verifyCode) return { error: 'Invalid code' };
  if (!row.verifyExpiresAt || new Date(row.verifyExpiresAt).getTime() < Date.now()) {
    return { error: 'Code expired' };
  }
  const taken = getLinkByChatId(platform, chatId);
  if (taken && taken.userId !== row.userId) {
    return { error: 'This chat is already linked to another account' };
  }
  stmtUpsert.run(
    row.userId,
    platform,
    chatId,
    username ?? null,
    new Date().toISOString(),
    null,
    null
  );
  return { ok: true, userId: row.userId };
}

export function unlink(userId: string, platform: BotPlatform): boolean {
  const result = stmtDelete.run(userId, platform);
  return result.changes > 0;
}
