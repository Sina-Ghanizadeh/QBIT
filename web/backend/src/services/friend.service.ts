// ---------------------------------------------------------------------------
//  Friends and user settings (onlyFriendsCanPoke)
// ---------------------------------------------------------------------------

import db from '../db';

const stmtGetFriends = db.prepare('SELECT friendId FROM friends WHERE userId = ?');
const stmtAddFriend = db.prepare('INSERT OR IGNORE INTO friends (userId, friendId) VALUES (?, ?)');
const stmtRemoveFriend = db.prepare('DELETE FROM friends WHERE userId = ? AND friendId = ?');
const stmtAreFriends = db.prepare(
  'SELECT 1 FROM friends WHERE (userId = ? AND friendId = ?) OR (userId = ? AND friendId = ?) LIMIT 1'
);

const stmtGetSettings = db.prepare(
  'SELECT onlyFriendsCanPoke, publicFriends, isGlobal FROM user_settings WHERE userId = ?'
);
const stmtSetSettings = db.prepare(
  `INSERT INTO user_settings (userId, onlyFriendsCanPoke, publicFriends, isGlobal)
   VALUES (?, ?, ?, COALESCE((SELECT isGlobal FROM user_settings WHERE userId = ?), 0))
   ON CONFLICT(userId) DO UPDATE SET
     onlyFriendsCanPoke = excluded.onlyFriendsCanPoke,
     publicFriends = excluded.publicFriends`
);

export function getFriendIds(userId: string): string[] {
  const rows = stmtGetFriends.all(userId) as { friendId: string }[];
  return rows.map((r) => r.friendId);
}

/** All unique friend pairs (each pair once, normalized so a < b by internal id). For global graph display. */
export function getAllFriendPairs(): Array<{ a: string; b: string }> {
  const rows = db.prepare('SELECT userId, friendId FROM friends').all() as Array<{ userId: string; friendId: string }>;
  const seen = new Set<string>();
  const pairs: Array<{ a: string; b: string }> = [];
  for (const r of rows) {
    const a = r.userId < r.friendId ? r.userId : r.friendId;
    const b = r.userId < r.friendId ? r.friendId : r.userId;
    const key = `${a}\t${b}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ a, b });
  }
  return pairs;
}

export function getPublicFriends(userId: string): boolean {
  const row = stmtGetSettings.get(userId) as { publicFriends?: number } | undefined;
  return row ? (row.publicFriends ?? 1) !== 0 : true;
}

export function setPublicFriends(userId: string, value: boolean): void {
  const row = stmtGetSettings.get(userId) as { onlyFriendsCanPoke?: number } | undefined;
  const onlyFriendsCanPoke = row ? (row.onlyFriendsCanPoke ?? 0) !== 0 : false;
  stmtSetSettings.run(userId, onlyFriendsCanPoke ? 1 : 0, value ? 1 : 0, userId);
}

/** Friend pairs where both users have publicFriends enabled. No settings row = public (same as getPublicFriends). */
export function getPublicFriendPairs(): Array<{ a: string; b: string }> {
  const all = getAllFriendPairs();
  const privateSet = new Set<string>();
  const stmt = db.prepare('SELECT userId FROM user_settings WHERE publicFriends = 0');
  for (const r of (stmt.all() as Array<{ userId: string }>)) {
    privateSet.add(r.userId);
  }
  return all.filter(({ a, b }) => !privateSet.has(a) && !privateSet.has(b));
}

export function addFriend(userIdA: string, userIdB: string): void {
  if (userIdA === userIdB) return;
  stmtAddFriend.run(userIdA, userIdB);
  stmtAddFriend.run(userIdB, userIdA);
}

export function removeFriend(userIdA: string, userIdB: string): void {
  stmtRemoveFriend.run(userIdA, userIdB);
  stmtRemoveFriend.run(userIdB, userIdA);
}

export function areFriends(userIdA: string, userIdB: string): boolean {
  if (userIdA === userIdB) return true;
  const row = stmtAreFriends.get(userIdA, userIdB, userIdB, userIdA);
  return !!row;
}

export function getOnlyFriendsCanPoke(userId: string): boolean {
  const row = stmtGetSettings.get(userId) as { onlyFriendsCanPoke?: number } | undefined;
  return row ? (row.onlyFriendsCanPoke ?? 0) !== 0 : false;
}

export function setOnlyFriendsCanPoke(userId: string, value: boolean): void {
  const row = stmtGetSettings.get(userId) as { publicFriends?: number } | undefined;
  const publicFriends = row ? (row.publicFriends ?? 1) !== 0 : true;
  stmtSetSettings.run(userId, value ? 1 : 0, publicFriends ? 1 : 0, userId);
}
