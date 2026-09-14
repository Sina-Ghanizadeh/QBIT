"use strict";
// ---------------------------------------------------------------------------
//  Network + me/devices + animation grants + bot link routes
// ---------------------------------------------------------------------------
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const validate_1 = require("../middleware/validate");
const requireNotBanned_1 = require("../middleware/requireNotBanned");
const schemas_1 = require("../schemas");
const networkService = __importStar(require("../services/network.service"));
const claimService = __importStar(require("../services/claim.service"));
const animationService = __importStar(require("../services/animation.service"));
const botService = __importStar(require("../services/bot.service"));
const socialService = __importStar(require("../services/social.service"));
const publicUserId_service_1 = require("../services/publicUserId.service");
const router = (0, express_1.Router)();
function requireUser(req, res) {
    if (!req.isAuthenticated()) {
        res.status(401).json({ error: 'Login required' });
        return null;
    }
    return req.user;
}
// GET /api/network/global
router.get('/network/global', (req, res) => {
    if (!requireUser(req, res))
        return;
    res.json(networkService.getGlobalNetwork());
});
// GET /api/network/groups/:groupId
router.get('/network/groups/:groupId', (0, validate_1.validateParams)(schemas_1.groupIdParamSchema), (req, res) => {
    const user = requireUser(req, res);
    if (!user)
        return;
    const result = networkService.getGroupNetwork(req.params.groupId, user.id);
    if ('error' in result)
        return res.status(result.status).json({ error: result.error });
    res.json(result);
});
// GET /api/me/devices
router.get('/me/devices', (req, res) => {
    const user = requireUser(req, res);
    if (!user)
        return;
    res.json({ devices: networkService.getMyDevices(user.id) });
});
// PATCH /api/me/devices/:deviceId
router.patch('/me/devices/:deviceId', requireNotBanned_1.requireNotBanned, (0, validate_1.validateParams)(schemas_1.meDeviceIdParamSchema), (0, validate_1.validate)(schemas_1.meDeviceSettingsSchema), (req, res) => {
    const user = requireUser(req, res);
    if (!user)
        return;
    const deviceId = req.params.deviceId;
    const claim = claimService.getClaimByDevice(deviceId);
    if (!claim || claim.userId !== user.id) {
        return res.status(403).json({ error: 'You can only update your own devices' });
    }
    claimService.setShowInGlobal(deviceId, !!req.body.showInGlobal);
    res.json({
        deviceId,
        showInGlobal: claimService.getShowInGlobal(deviceId),
    });
});
// GET /api/me/animation-grants
router.get('/me/animation-grants', (req, res) => {
    const user = requireUser(req, res);
    if (!user)
        return;
    const grants = animationService.listGrantsForOwner(user.id).map((g) => ({
        id: g.id,
        deviceId: g.deviceId,
        granteeType: g.granteeType,
        granteeId: g.granteeType === 'user' ? (0, publicUserId_service_1.ensurePublicUserId)(g.granteeId) : g.granteeId,
        createdAt: g.createdAt,
    }));
    res.json({ grants });
});
// POST /api/me/animation-grants
router.post('/me/animation-grants', requireNotBanned_1.requireNotBanned, (0, validate_1.validate)(schemas_1.createAnimationGrantSchema), (req, res) => {
    const user = requireUser(req, res);
    if (!user)
        return;
    let granteeId = req.body.granteeId;
    if (req.body.granteeType === 'user') {
        const internal = (0, publicUserId_service_1.getUserIdFromPublicId)(granteeId);
        if (!internal)
            return res.status(404).json({ error: 'User not found' });
        granteeId = internal;
    }
    const result = animationService.createGrant({
        ownerUserId: user.id,
        deviceId: req.body.deviceId ?? null,
        granteeType: req.body.granteeType,
        granteeId,
    });
    if ('error' in result)
        return res.status(result.status).json({ error: result.error });
    res.status(201).json({
        grant: {
            id: result.id,
            deviceId: result.deviceId,
            granteeType: result.granteeType,
            granteeId: result.granteeType === 'user' ? (0, publicUserId_service_1.ensurePublicUserId)(result.granteeId) : result.granteeId,
            createdAt: result.createdAt,
        },
    });
});
// DELETE /api/me/animation-grants/:grantId
router.delete('/me/animation-grants/:grantId', requireNotBanned_1.requireNotBanned, (0, validate_1.validateParams)(schemas_1.grantIdParamSchema), (req, res) => {
    const user = requireUser(req, res);
    if (!user)
        return;
    const result = animationService.deleteGrant(req.params.grantId, user.id);
    if ('error' in result)
        return res.status(result.status).json({ error: result.error });
    res.json({ ok: true });
});
// POST /api/devices/:deviceId/animation
router.post('/devices/:deviceId/animation', requireNotBanned_1.requireNotBanned, (0, validate_1.validateParams)(schemas_1.meDeviceIdParamSchema), (0, validate_1.validate)(schemas_1.setAnimationSchema), (req, res) => {
    const user = requireUser(req, res);
    if (!user)
        return;
    const result = animationService.pushAnimationToDevice(user.id, req.params.deviceId, {
        libraryId: req.body.libraryId,
        filename: req.body.filename,
        animationId: req.body.animationId,
    });
    if ('error' in result)
        return res.status(result.status).json({ error: result.error });
    res.json({ ok: true });
});
// GET /api/me/bots
router.get('/me/bots', (req, res) => {
    const user = requireUser(req, res);
    if (!user)
        return;
    const links = botService.listLinks(user.id).map((l) => ({
        platform: l.platform,
        linked: !!(l.platformChatId && l.linkedAt),
        platformUsername: l.platformUsername,
        linkedAt: l.linkedAt,
    }));
    res.json({ links });
});
// POST /api/me/bots/:platform/link
router.post('/me/bots/:platform/link', requireNotBanned_1.requireNotBanned, (0, validate_1.validateParams)(schemas_1.botPlatformParamSchema), (req, res) => {
    const user = requireUser(req, res);
    if (!user)
        return;
    const platform = req.params.platform;
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
router.delete('/me/bots/:platform', requireNotBanned_1.requireNotBanned, (0, validate_1.validateParams)(schemas_1.botPlatformParamSchema), (req, res) => {
    const user = requireUser(req, res);
    if (!user)
        return;
    botService.unlink(user.id, req.params.platform);
    res.json({ ok: true });
});
// GET /api/me/profile (dashboard summary fields)
router.get('/me/profile', (req, res) => {
    const user = requireUser(req, res);
    if (!user)
        return;
    res.json({
        publicUserId: (0, publicUserId_service_1.ensurePublicUserId)(user.id),
        displayName: user.displayName,
        email: user.email,
        avatar: user.avatar,
        isGlobal: socialService.getIsGlobal(user.id),
    });
});
exports.default = router;
//# sourceMappingURL=social.routes.js.map