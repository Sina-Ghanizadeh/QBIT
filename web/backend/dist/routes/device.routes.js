"use strict";
// ---------------------------------------------------------------------------
//  Device routes -- /api/devices, /api/poke, /api/poke/user, /api/claim
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const validate_1 = require("../middleware/validate");
const requireNotBanned_1 = require("../middleware/requireNotBanned");
const schemas_1 = require("../schemas");
const deviceService = __importStar(require("../services/device.service"));
const claimService = __importStar(require("../services/claim.service"));
const friendService = __importStar(require("../services/friend.service"));
const socialService = __importStar(require("../services/social.service"));
const userService = __importStar(require("../services/user.service"));
const socketService = __importStar(require("../services/socket.service"));
const publicUserId_service_1 = require("../services/publicUserId.service");
const logger_1 = __importDefault(require("../logger"));
const router = (0, express_1.Router)();
// GET /api/devices
router.get('/devices', (req, res) => {
    if (!req.isAuthenticated()) {
        return res.status(401).json({ error: 'Login required' });
    }
    res.json(deviceService.getDeviceList());
});
// POST /api/poke -- poke a device
router.post('/poke', requireNotBanned_1.requireNotBanned, (0, validate_1.validate)(schemas_1.pokeSchema), (req, res) => {
    if (!req.isAuthenticated()) {
        return res.status(401).json({ error: 'Login required to poke' });
    }
    const user = req.user;
    const { targetId, text, senderBitmap, senderBitmapWidth, textBitmap, textBitmapWidth } = req.body;
    const device = deviceService.getDeviceByPokeToken(targetId);
    if (!device) {
        return res.status(404).json({ error: 'Device not found or offline' });
    }
    const claim = claimService.getClaimByDevice(device.id);
    if (claim) {
        if (friendService.getOnlyFriendsCanPoke(claim.userId)) {
            if (!friendService.areFriends(claim.userId, user.id)) {
                return res.status(403).json({ error: 'Only friends can poke this QBIT' });
            }
        }
        else {
            const reason = socialService.canPokeReason(user.id, claim.userId);
            if (reason) {
                return res.status(403).json({ error: reason });
            }
        }
    }
    const pokePayload = {
        type: 'poke',
        sender: user.displayName || 'Anonymous',
        text: String(text).substring(0, 25),
    };
    if (senderBitmap && senderBitmapWidth) {
        pokePayload.senderBitmap = senderBitmap;
        pokePayload.senderBitmapWidth = senderBitmapWidth;
    }
    if (textBitmap && textBitmapWidth) {
        pokePayload.textBitmap = textBitmap;
        pokePayload.textBitmapWidth = textBitmapWidth;
    }
    device.ws.send(JSON.stringify(pokePayload));
    const io = socketService.getIo();
    if (io)
        io.emit('poke:highlight', { deviceToken: targetId });
    logger_1.default.info({ sender: user.displayName, target: device.name }, 'Poke sent');
    res.json({ ok: true });
});
// POST /api/poke/user -- poke another web user (target by publicUserId)
router.post('/poke/user', requireNotBanned_1.requireNotBanned, (0, validate_1.validate)(schemas_1.pokeUserSchema), (req, res) => {
    if (!req.isAuthenticated()) {
        return res.status(401).json({ error: 'Login required to poke' });
    }
    const sender = req.user;
    const { targetPublicUserId, text } = req.body;
    const textStr = String(text).substring(0, 25);
    const targetUserId = (0, publicUserId_service_1.getUserIdFromPublicId)(targetPublicUserId);
    if (!targetUserId) {
        return res.status(404).json({ error: 'User not found' });
    }
    const reason = socialService.canPokeReason(sender.id, targetUserId);
    if (reason) {
        return res.status(403).json({ error: reason });
    }
    const onlineUsersMap = socketService.getOnlineUsersMap();
    const targetSocketIds = [];
    for (const u of onlineUsersMap.values()) {
        if (u.userId === targetUserId)
            targetSocketIds.push(u.socketId);
    }
    if (targetSocketIds.length === 0) {
        return res.status(404).json({ error: 'User not found or offline' });
    }
    const io = socketService.getIo();
    const payload = {
        from: sender.displayName || 'Anonymous',
        fromPublicUserId: (0, publicUserId_service_1.ensurePublicUserId)(sender.id),
        text: textStr,
    };
    for (const sid of targetSocketIds) {
        const s = io.sockets.sockets.get(sid);
        if (s)
            s.emit('poke', payload);
    }
    io.emit('poke:highlight', { publicUserId: targetPublicUserId });
    logger_1.default.info({ sender: sender.displayName, targetUserId }, 'User poke sent');
    res.json({ ok: true });
});
// POST /api/claim (targetId is opaque poke token)
router.post('/claim', requireNotBanned_1.requireNotBanned, (0, validate_1.validate)(schemas_1.claimSchema), (req, res) => {
    if (!req.isAuthenticated()) {
        return res.status(401).json({ error: 'Login required' });
    }
    const { targetId, deviceIdFull } = req.body;
    const device = deviceService.getDeviceByPokeToken(targetId);
    if (!device) {
        return res.status(404).json({ error: 'Device not found or offline' });
    }
    if (device.id !== deviceIdFull) {
        return res.status(400).json({ error: 'Device ID does not match' });
    }
    if (claimService.getClaimByDevice(device.id)) {
        return res.status(409).json({ error: 'Device already claimed' });
    }
    if (deviceService.hasPendingClaim(device.id)) {
        return res.status(409).json({ error: 'A claim request is already pending for this device' });
    }
    const user = req.user;
    device.ws.send(JSON.stringify({
        type: 'claim_request',
        userName: user.displayName || 'Unknown',
        userAvatar: user.avatar || '',
    }));
    const timer = setTimeout(() => {
        const pending = deviceService.getPendingClaim(device.id);
        deviceService.clearPendingClaim(device.id);
        if (pending)
            socketService.emitToUser(pending.userId, 'claim:result', { result: 'timeout' });
        logger_1.default.info({ deviceId: device.id }, 'Claim request timed out');
    }, 30_000);
    deviceService.setPendingClaim(device.id, {
        userId: user.id,
        userName: user.displayName || 'Unknown',
        userAvatar: user.avatar || '',
        timer,
    });
    logger_1.default.info({ user: user.displayName, device: device.name }, 'Claim request sent');
    res.json({ ok: true, status: 'pending' });
});
// DELETE /api/claim/:token (opaque poke token; device must be online to unclaim)
router.delete('/claim/:token', requireNotBanned_1.requireNotBanned, (0, validate_1.validateParams)(schemas_1.claimTokenParamSchema), (req, res) => {
    if (!req.isAuthenticated()) {
        return res.status(401).json({ error: 'Login required' });
    }
    const user = req.user;
    const token = req.params.token;
    const device = deviceService.getDeviceByPokeToken(token);
    if (!device) {
        return res.status(404).json({ error: 'Device not found or offline' });
    }
    const claim = claimService.getClaimByDevice(device.id);
    if (!claim) {
        return res.status(404).json({ error: 'No claim found for this device' });
    }
    if (claim.userId !== user.id) {
        return res.status(403).json({ error: 'You can only unclaim your own devices' });
    }
    claimService.removeClaim(device.id);
    const pendingFriend = deviceService.clearPendingFriendRequest(device.id);
    if (pendingFriend) {
        socketService.emitToUser(pendingFriend.requesterUserId, 'friend_request:result', { result: 'cancelled' });
    }
    deviceService.broadcastDevices();
    res.json({ ok: true });
});
// GET /api/friends (returns publicUserIds and displayName per friend, from users table so names show when offline)
router.get('/friends', (req, res) => {
    if (!req.isAuthenticated()) {
        return res.status(401).json({ error: 'Login required' });
    }
    const user = req.user;
    const internalIds = friendService.getFriendIds(user.id);
    const friends = internalIds.map((userId) => {
        const publicUserId = (0, publicUserId_service_1.ensurePublicUserId)(userId);
        const u = userService.getUserById(userId);
        return { publicUserId, displayName: u?.displayName ?? 'Friend', avatar: u?.avatar ?? '' };
    });
    res.json({ friendIds: friends.map((f) => f.publicUserId), friends });
});
// GET /api/friends/pairs -- friend pairs where both users have "public friends" on (publicUserIds)
router.get('/friends/pairs', (_req, res) => {
    const pairs = friendService.getPublicFriendPairs();
    const friendPairs = pairs.map(({ a, b }) => ({
        a: (0, publicUserId_service_1.ensurePublicUserId)(a),
        b: (0, publicUserId_service_1.ensurePublicUserId)(b),
    }));
    res.json({ friendPairs });
});
// POST /api/friends/request (targetId is opaque poke token)
router.post('/friends/request', requireNotBanned_1.requireNotBanned, (0, validate_1.validate)(schemas_1.friendRequestSchema), (req, res) => {
    if (!req.isAuthenticated()) {
        return res.status(401).json({ error: 'Login required' });
    }
    const user = req.user;
    const { targetId, deviceIdFull } = req.body;
    const device = deviceService.getDeviceByPokeToken(targetId);
    if (!device) {
        return res.status(404).json({ error: 'Device not found or offline' });
    }
    if (device.id !== deviceIdFull) {
        return res.status(400).json({ error: 'Device ID does not match' });
    }
    const claim = claimService.getClaimByDevice(device.id);
    if (!claim) {
        return res.status(400).json({ error: 'This QBIT is not claimed; only the owner can add friends' });
    }
    if (claim.userId === user.id) {
        return res.status(400).json({ error: 'You cannot add yourself as a friend' });
    }
    if (friendService.areFriends(claim.userId, user.id)) {
        return res.status(409).json({ error: 'Already friends' });
    }
    if (deviceService.hasPendingFriendRequest(device.id)) {
        return res.status(409).json({ error: 'A friend request is already pending for this device' });
    }
    device.ws.send(JSON.stringify({
        type: 'friend_request',
        userName: user.displayName || 'Unknown',
        userAvatar: user.avatar || '',
    }));
    const timer = setTimeout(() => {
        const pending = deviceService.clearPendingFriendRequest(device.id);
        if (pending) {
            socketService.emitToUser(pending.requesterUserId, 'friend_request:result', { result: 'timeout' });
            logger_1.default.info({ deviceId: device.id }, 'Friend request timed out');
        }
    }, 30_000);
    deviceService.setPendingFriendRequest(device.id, {
        ownerUserId: claim.userId,
        requesterUserId: user.id,
        requesterName: user.displayName || 'Unknown',
        requesterAvatar: user.avatar || '',
        timer,
    });
    logger_1.default.info({ requester: user.displayName, device: device.name, owner: claim.userId }, 'Friend request sent');
    res.json({ ok: true, status: 'pending' });
});
// DELETE /api/friends/:userId (param is publicUserId)
router.delete('/friends/:userId', requireNotBanned_1.requireNotBanned, (0, validate_1.validateParams)(schemas_1.friendUserIdParamSchema), (req, res) => {
    if (!req.isAuthenticated()) {
        return res.status(401).json({ error: 'Login required' });
    }
    const user = req.user;
    const friendPublicId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
    if (!friendPublicId) {
        return res.status(400).json({ error: 'Friend id required' });
    }
    const friendUserId = (0, publicUserId_service_1.getUserIdFromPublicId)(friendPublicId);
    if (!friendUserId) {
        return res.status(404).json({ error: 'User not found' });
    }
    if (friendUserId === user.id) {
        return res.status(400).json({ error: 'Cannot remove yourself' });
    }
    if (!friendService.areFriends(user.id, friendUserId)) {
        return res.status(404).json({ error: 'Not friends with this user' });
    }
    friendService.removeFriend(user.id, friendUserId);
    res.json({ ok: true });
});
// GET /api/me/settings
router.get('/me/settings', (req, res) => {
    if (!req.isAuthenticated()) {
        return res.status(401).json({ error: 'Login required' });
    }
    const user = req.user;
    const onlyFriendsCanPoke = friendService.getOnlyFriendsCanPoke(user.id);
    const publicFriends = friendService.getPublicFriends(user.id);
    const isGlobal = socialService.getIsGlobal(user.id);
    res.json({ onlyFriendsCanPoke, publicFriends, isGlobal });
});
// PATCH /api/me/settings
router.patch('/me/settings', requireNotBanned_1.requireNotBanned, (0, validate_1.validate)(schemas_1.meSettingsSchema), (req, res) => {
    if (!req.isAuthenticated()) {
        return res.status(401).json({ error: 'Login required' });
    }
    const user = req.user;
    const { onlyFriendsCanPoke, publicFriends, isGlobal } = req.body;
    if (onlyFriendsCanPoke !== undefined)
        friendService.setOnlyFriendsCanPoke(user.id, onlyFriendsCanPoke);
    if (publicFriends !== undefined)
        friendService.setPublicFriends(user.id, publicFriends);
    if (isGlobal !== undefined)
        socialService.setIsGlobal(user.id, isGlobal);
    res.json({
        onlyFriendsCanPoke: friendService.getOnlyFriendsCanPoke(user.id),
        publicFriends: friendService.getPublicFriends(user.id),
        isGlobal: socialService.getIsGlobal(user.id),
    });
});
exports.default = router;
//# sourceMappingURL=device.routes.js.map