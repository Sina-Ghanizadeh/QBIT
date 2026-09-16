// ---------------------------------------------------------------------------
//  Claim service -- SQLite-backed
// ---------------------------------------------------------------------------

import db from '../db';
import type { ClaimInfo } from '../types';

const stmtGet = db.prepare('SELECT * FROM claims WHERE deviceId = ?');
const stmtAll = db.prepare('SELECT * FROM claims');
const stmtByUser = db.prepare('SELECT deviceId FROM claims WHERE userId = ?');
const stmtInsert = db.prepare(
  'INSERT OR REPLACE INTO claims (deviceId, userId, userName, userAvatar, claimedAt, showInGlobal) VALUES (?, ?, ?, ?, ?, COALESCE((SELECT showInGlobal FROM claims WHERE deviceId = ?), 0))'
);
const stmtDelete = db.prepare('DELETE FROM claims WHERE deviceId = ?');
const stmtSetShowInGlobal = db.prepare('UPDATE claims SET showInGlobal = ? WHERE deviceId = ?');

export function getClaimByDevice(deviceId: string): ClaimInfo | null {
  const row = stmtGet.get(deviceId) as (ClaimInfo & { deviceId: string; showInGlobal?: number }) | undefined;
  if (!row) return null;
  return { userId: row.userId, userName: row.userName, userAvatar: row.userAvatar, claimedAt: row.claimedAt };
}

export function getDeviceIdsForUser(userId: string): string[] {
  return (stmtByUser.all(userId) as { deviceId: string }[]).map((r) => r.deviceId);
}

export function getShowInGlobal(deviceId: string): boolean {
  const row = stmtGet.get(deviceId) as { showInGlobal?: number } | undefined;
  return row ? (row.showInGlobal ?? 0) !== 0 : false;
}

export function setShowInGlobal(deviceId: string, value: boolean): boolean {
  const result = stmtSetShowInGlobal.run(value ? 1 : 0, deviceId);
  return result.changes > 0;
}

export function getAllClaims(): Record<string, ClaimInfo> {
  const rows = stmtAll.all() as (ClaimInfo & { deviceId: string })[];
  const result: Record<string, ClaimInfo> = {};
  for (const row of rows) {
    result[row.deviceId] = {
      userId: row.userId,
      userName: row.userName,
      userAvatar: row.userAvatar,
      claimedAt: row.claimedAt,
    };
  }
  return result;
}

export function setClaim(deviceId: string, claim: ClaimInfo): void {
  stmtInsert.run(deviceId, claim.userId, claim.userName, claim.userAvatar, claim.claimedAt, deviceId);
}

export function removeClaim(deviceId: string): boolean {
  const result = stmtDelete.run(deviceId);
  return result.changes > 0;
}
