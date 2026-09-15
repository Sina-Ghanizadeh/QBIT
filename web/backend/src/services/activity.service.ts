// ---------------------------------------------------------------------------
//  Activity feed -- poke / cam / friends events for the dashboard
// ---------------------------------------------------------------------------

import crypto from 'crypto';
import db from '../db';
import * as socketService from './socket.service';
import { ensurePublicUserId } from './publicUserId.service';

export type ActivityKind =
  | 'poke_device'
  | 'poke_user'
  | 'cam_start'
  | 'cam_stop'
  | 'friend_accept'
  | 'schedule_poke';

export interface ActivityEvent {
  id: string;
  kind: ActivityKind | string;
  actorUserId: string | null;
  actorName: string | null;
  targetUserId: string | null;
  targetDeviceId: string | null;
  text: string | null;
  createdAt: string;
  actorPublicUserId?: string | null;
  targetPublicUserId?: string | null;
}

const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ROWS = 5000;

const stmtInsert = db.prepare(`
  INSERT INTO activity_events (id, kind, actorUserId, actorName, targetUserId, targetDeviceId, text, createdAt)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const stmtListForUser = db.prepare(`
  SELECT * FROM activity_events
  WHERE actorUserId = ? OR targetUserId = ?
  ORDER BY createdAt DESC
  LIMIT ?
`);
const stmtDeleteOld = db.prepare(`DELETE FROM activity_events WHERE createdAt < ?`);
const stmtCount = db.prepare(`SELECT COUNT(*) as c FROM activity_events`);
const stmtDeleteOldest = db.prepare(`
  DELETE FROM activity_events WHERE id IN (
    SELECT id FROM activity_events ORDER BY createdAt ASC LIMIT ?
  )
`);

function newId(): string {
  return crypto.randomBytes(12).toString('hex');
}

function prune(): void {
  const cutoff = new Date(Date.now() - TTL_MS).toISOString();
  stmtDeleteOld.run(cutoff);
  const row = stmtCount.get() as { c: number };
  if (row.c > MAX_ROWS) {
    stmtDeleteOldest.run(row.c - MAX_ROWS);
  }
}

function withPublicIds(ev: ActivityEvent): ActivityEvent {
  return {
    ...ev,
    actorPublicUserId: ev.actorUserId ? ensurePublicUserId(ev.actorUserId) : null,
    targetPublicUserId: ev.targetUserId ? ensurePublicUserId(ev.targetUserId) : null,
  };
}

export function record(input: {
  kind: ActivityKind | string;
  actorUserId?: string | null;
  actorName?: string | null;
  targetUserId?: string | null;
  targetDeviceId?: string | null;
  text?: string | null;
}): ActivityEvent {
  const ev: ActivityEvent = {
    id: newId(),
    kind: input.kind,
    actorUserId: input.actorUserId ?? null,
    actorName: input.actorName ?? null,
    targetUserId: input.targetUserId ?? null,
    targetDeviceId: input.targetDeviceId ?? null,
    text: input.text ?? null,
    createdAt: new Date().toISOString(),
  };
  stmtInsert.run(
    ev.id,
    ev.kind,
    ev.actorUserId,
    ev.actorName,
    ev.targetUserId,
    ev.targetDeviceId,
    ev.text,
    ev.createdAt
  );
  prune();

  const payload = withPublicIds(ev);
  const notify = new Set<string>();
  if (ev.actorUserId) notify.add(ev.actorUserId);
  if (ev.targetUserId) notify.add(ev.targetUserId);
  for (const uid of notify) {
    socketService.emitToUser(uid, 'activity:new', payload);
  }
  return payload;
}

export function listForUser(userId: string, limit = 50): ActivityEvent[] {
  const lim = Math.min(Math.max(1, limit), 100);
  const rows = stmtListForUser.all(userId, userId, lim) as Record<string, unknown>[];
  return rows.map((r) =>
    withPublicIds({
      id: r.id as string,
      kind: r.kind as string,
      actorUserId: (r.actorUserId as string) || null,
      actorName: (r.actorName as string) || null,
      targetUserId: (r.targetUserId as string) || null,
      targetDeviceId: (r.targetDeviceId as string) || null,
      text: (r.text as string) || null,
      createdAt: r.createdAt as string,
    })
  );
}