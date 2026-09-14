// ---------------------------------------------------------------------------
//  Animation grants -- who may set animation on owner's device(s)
// ---------------------------------------------------------------------------

import crypto from 'crypto';
import db from '../db';
import * as claimService from './claim.service';
import * as groupService from './group.service';
import * as deviceService from './device.service';

export type GranteeType = 'user' | 'group';

export interface AnimationGrant {
  id: string;
  ownerUserId: string;
  deviceId: string | null;
  granteeType: GranteeType;
  granteeId: string;
  createdAt: string;
}

const stmtInsert = db.prepare(`
  INSERT INTO animation_grants (id, ownerUserId, deviceId, granteeType, granteeId, createdAt)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const stmtByOwner = db.prepare('SELECT * FROM animation_grants WHERE ownerUserId = ? ORDER BY createdAt DESC');
const stmtGet = db.prepare('SELECT * FROM animation_grants WHERE id = ?');
const stmtDelete = db.prepare('DELETE FROM animation_grants WHERE id = ?');
const stmtForDevice = db.prepare(`
  SELECT * FROM animation_grants
  WHERE ownerUserId = ? AND (deviceId IS NULL OR deviceId = ?)
`);

function newId(): string {
  return crypto.randomBytes(12).toString('hex');
}

export function listGrantsForOwner(ownerUserId: string): AnimationGrant[] {
  return stmtByOwner.all(ownerUserId) as AnimationGrant[];
}

export function createGrant(input: {
  ownerUserId: string;
  deviceId?: string | null;
  granteeType: GranteeType;
  granteeId: string;
}): AnimationGrant | { error: string; status: number } {
  if (input.deviceId) {
    const claim = claimService.getClaimByDevice(input.deviceId);
    if (!claim || claim.userId !== input.ownerUserId) {
      return { error: 'You can only grant access to your own devices', status: 403 };
    }
  }
  if (input.granteeType === 'group') {
    const group = groupService.getGroup(input.granteeId);
    if (!group) return { error: 'Group not found', status: 404 };
  }
  const id = newId();
  const createdAt = new Date().toISOString();
  stmtInsert.run(
    id,
    input.ownerUserId,
    input.deviceId ?? null,
    input.granteeType,
    input.granteeId,
    createdAt
  );
  return stmtGet.get(id) as AnimationGrant;
}

export function deleteGrant(
  grantId: string,
  actorUserId: string
): { ok: true } | { error: string; status: number } {
  const grant = stmtGet.get(grantId) as AnimationGrant | undefined;
  if (!grant) return { error: 'Grant not found', status: 404 };
  if (grant.ownerUserId !== actorUserId) {
    return { error: 'Only the owner can revoke this grant', status: 403 };
  }
  stmtDelete.run(grantId);
  return { ok: true };
}

export function canSetAnimation(actorUserId: string, deviceId: string): boolean {
  const claim = claimService.getClaimByDevice(deviceId);
  if (!claim) return false;
  if (claim.userId === actorUserId) return true;

  const grants = stmtForDevice.all(claim.userId, deviceId) as AnimationGrant[];
  for (const g of grants) {
    if (g.granteeType === 'user' && g.granteeId === actorUserId) return true;
    if (g.granteeType === 'group' && groupService.isApprovedMember(g.granteeId, actorUserId)) {
      return true;
    }
  }
  return false;
}

/** Push set_animation to device over WS. Firmware may ignore until supported. */
export function pushAnimationToDevice(
  actorUserId: string,
  deviceId: string,
  payload: { libraryId?: string; filename?: string; animationId?: string }
): { ok: true } | { error: string; status: number } {
  if (!canSetAnimation(actorUserId, deviceId)) {
    return { error: 'No permission to set animation on this device', status: 403 };
  }
  const device = deviceService.getDevice(deviceId);
  if (!device) {
    return { error: 'Device not found or offline', status: 404 };
  }
  try {
    device.ws.send(
      JSON.stringify({
        type: 'set_animation',
        libraryId: payload.libraryId,
        filename: payload.filename,
        animationId: payload.animationId ?? payload.libraryId,
      })
    );
  } catch {
    return { error: 'Failed to send to device', status: 502 };
  }
  return { ok: true };
}
