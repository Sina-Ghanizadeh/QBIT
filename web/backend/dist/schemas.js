"use strict";
// ---------------------------------------------------------------------------
//  Zod input-validation schemas for all API endpoints
// ---------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.claimTokenParamSchema = exports.adminReportIdParamSchema = exports.adminDeviceIdParamSchema = exports.adminUserIdParamSchema = exports.friendUserIdParamSchema = exports.adminBroadcastSchema = exports.reportSchema = exports.adminDevicesDeleteSchema = exports.adminBanSchema = exports.adminLoginSchema = exports.libraryBatchSchema = exports.botPlatformParamSchema = exports.setAnimationSchema = exports.grantIdParamSchema = exports.createAnimationGrantSchema = exports.memberDecisionSchema = exports.joinByCodeSchema = exports.groupIdParamSchema = exports.createGroupSchema = exports.meDeviceIdParamSchema = exports.meDeviceSettingsSchema = exports.meSettingsSchema = exports.friendRequestSchema = exports.claimSchema = exports.pokeUserSchema = exports.pokeSchema = void 0;
const zod_1 = require("zod");
// Shared: opaque poke token (24 hex); used for poke/claim/friend target and DELETE /claim/:token
const pokeTokenSchema = zod_1.z.string().length(24).regex(/^[a-f0-9]+$/);
// POST /api/poke
exports.pokeSchema = zod_1.z.object({
    targetId: pokeTokenSchema,
    text: zod_1.z.string().min(1).max(25),
    senderBitmap: zod_1.z.string().optional(),
    senderBitmapWidth: zod_1.z.number().int().positive().optional(),
    textBitmap: zod_1.z.string().optional(),
    textBitmapWidth: zod_1.z.number().int().positive().optional(),
});
// POST /api/poke/user (targetPublicUserId: opaque id, not raw Google id)
exports.pokeUserSchema = zod_1.z.object({
    targetPublicUserId: zod_1.z.string().length(24).regex(/^[a-f0-9]+$/),
    text: zod_1.z.string().min(1).max(25),
});
// POST /api/claim
exports.claimSchema = zod_1.z.object({
    targetId: pokeTokenSchema,
    deviceIdFull: zod_1.z.string().min(1).max(256).regex(/^[a-zA-Z0-9:]+$/),
});
// POST /api/friends/request (same body as claim: target poke token + deviceIdFull to confirm)
exports.friendRequestSchema = zod_1.z.object({
    targetId: pokeTokenSchema,
    deviceIdFull: zod_1.z.string().min(1).max(256).regex(/^[a-zA-Z0-9:]+$/),
});
// PATCH /api/me/settings (partial: either or both)
exports.meSettingsSchema = zod_1.z.object({
    onlyFriendsCanPoke: zod_1.z.boolean().optional(),
    publicFriends: zod_1.z.boolean().optional(),
    isGlobal: zod_1.z.boolean().optional(),
}).refine((d) => d.onlyFriendsCanPoke !== undefined ||
    d.publicFriends !== undefined ||
    d.isGlobal !== undefined, {
    message: 'At least one of onlyFriendsCanPoke, publicFriends, or isGlobal is required',
});
// PATCH /api/me/devices/:deviceId
exports.meDeviceSettingsSchema = zod_1.z.object({
    showInGlobal: zod_1.z.boolean(),
});
exports.meDeviceIdParamSchema = zod_1.z.object({
    deviceId: zod_1.z.string().min(1).max(128).regex(/^[a-zA-Z0-9:_-]+$/),
});
// Groups
exports.createGroupSchema = zod_1.z.object({
    name: zod_1.z.string().min(1).max(64).transform((s) => s.trim()).pipe(zod_1.z.string().min(1)),
    description: zod_1.z.string().max(280).optional(),
    visibility: zod_1.z.enum(['public', 'private']),
});
exports.groupIdParamSchema = zod_1.z.object({
    groupId: zod_1.z.string().length(24).regex(/^[a-f0-9]+$/),
});
exports.joinByCodeSchema = zod_1.z.object({
    code: zod_1.z.string().min(4).max(16).transform((s) => s.trim().toUpperCase()),
});
exports.memberDecisionSchema = zod_1.z.object({
    userPublicId: zod_1.z.string().length(24).regex(/^[a-f0-9]+$/),
    decision: zod_1.z.enum(['approved', 'rejected']),
});
// Animation grants
exports.createAnimationGrantSchema = zod_1.z.object({
    deviceId: zod_1.z.string().min(1).max(128).regex(/^[a-zA-Z0-9:_-]+$/).nullable().optional(),
    granteeType: zod_1.z.enum(['user', 'group']),
    granteeId: zod_1.z.string().min(1).max(64), // publicUserId (24 hex) or groupId (24 hex)
});
exports.grantIdParamSchema = zod_1.z.object({
    grantId: zod_1.z.string().length(24).regex(/^[a-f0-9]+$/),
});
exports.setAnimationSchema = zod_1.z.object({
    libraryId: zod_1.z.string().min(1).max(128).optional(),
    filename: zod_1.z.string().min(1).max(256).optional(),
    animationId: zod_1.z.string().min(1).max(128).optional(),
}).refine((d) => d.libraryId || d.filename || d.animationId, {
    message: 'libraryId, filename, or animationId is required',
});
// Bot link
exports.botPlatformParamSchema = zod_1.z.object({
    platform: zod_1.z.enum(['telegram', 'bale']),
});
// DELETE /api/library/batch  &  POST /api/library/batch-download
exports.libraryBatchSchema = zod_1.z.object({
    ids: zod_1.z.array(zod_1.z.string().min(1).max(128).regex(/^[a-zA-Z0-9-]+$/)).min(1).max(100),
});
// POST /api/admin/login
exports.adminLoginSchema = zod_1.z.object({
    username: zod_1.z.string().min(1).max(64),
    password: zod_1.z.string().min(8).max(128),
});
// POST /api/ban  &  DELETE /api/ban
exports.adminBanSchema = zod_1.z
    .object({
    userId: zod_1.z.string().max(256).regex(/^[a-zA-Z0-9@._+-]+$/).optional(),
    ip: zod_1.z.string().max(45).regex(/^[0-9a-fA-F:.]+$/).optional(),
    deviceId: zod_1.z.string().max(128).regex(/^[a-zA-Z0-9-]+$/).optional(),
})
    .refine((data) => data.userId || data.ip || data.deviceId, {
    message: 'At least one of userId, ip, or deviceId is required',
});
// DELETE /api/devices (admin batch delete device records)
exports.adminDevicesDeleteSchema = zod_1.z.object({
    deviceIds: zod_1.z.array(zod_1.z.string().min(1).max(128).regex(/^[a-zA-Z0-9-]+$/)).min(1).max(100),
});
// POST /api/report (reportedPublicUserId: opaque id)
exports.reportSchema = zod_1.z.object({
    reportedPublicUserId: zod_1.z.string().length(24).regex(/^[a-f0-9]+$/),
    description: zod_1.z.string().max(500).transform((s) => s.trim()).pipe(zod_1.z.string().min(1)),
});
// POST /api/admin/broadcast (optional bitmaps for Chinese/any language, same as poke)
exports.adminBroadcastSchema = zod_1.z.object({
    text: zod_1.z.string().min(1).max(100),
    senderBitmap: zod_1.z.string().optional(),
    senderBitmapWidth: zod_1.z.number().int().positive().optional(),
    textBitmap: zod_1.z.string().optional(),
    textBitmapWidth: zod_1.z.number().int().positive().optional(),
});
// DELETE /api/friends/:userId (param value is publicUserId, opaque hex)
exports.friendUserIdParamSchema = zod_1.z.object({
    userId: zod_1.z.string().length(24).regex(/^[a-f0-9]+$/),
});
// Admin path params (validate to avoid malformed IDs)
exports.adminUserIdParamSchema = zod_1.z.object({
    userId: zod_1.z.string().min(1).max(256).regex(/^[a-zA-Z0-9@._+-]+$/),
});
exports.adminDeviceIdParamSchema = zod_1.z.object({
    deviceId: zod_1.z.string().min(1).max(128).regex(/^[a-zA-Z0-9-]+$/),
});
exports.adminReportIdParamSchema = zod_1.z.object({
    id: zod_1.z.string().regex(/^\d+$/),
});
// DELETE /api/claim/:token (opaque poke token, not raw device id)
exports.claimTokenParamSchema = zod_1.z.object({
    token: pokeTokenSchema,
});
//# sourceMappingURL=schemas.js.map