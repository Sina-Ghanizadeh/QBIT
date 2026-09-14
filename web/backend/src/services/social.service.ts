// ---------------------------------------------------------------------------
//  Social access helpers -- Global + Groups + Friends poke / visibility
// ---------------------------------------------------------------------------

import db from '../db';
import * as friendService from './friend.service';

const stmtGetIsGlobal = db.prepare('SELECT isGlobal FROM user_settings WHERE userId = ?');
const stmtSetIsGlobal = db.prepare(`
  INSERT INTO user_settings (userId, onlyFriendsCanPoke, publicFriends, isGlobal)
  VALUES (?, 0, 1, ?)
  ON CONFLICT(userId) DO UPDATE SET isGlobal = excluded.isGlobal
`);

const stmtShareGroup = db.prepare(`
  SELECT 1 FROM group_members a
  INNER JOIN group_members b ON a.groupId = b.groupId
  WHERE a.userId = ? AND b.userId = ?
    AND a.status = 'approved' AND b.status = 'approved'
  LIMIT 1
`);

export function getIsGlobal(userId: string): boolean {
  const row = stmtGetIsGlobal.get(userId) as { isGlobal?: number } | undefined;
  return row ? (row.isGlobal ?? 0) !== 0 : false;
}

export function setIsGlobal(userId: string, value: boolean): void {
  const existing = db
    .prepare('SELECT onlyFriendsCanPoke, publicFriends FROM user_settings WHERE userId = ?')
    .get(userId) as { onlyFriendsCanPoke?: number; publicFriends?: number } | undefined;
  if (existing) {
    db.prepare(
      'UPDATE user_settings SET isGlobal = ? WHERE userId = ?'
    ).run(value ? 1 : 0, userId);
  } else {
    stmtSetIsGlobal.run(userId, value ? 1 : 0);
  }
}

export function shareApprovedGroup(userIdA: string, userIdB: string): boolean {
  if (userIdA === userIdB) return true;
  return !!stmtShareGroup.get(userIdA, userIdB);
}

/**
 * Base poke rule: friends OR both global OR share an approved group.
 * Device-level onlyFriendsCanPoke is applied separately by callers.
 */
export function canPoke(senderUserId: string, targetUserId: string): boolean {
  if (senderUserId === targetUserId) return true;
  if (friendService.areFriends(senderUserId, targetUserId)) return true;
  if (getIsGlobal(senderUserId) && getIsGlobal(targetUserId)) return true;
  if (shareApprovedGroup(senderUserId, targetUserId)) return true;
  return false;
}

export function canPokeReason(senderUserId: string, targetUserId: string): string | null {
  if (canPoke(senderUserId, targetUserId)) return null;
  return 'You can only poke friends, global users, or members of a shared group';
}
