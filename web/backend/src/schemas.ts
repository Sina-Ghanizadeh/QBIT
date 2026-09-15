// ---------------------------------------------------------------------------
//  Zod input-validation schemas for all API endpoints
// ---------------------------------------------------------------------------

import { z } from 'zod';

// Shared: opaque poke token (24 hex); used for poke/claim/friend target and DELETE /claim/:token
const pokeTokenSchema = z.string().length(24).regex(/^[a-f0-9]+$/);

// POST /api/poke
export const pokeSchema = z.object({
  targetId: pokeTokenSchema,
  text: z.string().min(1).max(25),
  senderBitmap: z.string().optional(),
  senderBitmapWidth: z.number().int().positive().optional(),
  textBitmap: z.string().optional(),
  textBitmapWidth: z.number().int().positive().optional(),
});

// POST /api/poke/user (targetPublicUserId: opaque id, not raw Google id)
export const pokeUserSchema = z.object({
  targetPublicUserId: z.string().length(24).regex(/^[a-f0-9]+$/),
  text: z.string().min(1).max(25),
});

// POST /api/claim
export const claimSchema = z.object({
  targetId: pokeTokenSchema,
  deviceIdFull: z.string().min(1).max(256).regex(/^[a-zA-Z0-9:]+$/),
});

// POST /api/friends/request (same body as claim: target poke token + deviceIdFull to confirm)
export const friendRequestSchema = z.object({
  targetId: pokeTokenSchema,
  deviceIdFull: z.string().min(1).max(256).regex(/^[a-zA-Z0-9:]+$/),
});

// PATCH /api/me/settings (partial: either or both)
export const meSettingsSchema = z.object({
  onlyFriendsCanPoke: z.boolean().optional(),
  publicFriends: z.boolean().optional(),
  isGlobal: z.boolean().optional(),
}).refine(
  (d) =>
    d.onlyFriendsCanPoke !== undefined ||
    d.publicFriends !== undefined ||
    d.isGlobal !== undefined,
  {
    message: 'At least one of onlyFriendsCanPoke, publicFriends, or isGlobal is required',
  }
);

// PATCH /api/me/devices/:deviceId
export const meDeviceSettingsSchema = z.object({
  showInGlobal: z.boolean(),
});
export const meDeviceIdParamSchema = z.object({
  deviceId: z.string().min(1).max(128).regex(/^[a-zA-Z0-9:_-]+$/),
});

// Groups
export const createGroupSchema = z.object({
  name: z.string().min(1).max(64).transform((s) => s.trim()).pipe(z.string().min(1)),
  description: z.string().max(280).optional(),
  visibility: z.enum(['public', 'private']),
});
export const groupIdParamSchema = z.object({
  groupId: z.string().length(24).regex(/^[a-f0-9]+$/),
});
export const joinByCodeSchema = z.object({
  code: z.string().min(4).max(16).transform((s) => s.trim().toUpperCase()),
});
export const memberDecisionSchema = z.object({
  userPublicId: z.string().length(24).regex(/^[a-f0-9]+$/),
  decision: z.enum(['approved', 'rejected']),
});

// Animation grants
export const createAnimationGrantSchema = z.object({
  deviceId: z.string().min(1).max(128).regex(/^[a-zA-Z0-9:_-]+$/).nullable().optional(),
  granteeType: z.enum(['user', 'group']),
  granteeId: z.string().min(1).max(64), // publicUserId (24 hex) or groupId (24 hex)
});
export const grantIdParamSchema = z.object({
  grantId: z.string().length(24).regex(/^[a-f0-9]+$/),
});
export const setAnimationSchema = z.object({
  libraryId: z.string().min(1).max(128).optional(),
  filename: z.string().min(1).max(256).optional(),
  animationId: z.string().min(1).max(128).optional(),
}).refine((d) => d.libraryId || d.filename || d.animationId, {
  message: 'libraryId, filename, or animationId is required',
});

// Bot link
export const botPlatformParamSchema = z.object({
  platform: z.enum(['telegram', 'bale']),
});


// DELETE /api/library/batch  &  POST /api/library/batch-download
export const libraryBatchSchema = z.object({
  ids: z.array(z.string().min(1).max(128).regex(/^[a-zA-Z0-9-]+$/)).min(1).max(100),
});

export const libraryTagsSchema = z.object({
  tags: z.array(z.string().min(1).max(32)).max(8),
});

export const createScheduleSchema = z.object({
  targetType: z.enum(['device', 'user']),
  targetId: z.string().min(1).max(128),
  text: z.string().min(1).max(25),
  cronType: z.enum(['daily', 'weekly']),
  timeUtc: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
  weekday: z.number().int().min(0).max(6).nullable().optional(),
});

export const updateScheduleSchema = z.object({
  text: z.string().min(1).max(25).optional(),
  cronType: z.enum(['daily', 'weekly']).optional(),
  timeUtc: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).optional(),
  weekday: z.number().int().min(0).max(6).nullable().optional(),
  enabled: z.boolean().optional(),
});

export const scheduleIdParamSchema = z.object({
  id: z.string().length(24).regex(/^[a-f0-9]+$/),
});

export const waterSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  intervalMinutes: z.number().int().min(15).max(720).optional(),
  reminderMode: z.enum(['poke', 'gif', 'both']).optional(),
  pokeText: z.string().min(1).max(25).optional(),
  libraryId: z.string().min(1).max(128).nullable().optional(),
  targetDeviceId: z.string().min(1).max(128).nullable().optional(),
  dailyGoalMl: z.number().int().min(250).max(10000).optional(),
  glassMl: z.number().int().min(50).max(1000).optional(),
}).refine(
  (d) =>
    d.enabled !== undefined ||
    d.intervalMinutes !== undefined ||
    d.reminderMode !== undefined ||
    d.pokeText !== undefined ||
    d.libraryId !== undefined ||
    d.targetDeviceId !== undefined ||
    d.dailyGoalMl !== undefined ||
    d.glassMl !== undefined,
  { message: 'At least one water setting field is required' }
);

export const waterDrinkSchema = z.object({
  amountMl: z.number().int().min(50).max(2000).optional(),
});



// POST /api/admin/login
export const adminLoginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(8).max(128),
});

// POST /api/ban  &  DELETE /api/ban
export const adminBanSchema = z
  .object({
    userId: z.string().max(256).regex(/^[a-zA-Z0-9@._+-]+$/).optional(),
    ip: z.string().max(45).regex(/^[0-9a-fA-F:.]+$/).optional(),
    deviceId: z.string().max(128).regex(/^[a-zA-Z0-9-]+$/).optional(),
  })
  .refine((data) => data.userId || data.ip || data.deviceId, {
    message: 'At least one of userId, ip, or deviceId is required',
  });

// DELETE /api/devices (admin batch delete device records)
export const adminDevicesDeleteSchema = z.object({
  deviceIds: z.array(z.string().min(1).max(128).regex(/^[a-zA-Z0-9-]+$/)).min(1).max(100),
});

// POST /api/report (reportedPublicUserId: opaque id)
export const reportSchema = z.object({
  reportedPublicUserId: z.string().length(24).regex(/^[a-f0-9]+$/),
  description: z.string().max(500).transform((s) => s.trim()).pipe(z.string().min(1)),
});

// POST /api/admin/broadcast (optional bitmaps for Chinese/any language, same as poke)
export const adminBroadcastSchema = z.object({
  text: z.string().min(1).max(100),
  senderBitmap: z.string().optional(),
  senderBitmapWidth: z.number().int().positive().optional(),
  textBitmap: z.string().optional(),
  textBitmapWidth: z.number().int().positive().optional(),
});

// DELETE /api/friends/:userId (param value is publicUserId, opaque hex)
export const friendUserIdParamSchema = z.object({
  userId: z.string().length(24).regex(/^[a-f0-9]+$/),
});

// Admin path params (validate to avoid malformed IDs)
export const adminUserIdParamSchema = z.object({
  userId: z.string().min(1).max(256).regex(/^[a-zA-Z0-9@._+-]+$/),
});
export const adminDeviceIdParamSchema = z.object({
  deviceId: z.string().min(1).max(128).regex(/^[a-zA-Z0-9-]+$/),
});
export const adminReportIdParamSchema = z.object({
  id: z.string().regex(/^\d+$/),
});

// DELETE /api/claim/:token (opaque poke token, not raw device id)
export const claimTokenParamSchema = z.object({
  token: pokeTokenSchema,
});
