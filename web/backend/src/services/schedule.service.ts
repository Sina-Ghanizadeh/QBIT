// ---------------------------------------------------------------------------
//  Scheduled pokes -- daily/weekly cloud cron (no Redis)
// ---------------------------------------------------------------------------

import crypto from 'crypto';
import db from '../db';
import * as claimService from './claim.service';
import * as deviceService from './device.service';
import * as friendService from './friend.service';
import * as userService from './user.service';
import * as socketService from './socket.service';
import * as activityService from './activity.service';
import { getUserIdFromPublicId, ensurePublicUserId } from './publicUserId.service';
import logger from '../logger';

export type ScheduleTargetType = 'device' | 'user';
export type ScheduleCronType = 'daily' | 'weekly';

export interface ScheduledPoke {
  id: string;
  ownerUserId: string;
  targetType: ScheduleTargetType;
  targetId: string;
  text: string;
  cronType: ScheduleCronType;
  timeUtc: string;
  weekday: number | null;
  enabled: boolean;
  lastRunAt: string | null;
  createdAt: string;
}

const MAX_ACTIVE = 10;

const stmtList = db.prepare(
  'SELECT * FROM scheduled_pokes WHERE ownerUserId = ? ORDER BY createdAt DESC'
);
const stmtGet = db.prepare('SELECT * FROM scheduled_pokes WHERE id = ?');
const stmtInsert = db.prepare(`
  INSERT INTO scheduled_pokes
    (id, ownerUserId, targetType, targetId, text, cronType, timeUtc, weekday, enabled, lastRunAt, createdAt)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, ?)
`);
const stmtUpdateFull = db.prepare(`
  UPDATE scheduled_pokes SET text = ?, cronType = ?, timeUtc = ?, weekday = ?, enabled = ?
  WHERE id = ? AND ownerUserId = ?
`);
const stmtDelete = db.prepare('DELETE FROM scheduled_pokes WHERE id = ? AND ownerUserId = ?');
const stmtSetLastRun = db.prepare('UPDATE scheduled_pokes SET lastRunAt = ? WHERE id = ?');
const stmtEnabled = db.prepare('SELECT * FROM scheduled_pokes WHERE enabled = 1');
const stmtCountEnabled = db.prepare(
  'SELECT COUNT(*) as c FROM scheduled_pokes WHERE ownerUserId = ? AND enabled = 1'
);

function newId(): string {
  return crypto.randomBytes(12).toString('hex');
}

function rowToSchedule(r: Record<string, unknown>): ScheduledPoke {
  return {
    id: r.id as string,
    ownerUserId: r.ownerUserId as string,
    targetType: r.targetType as ScheduleTargetType,
    targetId: r.targetId as string,
    text: r.text as string,
    cronType: r.cronType as ScheduleCronType,
    timeUtc: r.timeUtc as string,
    weekday: r.weekday == null ? null : Number(r.weekday),
    enabled: Number(r.enabled) !== 0,
    lastRunAt: (r.lastRunAt as string) || null,
    createdAt: r.createdAt as string,
  };
}

function parseTimeUtc(t: string): { h: number; m: number } | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(t);
  if (!m) return null;
  return { h: parseInt(m[1], 10), m: parseInt(m[2], 10) };
}

export function listForOwner(ownerUserId: string): ScheduledPoke[] {
  return (stmtList.all(ownerUserId) as Record<string, unknown>[]).map(rowToSchedule);
}

export function create(input: {
  ownerUserId: string;
  targetType: ScheduleTargetType;
  targetId: string;
  text: string;
  cronType: ScheduleCronType;
  timeUtc: string;
  weekday?: number | null;
}): { ok: true; schedule: ScheduledPoke } | { error: string; status: number } {
  const text = String(input.text || '').trim().substring(0, 25);
  if (!text) return { error: 'text required', status: 400 };
  if (!parseTimeUtc(input.timeUtc)) return { error: 'timeUtc must be HH:MM', status: 400 };
  if (input.cronType === 'weekly') {
    const w = input.weekday;
    if (w == null || w < 0 || w > 6) return { error: 'weekday 0-6 required for weekly', status: 400 };
  }

  if (input.targetType === 'device') {
    const claim = claimService.getClaimByDevice(input.targetId);
    if (!claim || claim.userId !== input.ownerUserId) {
      return { error: 'You can only schedule pokes to your claimed devices', status: 403 };
    }
  } else {
    const targetUserId = getUserIdFromPublicId(input.targetId);
    if (!targetUserId) return { error: 'User not found', status: 404 };
    if (!friendService.areFriends(input.ownerUserId, targetUserId)) {
      return { error: 'You can only schedule pokes to friends', status: 403 };
    }
  }

  const count = (stmtCountEnabled.get(input.ownerUserId) as { c: number }).c;
  if (count >= MAX_ACTIVE) {
    return { error: `Maximum ${MAX_ACTIVE} active schedules`, status: 400 };
  }

  const id = newId();
  const createdAt = new Date().toISOString();
  const weekday = input.cronType === 'weekly' ? (input.weekday ?? 0) : null;
  stmtInsert.run(
    id,
    input.ownerUserId,
    input.targetType,
    input.targetId,
    text,
    input.cronType,
    input.timeUtc,
    weekday,
    createdAt
  );
  return { ok: true, schedule: rowToSchedule(stmtGet.get(id) as Record<string, unknown>) };
}

export function update(
  ownerUserId: string,
  id: string,
  patch: {
    text?: string;
    cronType?: ScheduleCronType;
    timeUtc?: string;
    weekday?: number | null;
    enabled?: boolean;
  }
): { ok: true; schedule: ScheduledPoke } | { error: string; status: number } {
  const existing = stmtGet.get(id) as Record<string, unknown> | undefined;
  if (!existing || existing.ownerUserId !== ownerUserId) {
    return { error: 'Not found', status: 404 };
  }
  const cur = rowToSchedule(existing);
  const text =
    patch.text != null ? String(patch.text).trim().substring(0, 25) : cur.text;
  if (!text) return { error: 'text required', status: 400 };
  const cronType = patch.cronType ?? cur.cronType;
  const timeUtc = patch.timeUtc ?? cur.timeUtc;
  if (!parseTimeUtc(timeUtc)) return { error: 'timeUtc must be HH:MM', status: 400 };
  let weekday = patch.weekday !== undefined ? patch.weekday : cur.weekday;
  if (cronType === 'weekly') {
    if (weekday == null || weekday < 0 || weekday > 6) {
      return { error: 'weekday 0-6 required for weekly', status: 400 };
    }
  } else {
    weekday = null;
  }
  const enabled = patch.enabled !== undefined ? patch.enabled : cur.enabled;
  if (enabled && !cur.enabled) {
    const count = (stmtCountEnabled.get(ownerUserId) as { c: number }).c;
    if (count >= MAX_ACTIVE) {
      return { error: `Maximum ${MAX_ACTIVE} active schedules`, status: 400 };
    }
  }
  stmtUpdateFull.run(text, cronType, timeUtc, weekday, enabled ? 1 : 0, id, ownerUserId);
  return { ok: true, schedule: rowToSchedule(stmtGet.get(id) as Record<string, unknown>) };
}

export function remove(
  ownerUserId: string,
  id: string
): { ok: true } | { error: string; status: number } {
  const r = stmtDelete.run(id, ownerUserId);
  if (r.changes === 0) return { error: 'Not found', status: 404 };
  return { ok: true };
}

function alreadyRanThisMinute(lastRunAt: string | null, now: Date): boolean {
  if (!lastRunAt) return false;
  const last = new Date(lastRunAt);
  return (
    last.getUTCFullYear() === now.getUTCFullYear() &&
    last.getUTCMonth() === now.getUTCMonth() &&
    last.getUTCDate() === now.getUTCDate() &&
    last.getUTCHours() === now.getUTCHours() &&
    last.getUTCMinutes() === now.getUTCMinutes()
  );
}

function isDue(s: ScheduledPoke, now: Date): boolean {
  const tm = parseTimeUtc(s.timeUtc);
  if (!tm) return false;
  if (now.getUTCHours() !== tm.h || now.getUTCMinutes() !== tm.m) return false;
  if (s.cronType === 'weekly') {
    if (s.weekday == null || now.getUTCDay() !== s.weekday) return false;
  }
  if (alreadyRanThisMinute(s.lastRunAt, now)) return false;
  return true;
}

function sendDevicePoke(ownerUserId: string, deviceId: string, text: string, actorName: string): boolean {
  const claim = claimService.getClaimByDevice(deviceId);
  if (!claim || claim.userId !== ownerUserId) return false;
  const device = deviceService.getDevice(deviceId);
  if (!device) return false;
  try {
    device.ws.send(
      JSON.stringify({
        type: 'poke',
        sender: actorName || 'QBIT',
        text: text.substring(0, 25),
      })
    );
    const io = socketService.getIo();
    if (io) io.emit('poke:highlight', { deviceToken: device.pokeToken });
    return true;
  } catch {
    return false;
  }
}

function sendUserPoke(
  ownerUserId: string,
  targetPublicUserId: string,
  text: string,
  actorName: string
): boolean {
  const targetUserId = getUserIdFromPublicId(targetPublicUserId);
  if (!targetUserId) return false;
  if (!friendService.areFriends(ownerUserId, targetUserId)) return false;
  const onlineUsersMap = socketService.getOnlineUsersMap();
  const io = socketService.getIo();
  if (!io) return false;
  let sent = false;
  const payload = {
    from: actorName || 'QBIT',
    fromPublicUserId: ensurePublicUserId(ownerUserId),
    text: text.substring(0, 25),
  };
  for (const u of onlineUsersMap.values()) {
    if (u.userId === targetUserId) {
      const s = io.sockets.sockets.get(u.socketId);
      if (s) {
        s.emit('poke', payload);
        sent = true;
      }
    }
  }
  if (sent) io.emit('poke:highlight', { publicUserId: targetPublicUserId });
  return sent;
}

export function runDueSchedules(): void {
  const now = new Date();
  const rows = stmtEnabled.all() as Record<string, unknown>[];
  for (const row of rows) {
    const s = rowToSchedule(row);
    if (!isDue(s, now)) continue;
    const owner = userService.getUserById(s.ownerUserId);
    const actorName = owner?.displayName || 'QBIT';
    let ok = false;
    if (s.targetType === 'device') {
      ok = sendDevicePoke(s.ownerUserId, s.targetId, s.text, actorName);
    } else {
      ok = sendUserPoke(s.ownerUserId, s.targetId, s.text, actorName);
    }
    stmtSetLastRun.run(now.toISOString(), s.id);
    if (ok) {
      activityService.record({
        kind: 'schedule_poke',
        actorUserId: s.ownerUserId,
        actorName,
        targetUserId: s.targetType === 'user' ? getUserIdFromPublicId(s.targetId) : null,
        targetDeviceId: s.targetType === 'device' ? s.targetId : null,
        text: s.text,
      });
      logger.info({ scheduleId: s.id, targetType: s.targetType }, 'Scheduled poke sent');
    } else {
      logger.warn({ scheduleId: s.id, targetType: s.targetType }, 'Scheduled poke failed (offline?)');
    }
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startScheduleWorker(): void {
  if (timer) return;
  timer = setInterval(() => {
    try {
      runDueSchedules();
    } catch (err) {
      logger.error({ err }, 'Schedule worker error');
    }
  }, 60_000);
  setTimeout(() => {
    try {
      runDueSchedules();
    } catch {
      /* ignore */
    }
  }, 5_000);
  logger.info('Scheduled poke worker started');
}
