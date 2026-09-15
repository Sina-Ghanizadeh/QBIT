// ---------------------------------------------------------------------------
//  Water tracking + overdue reminders (poke / optional QGIF on claimed device)
// ---------------------------------------------------------------------------

import crypto from 'crypto';
import db from '../db';
import * as claimService from './claim.service';
import * as deviceService from './device.service';
import * as animationService from './animation.service';
import * as activityService from './activity.service';
import * as socketService from './socket.service';
import * as userService from './user.service';
import logger from '../logger';

export type WaterReminderMode = 'poke' | 'gif' | 'both';

export interface WaterSettings {
  userId: string;
  enabled: boolean;
  intervalMinutes: number;
  reminderMode: WaterReminderMode;
  pokeText: string;
  libraryId: string | null;
  targetDeviceId: string | null;
  dailyGoalMl: number;
  glassMl: number;
  lastDrinkAt: string | null;
  lastRemindAt: string | null;
  updatedAt: string;
}

export interface WaterLog {
  id: string;
  userId: string;
  amountMl: number;
  createdAt: string;
}

export interface WaterStatus {
  settings: WaterSettings;
  todayMl: number;
  todayGlasses: number;
  minutesSinceLastDrink: number | null;
  overdue: boolean;
  nextRemindInMinutes: number | null;
}

const DEFAULT_INTERVAL = 90;
const DEFAULT_GOAL = 2000;
const DEFAULT_GLASS = 250;
const DEFAULT_TEXT = 'Drink water!';
const MIN_INTERVAL = 15;
const MAX_INTERVAL = 12 * 60;

const stmtGetSettings = db.prepare('SELECT * FROM water_settings WHERE userId = ?');
const stmtUpsertSettings = db.prepare(`
  INSERT INTO water_settings (
    userId, enabled, intervalMinutes, reminderMode, pokeText, libraryId,
    targetDeviceId, dailyGoalMl, glassMl, lastDrinkAt, lastRemindAt, updatedAt
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(userId) DO UPDATE SET
    enabled = excluded.enabled,
    intervalMinutes = excluded.intervalMinutes,
    reminderMode = excluded.reminderMode,
    pokeText = excluded.pokeText,
    libraryId = excluded.libraryId,
    targetDeviceId = excluded.targetDeviceId,
    dailyGoalMl = excluded.dailyGoalMl,
    glassMl = excluded.glassMl,
    lastDrinkAt = excluded.lastDrinkAt,
    lastRemindAt = excluded.lastRemindAt,
    updatedAt = excluded.updatedAt
`);
const stmtInsertLog = db.prepare(`
  INSERT INTO water_logs (id, userId, amountMl, createdAt) VALUES (?, ?, ?, ?)
`);
const stmtTodaySum = db.prepare(`
  SELECT COALESCE(SUM(amountMl), 0) as total, COUNT(*) as cnt
  FROM water_logs
  WHERE userId = ? AND createdAt >= ?
`);
const stmtEnabled = db.prepare('SELECT * FROM water_settings WHERE enabled = 1');
const stmtSetRemind = db.prepare('UPDATE water_settings SET lastRemindAt = ?, updatedAt = ? WHERE userId = ?');
const stmtRecentLogs = db.prepare(`
  SELECT * FROM water_logs WHERE userId = ? ORDER BY createdAt DESC LIMIT ?
`);

function newId(): string {
  return crypto.randomBytes(12).toString('hex');
}

function startOfUtcDayIso(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  return d.toISOString();
}

function rowToSettings(r: Record<string, unknown> | undefined, userId: string): WaterSettings {
  if (!r) {
    const now = new Date().toISOString();
    return {
      userId,
      enabled: false,
      intervalMinutes: DEFAULT_INTERVAL,
      reminderMode: 'poke',
      pokeText: DEFAULT_TEXT,
      libraryId: null,
      targetDeviceId: null,
      dailyGoalMl: DEFAULT_GOAL,
      glassMl: DEFAULT_GLASS,
      lastDrinkAt: null,
      lastRemindAt: null,
      updatedAt: now,
    };
  }
  return {
    userId: r.userId as string,
    enabled: Number(r.enabled) !== 0,
    intervalMinutes: Number(r.intervalMinutes) || DEFAULT_INTERVAL,
    reminderMode: (r.reminderMode as WaterReminderMode) || 'poke',
    pokeText: String(r.pokeText || DEFAULT_TEXT).substring(0, 25),
    libraryId: (r.libraryId as string) || null,
    targetDeviceId: (r.targetDeviceId as string) || null,
    dailyGoalMl: Number(r.dailyGoalMl) || DEFAULT_GOAL,
    glassMl: Number(r.glassMl) || DEFAULT_GLASS,
    lastDrinkAt: (r.lastDrinkAt as string) || null,
    lastRemindAt: (r.lastRemindAt as string) || null,
    updatedAt: r.updatedAt as string,
  };
}

function persist(s: WaterSettings): void {
  stmtUpsertSettings.run(
    s.userId,
    s.enabled ? 1 : 0,
    s.intervalMinutes,
    s.reminderMode,
    s.pokeText,
    s.libraryId,
    s.targetDeviceId,
    s.dailyGoalMl,
    s.glassMl,
    s.lastDrinkAt,
    s.lastRemindAt,
    s.updatedAt
  );
}

export function getSettings(userId: string): WaterSettings {
  return rowToSettings(stmtGetSettings.get(userId) as Record<string, unknown> | undefined, userId);
}

export function getStatus(userId: string): WaterStatus {
  const settings = getSettings(userId);
  const today = stmtTodaySum.get(userId, startOfUtcDayIso()) as { total: number; cnt: number };
  const todayMl = Number(today?.total) || 0;
  const todayGlasses = Number(today?.cnt) || 0;
  let minutesSinceLastDrink: number | null = null;
  if (settings.lastDrinkAt) {
    minutesSinceLastDrink = Math.max(
      0,
      Math.floor((Date.now() - new Date(settings.lastDrinkAt).getTime()) / 60_000)
    );
  }
  const overdue =
    settings.enabled &&
    minutesSinceLastDrink != null &&
    minutesSinceLastDrink >= settings.intervalMinutes;
  let nextRemindInMinutes: number | null = null;
  if (settings.enabled && settings.lastDrinkAt) {
    nextRemindInMinutes = Math.max(0, settings.intervalMinutes - (minutesSinceLastDrink || 0));
  }
  return {
    settings,
    todayMl,
    todayGlasses,
    minutesSinceLastDrink,
    overdue,
    nextRemindInMinutes,
  };
}

export function listRecentLogs(userId: string, limit = 20): WaterLog[] {
  const lim = Math.min(Math.max(1, limit), 50);
  const rows = stmtRecentLogs.all(userId, lim) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r.id as string,
    userId: r.userId as string,
    amountMl: Number(r.amountMl),
    createdAt: r.createdAt as string,
  }));
}

export function updateSettings(
  userId: string,
  patch: {
    enabled?: boolean;
    intervalMinutes?: number;
    reminderMode?: WaterReminderMode;
    pokeText?: string;
    libraryId?: string | null;
    targetDeviceId?: string | null;
    dailyGoalMl?: number;
    glassMl?: number;
  }
): { ok: true; status: WaterStatus } | { error: string; status: number } {
  const cur = getSettings(userId);
  if (patch.targetDeviceId) {
    const claim = claimService.getClaimByDevice(patch.targetDeviceId);
    if (!claim || claim.userId !== userId) {
      return { error: 'You can only remind on your claimed device', status: 403 };
    }
  }
  if (patch.intervalMinutes != null) {
    const n = Math.floor(patch.intervalMinutes);
    if (n < MIN_INTERVAL || n > MAX_INTERVAL) {
      return { error: `intervalMinutes must be ${MIN_INTERVAL}-${MAX_INTERVAL}`, status: 400 };
    }
    cur.intervalMinutes = n;
  }
  if (patch.enabled !== undefined) cur.enabled = patch.enabled;
  if (patch.reminderMode) cur.reminderMode = patch.reminderMode;
  if (patch.pokeText != null) {
    const t = String(patch.pokeText).trim().substring(0, 25);
    if (!t) return { error: 'pokeText required', status: 400 };
    cur.pokeText = t;
  }
  if (patch.libraryId !== undefined) cur.libraryId = patch.libraryId || null;
  if (patch.targetDeviceId !== undefined) cur.targetDeviceId = patch.targetDeviceId || null;
  if (patch.dailyGoalMl != null) {
    const g = Math.floor(patch.dailyGoalMl);
    if (g < 250 || g > 10000) return { error: 'dailyGoalMl out of range', status: 400 };
    cur.dailyGoalMl = g;
  }
  if (patch.glassMl != null) {
    const g = Math.floor(patch.glassMl);
    if (g < 50 || g > 1000) return { error: 'glassMl out of range', status: 400 };
    cur.glassMl = g;
  }
  if (cur.enabled && !cur.targetDeviceId) {
    return { error: 'Pick a claimed device for reminders', status: 400 };
  }
  if ((cur.reminderMode === 'gif' || cur.reminderMode === 'both') && !cur.libraryId) {
    return { error: 'Pick a library QGIF for gif reminders', status: 400 };
  }
  cur.updatedAt = new Date().toISOString();
  persist(cur);
  return { ok: true, status: getStatus(userId) };
}

export function logDrink(
  userId: string,
  amountMl?: number
): { ok: true; status: WaterStatus; log: WaterLog } {
  const cur = getSettings(userId);
  const amount = Math.max(50, Math.min(2000, Math.floor(amountMl ?? cur.glassMl)));
  const now = new Date().toISOString();
  const log: WaterLog = { id: newId(), userId, amountMl: amount, createdAt: now };
  stmtInsertLog.run(log.id, log.userId, log.amountMl, log.createdAt);
  cur.lastDrinkAt = now;
  cur.lastRemindAt = null;
  cur.updatedAt = now;
  persist(cur);
  activityService.record({
    kind: 'water_drink',
    actorUserId: userId,
    actorName: userService.getUserById(userId)?.displayName || 'You',
    text: `+${amount}ml`,
  });
  return { ok: true, status: getStatus(userId), log };
}

function sendPoke(deviceId: string, text: string, actorName: string): boolean {
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

function runReminders(): void {
  const now = Date.now();
  const rows = stmtEnabled.all() as Record<string, unknown>[];
  for (const raw of rows) {
    const s = rowToSettings(raw, raw.userId as string);
    if (!s.targetDeviceId || !s.lastDrinkAt) continue;
    const sinceDrink = now - new Date(s.lastDrinkAt).getTime();
    if (sinceDrink < s.intervalMinutes * 60_000) continue;
    if (s.lastRemindAt) {
      const sinceRemind = now - new Date(s.lastRemindAt).getTime();
      // Re-nudge at most once per interval until they drink
      if (sinceRemind < s.intervalMinutes * 60_000) continue;
    }
    const claim = claimService.getClaimByDevice(s.targetDeviceId);
    if (!claim || claim.userId !== s.userId) continue;
    const user = userService.getUserById(s.userId);
    const name = user?.displayName || 'QBIT';
    let poked = false;
    let gifOk = false;
    if (s.reminderMode === 'poke' || s.reminderMode === 'both') {
      poked = sendPoke(s.targetDeviceId, s.pokeText, name);
      // Also notify the owner's browser if online
      socketService.emitToUser(s.userId, 'poke', {
        from: 'Water',
        text: s.pokeText,
      });
    }
    if ((s.reminderMode === 'gif' || s.reminderMode === 'both') && s.libraryId) {
      const res = animationService.pushAnimationToDevice(s.userId, s.targetDeviceId, {
        libraryId: s.libraryId,
      });
      gifOk = !('error' in res);
    }
    if (poked || gifOk || s.reminderMode === 'gif') {
      const ts = new Date().toISOString();
      stmtSetRemind.run(ts, ts, s.userId);
      activityService.record({
        kind: 'water_remind',
        actorUserId: s.userId,
        actorName: name,
        targetDeviceId: s.targetDeviceId,
        text: s.pokeText,
      });
      logger.info(
        { userId: s.userId, poked, gifOk, mode: s.reminderMode },
        'Water reminder sent'
      );
    }
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startWaterWorker(): void {
  if (timer) return;
  timer = setInterval(() => {
    try {
      runReminders();
    } catch (err) {
      logger.error({ err }, 'Water worker error');
    }
  }, 60_000);
  setTimeout(() => {
    try {
      runReminders();
    } catch {
      /* ignore */
    }
  }, 8_000);
  logger.info('Water reminder worker started');
}