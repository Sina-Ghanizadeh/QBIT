// ---------------------------------------------------------------------------
//  Animation grants -- who may set animation on owner's device(s)
// ---------------------------------------------------------------------------

import crypto from 'crypto';
import db from '../db';
import { PUBLIC_BASE_URL } from '../config';
import * as claimService from './claim.service';
import * as groupService from './group.service';
import * as deviceService from './device.service';
import * as libraryService from './library.service';
import logger from '../logger';
import * as activityService from './activity.service';
import * as userService from './user.service';
import { ensurePublicUserId } from './publicUserId.service';

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
const stmtByUserGrantee = db.prepare(`
  SELECT * FROM animation_grants
  WHERE granteeType = 'user' AND granteeId = ?
  ORDER BY createdAt DESC
`);
const stmtGroupGrants = db.prepare(`
  SELECT * FROM animation_grants
  WHERE granteeType = 'group'
  ORDER BY createdAt DESC
`);

function newId(): string {
  return crypto.randomBytes(12).toString('hex');
}

export function listGrantsForOwner(ownerUserId: string): AnimationGrant[] {
  return stmtByOwner.all(ownerUserId) as AnimationGrant[];
}

export interface AnimationTarget {
  deviceId: string;
  deviceName: string;
  online: boolean;
  ownerPublicUserId: string;
  ownerDisplayName: string;
  via: GranteeType;
  groupId?: string;
  grantId: string;
}

/** Devices the actor may set animation on via grants (not own devices). */
export function listAnimationTargetsForUser(actorUserId: string): AnimationTarget[] {
  const grants: AnimationGrant[] = [
    ...(stmtByUserGrantee.all(actorUserId) as AnimationGrant[]),
  ];
  for (const g of stmtGroupGrants.all() as AnimationGrant[]) {
    if (groupService.isApprovedMember(g.granteeId, actorUserId)) {
      grants.push(g);
    }
  }

  const byDevice = new Map<string, AnimationTarget>();

  for (const g of grants) {
    if (g.ownerUserId === actorUserId) continue;

    const deviceIds = g.deviceId
      ? [g.deviceId]
      : claimService.getDeviceIdsForUser(g.ownerUserId);

    const owner = userService.getUserById(g.ownerUserId);
    const ownerPublic = ensurePublicUserId(g.ownerUserId);
    const ownerDisplayName = owner?.displayName || 'Someone';

    for (const deviceId of deviceIds) {
      const claim = claimService.getClaimByDevice(deviceId);
      if (!claim || claim.userId !== g.ownerUserId) continue;

      const existing = byDevice.get(deviceId);
      // Prefer direct user grants over group when both apply
      if (existing && existing.via === 'user' && g.granteeType === 'group') continue;

      byDevice.set(deviceId, {
        deviceId,
        deviceName: deviceService.getDeviceDisplayName(deviceId),
        online: !!deviceService.getDevice(deviceId),
        ownerPublicUserId: ownerPublic,
        ownerDisplayName,
        via: g.granteeType,
        groupId: g.granteeType === 'group' ? g.granteeId : undefined,
        grantId: g.id,
      });
    }
  }

  return Array.from(byDevice.values()).sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    return a.deviceName.localeCompare(b.deviceName);
  });
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

/** Push set_animation to device over WS (device downloads .qgif from url). */
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

  const libraryId = payload.libraryId || payload.animationId;
  let url: string | undefined;
  let filename = payload.filename;
  if (libraryId) {
    const item = libraryService.getById(libraryId);
    if (!item) {
      return { error: 'Library item not found', status: 404 };
    }
    filename = filename || item.filename;
    url = `${PUBLIC_BASE_URL}/api/library/${encodeURIComponent(libraryId)}/raw`;
  }

  if (!url) {
    return { error: 'libraryId is required so the device can download the file', status: 400 };
  }

  try {
    device.ws.send(
      JSON.stringify({
        type: 'set_animation',
        libraryId,
        filename,
        animationId: payload.animationId ?? libraryId,
        url,
      })
    );
  } catch {
    return { error: 'Failed to send to device', status: 502 };
  }
  return { ok: true };
}

/** Claim owner only may stream webcam to a device (stricter than animation grants). */
export function canStreamCam(actorUserId: string, deviceId: string): boolean {
  const claim = claimService.getClaimByDevice(deviceId);
  return !!claim && claim.userId === actorUserId;
}

const camSessions = new Map<string, string>(); // deviceId -> userId
const camFrameLogCounts = new Map<string, number>();

export function getCamSessionUser(deviceId: string): string | undefined {
  return camSessions.get(deviceId);
}

export function clearCamSession(deviceId: string): void {
  camSessions.delete(deviceId);
  camFrameLogCounts.delete(deviceId);
}

/** Normalize browser Socket.io frame payloads into a Buffer. */
export function coerceCamFrame(frame: unknown): Buffer | null {
  if (frame == null) return null;
  if (typeof frame === 'string') return Buffer.from(frame, 'base64');
  if (Buffer.isBuffer(frame)) return frame;
  if (frame instanceof ArrayBuffer) return Buffer.from(frame);
  if (ArrayBuffer.isView(frame)) {
    const v = frame as ArrayBufferView;
    return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
  }
  if (Array.isArray(frame)) return Buffer.from(frame as number[]);
  if (
    typeof frame === 'object' &&
    (frame as { type?: string }).type === 'Buffer' &&
    Array.isArray((frame as { data?: unknown }).data)
  ) {
    return Buffer.from((frame as { data: number[] }).data);
  }
  return null;
}

/** Forward cloud webcam control/frames to a claimed device (owner only). */
export function pushCamToDevice(
  actorUserId: string,
  deviceId: string,
  action: 'start' | 'stop' | 'frame',
  frame?: Buffer
): { ok: true } | { error: string; status: number } {
  if (!canStreamCam(actorUserId, deviceId)) {
    return { error: 'Only the device owner can stream webcam to this device', status: 403 };
  }
  const device = deviceService.getDevice(deviceId);
  if (!device) {
    return { error: 'Device not found or offline', status: 404 };
  }
  try {
    if (action === 'start') {
      device.ws.send(JSON.stringify({ type: 'cam_start' }));
      camSessions.set(deviceId, actorUserId);
      logger.info({ deviceId, userId: actorUserId }, 'cam: sent cam_start to device');
      const actor = userService.getUserById(actorUserId);
      activityService.record({
        kind: 'cam_start',
        actorUserId,
        actorName: actor?.displayName || null,
        targetDeviceId: deviceId,
      });
    } else if (action === 'stop') {
      device.ws.send(JSON.stringify({ type: 'cam_stop' }));
      camSessions.delete(deviceId);
      logger.info({ deviceId, userId: actorUserId }, 'cam: sent cam_stop to device');
      const actor = userService.getUserById(actorUserId);
      activityService.record({
        kind: 'cam_stop',
        actorUserId,
        actorName: actor?.displayName || null,
        targetDeviceId: deviceId,
      });
    } else if (action === 'frame') {
      const receivedLen = frame?.length ?? 0;
      if (!frame || receivedLen !== 1024) {
        logger.warn(
          { deviceId, userId: actorUserId, receivedFrameLen: receivedLen, expected: 1024 },
          'cam: reject frame (bad length)'
        );
        return { error: 'Frame must be exactly 1024 bytes', status: 400 };
      }
      // Do not send frames if session was cleared (device stopped / busy)
      if (!camSessions.has(deviceId)) {
        logger.warn({ deviceId, userId: actorUserId, receivedFrameLen: receivedLen }, 'cam: reject frame (no session)');
        return { error: 'Camera session not active', status: 409 };
      }
      device.ws.send(frame, { binary: true });
      const n = (camFrameLogCounts.get(deviceId) || 0) + 1;
      camFrameLogCounts.set(deviceId, n);
      if (n <= 5 || n % 50 === 0) {
        logger.info(
          {
            deviceId,
            userId: actorUserId,
            receivedFrameLen: receivedLen,
            forwardedFrameLen: frame.length,
            binary: true,
            frameSeq: n,
          },
          'cam: forwarded binary frame to device'
        );
      }
    }
  } catch (err) {
    logger.error({ err, deviceId, action }, 'cam: failed to send to device');
    return { error: 'Failed to send to device', status: 502 };
  }
  return { ok: true };
}
