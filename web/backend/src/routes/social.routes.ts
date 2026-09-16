// ---------------------------------------------------------------------------
//  Network + me/devices + animation grants + bot link routes
// ---------------------------------------------------------------------------

import { Router, Request, Response } from 'express';
import { validate, validateParams } from '../middleware/validate';
import { requireNotBanned } from '../middleware/requireNotBanned';
import {
  meDeviceSettingsSchema,
  meDeviceIdParamSchema,
  groupIdParamSchema,
  createAnimationGrantSchema,
  grantIdParamSchema,
  setAnimationSchema,
  botPlatformParamSchema,
  createScheduleSchema,
  updateScheduleSchema,
  scheduleIdParamSchema,
  waterSettingsSchema,
  waterDrinkSchema,
} from '../schemas';
import * as networkService from '../services/network.service';
import * as claimService from '../services/claim.service';
import * as animationService from '../services/animation.service';
import * as botService from '../services/bot.service';
import * as socialService from '../services/social.service';
import * as activityService from '../services/activity.service';
import * as scheduleService from '../services/schedule.service';
import * as waterService from '../services/water.service';
import { getUserIdFromPublicId, ensurePublicUserId } from '../services/publicUserId.service';
import type { AppUser } from '../types';

const router = Router();

function requireUser(req: Request, res: Response): AppUser | null {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: 'Login required' });
    return null;
  }
  return req.user as AppUser;
}

// GET /api/network/global
router.get('/network/global', (req, res) => {
  if (!requireUser(req, res)) return;
  res.json(networkService.getGlobalNetwork());
});

// GET /api/network/groups/:groupId
router.get('/network/groups/:groupId', validateParams(groupIdParamSchema), (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const result = networkService.getGroupNetwork(req.params.groupId as string, user.id);
  if ('error' in result) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

// GET /api/me/devices
router.get('/me/devices', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  res.json({ devices: networkService.getMyDevices(user.id) });
});

// GET /api/me/activity
router.get('/me/activity', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '40'), 10) || 40));
  res.json({ events: activityService.listForUser(user.id, limit) });
});

// GET /api/me/schedules
router.get('/me/schedules', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  res.json({ schedules: scheduleService.listForOwner(user.id) });
});

// POST /api/me/schedules
router.post('/me/schedules', requireNotBanned, validate(createScheduleSchema), (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const result = scheduleService.create({
    ownerUserId: user.id,
    targetType: req.body.targetType,
    targetId: req.body.targetId,
    text: req.body.text,
    cronType: req.body.cronType,
    timeUtc: req.body.timeUtc,
    weekday: req.body.weekday,
  });
  if ('error' in result) return res.status(result.status).json({ error: result.error });
  res.json({ schedule: result.schedule });
});

// PATCH /api/me/schedules/:id
router.patch(
  '/me/schedules/:id',
  requireNotBanned,
  validateParams(scheduleIdParamSchema),
  validate(updateScheduleSchema),
  (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const result = scheduleService.update(user.id, req.params.id as string, {
      text: req.body.text,
      cronType: req.body.cronType,
      timeUtc: req.body.timeUtc,
      weekday: req.body.weekday,
      enabled: req.body.enabled,
    });
    if ('error' in result) return res.status(result.status).json({ error: result.error });
    res.json({ schedule: result.schedule });
  }
);

// DELETE /api/me/schedules/:id
router.delete(
  '/me/schedules/:id',
  requireNotBanned,
  validateParams(scheduleIdParamSchema),
  (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const result = scheduleService.remove(user.id, req.params.id as string);
    if ('error' in result) return res.status(result.status).json({ error: result.error });
    res.json({ ok: true });
  }
);


// GET /api/me/water
router.get('/me/water', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  res.json({
    ...waterService.getStatus(user.id),
    logs: waterService.listRecentLogs(user.id, 12),
  });
});

// PATCH /api/me/water/settings
router.patch('/me/water/settings', requireNotBanned, validate(waterSettingsSchema), (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const result = waterService.updateSettings(user.id, {
    enabled: req.body.enabled,
    intervalMinutes: req.body.intervalMinutes,
    reminderMode: req.body.reminderMode,
    pokeText: req.body.pokeText,
    libraryId: req.body.libraryId,
    targetDeviceId: req.body.targetDeviceId,
    dailyGoalMl: req.body.dailyGoalMl,
    glassMl: req.body.glassMl,
  });
  if ('error' in result) return res.status(result.status).json({ error: result.error });
  res.json(result.status);
});

// POST /api/me/water/drink
router.post('/me/water/drink', requireNotBanned, validate(waterDrinkSchema), (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const result = waterService.logDrink(user.id, req.body.amountMl);
  res.json(result);
});

// PATCH /api/me/devices/:deviceId
router.patch(
  '/me/devices/:deviceId',
  requireNotBanned,
  validateParams(meDeviceIdParamSchema),
  validate(meDeviceSettingsSchema),
  (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const deviceId = req.params.deviceId as string;
    const claim = claimService.getClaimByDevice(deviceId);
    if (!claim || claim.userId !== user.id) {
      return res.status(403).json({ error: 'You can only update your own devices' });
    }
    claimService.setShowInGlobal(deviceId, !!req.body.showInGlobal);
    res.json({
      deviceId,
      showInGlobal: claimService.getShowInGlobal(deviceId),
    });
  }
);

// GET /api/me/animation-grants
router.get('/me/animation-grants', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const grants = animationService.listGrantsForOwner(user.id).map((g) => ({
    id: g.id,
    deviceId: g.deviceId,
    granteeType: g.granteeType,
    granteeId: g.granteeType === 'user' ? ensurePublicUserId(g.granteeId) : g.granteeId,
    createdAt: g.createdAt,
  }));
  res.json({ grants });
});

// GET /api/me/animation-targets — devices others granted you access to animate
router.get('/me/animation-targets', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  res.json({ targets: animationService.listAnimationTargetsForUser(user.id) });
});

// POST /api/me/animation-grants
router.post('/me/animation-grants', requireNotBanned, validate(createAnimationGrantSchema), (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  let granteeId = req.body.granteeId as string;
  if (req.body.granteeType === 'user') {
    const internal = getUserIdFromPublicId(granteeId);
    if (!internal) return res.status(404).json({ error: 'User not found' });
    granteeId = internal;
  }
  const result = animationService.createGrant({
    ownerUserId: user.id,
    deviceId: req.body.deviceId ?? null,
    granteeType: req.body.granteeType,
    granteeId,
  });
  if ('error' in result) return res.status(result.status).json({ error: result.error });
  res.status(201).json({
    grant: {
      id: result.id,
      deviceId: result.deviceId,
      granteeType: result.granteeType,
      granteeId:
        result.granteeType === 'user' ? ensurePublicUserId(result.granteeId) : result.granteeId,
      createdAt: result.createdAt,
    },
  });
});

// DELETE /api/me/animation-grants/:grantId
router.delete(
  '/me/animation-grants/:grantId',
  requireNotBanned,
  validateParams(grantIdParamSchema),
  (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const result = animationService.deleteGrant(req.params.grantId as string, user.id);
    if ('error' in result) return res.status(result.status).json({ error: result.error });
    res.json({ ok: true });
  }
);

// POST /api/devices/:deviceId/animation
router.post(
  '/devices/:deviceId/animation',
  requireNotBanned,
  validateParams(meDeviceIdParamSchema),
  validate(setAnimationSchema),
  (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const result = animationService.pushAnimationToDevice(user.id, req.params.deviceId as string, {
      libraryId: req.body.libraryId,
      filename: req.body.filename,
      animationId: req.body.animationId,
    });
    if ('error' in result) return res.status(result.status).json({ error: result.error });
    res.json({ ok: true });
  }
);

// GET /api/me/bots
router.get('/me/bots', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const links = botService.listLinks(user.id).map((l) => ({
    platform: l.platform,
    linked: !!(l.platformChatId && l.linkedAt),
    platformUsername: l.platformUsername,
    linkedAt: l.linkedAt,
  }));
  res.json({ links });
});

// POST /api/me/bots/:platform/link
router.post('/me/bots/:platform/link', requireNotBanned, validateParams(botPlatformParamSchema), (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const platform = req.params.platform as botService.BotPlatform;
  if (platform !== 'telegram') {
    return res.status(501).json({ error: 'This platform is not available yet' });
  }
  const { verifyCode, expiresAt } = botService.startLink(user.id, platform);
  res.json({
    verifyCode,
    expiresAt,
    instructions: `Open the QBIT Telegram bot and send: /start ${verifyCode}`,
  });
});

// DELETE /api/me/bots/:platform
router.delete('/me/bots/:platform', requireNotBanned, validateParams(botPlatformParamSchema), (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  botService.unlink(user.id, req.params.platform as botService.BotPlatform);
  res.json({ ok: true });
});

// GET /api/me/profile (dashboard summary fields)
router.get('/me/profile', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  res.json({
    publicUserId: ensurePublicUserId(user.id),
    displayName: user.displayName,
    email: user.email,
    avatar: user.avatar,
    isGlobal: socialService.getIsGlobal(user.id),
  });
});

export default router;
