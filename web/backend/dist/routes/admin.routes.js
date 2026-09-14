"use strict";
// ---------------------------------------------------------------------------
//  Admin routes -- login, sessions, users, devices, bans
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
const crypto_1 = __importDefault(require("crypto"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const validate_1 = require("../middleware/validate");
const schemas_1 = require("../schemas");
const config_1 = require("../config");
const banService = __importStar(require("../services/ban.service"));
const claimService = __importStar(require("../services/claim.service"));
const userService = __importStar(require("../services/user.service"));
const deviceService = __importStar(require("../services/device.service"));
const reportService = __importStar(require("../services/report.service"));
const socketService = __importStar(require("../services/socket.service"));
const logger_1 = __importDefault(require("../logger"));
const router = (0, express_1.Router)();
// ---------------------------------------------------------------------------
//  Admin auth middleware
// ---------------------------------------------------------------------------
function adminAuth(req, res, next) {
    const s = req.session;
    if (s?.admin === true) {
        next();
        return;
    }
    res.status(401).json({ error: 'Login required' });
}
// ---------------------------------------------------------------------------
//  Constant-time comparison for admin token
// ---------------------------------------------------------------------------
function timingSafeCompare(a, b) {
    // Pad both to the same length to avoid leaking length info
    const maxLen = Math.max(a.length, b.length);
    const bufA = Buffer.alloc(maxLen);
    const bufB = Buffer.alloc(maxLen);
    bufA.write(a);
    bufB.write(b);
    return crypto_1.default.timingSafeEqual(bufA, bufB) && a.length === b.length;
}
// ---------------------------------------------------------------------------
//  Rate limiter for login
// ---------------------------------------------------------------------------
const adminLoginLimiter = (0, express_rate_limit_1.default)({
    windowMs: config_1.ADMIN_LOGIN_RATE_LIMIT.windowMs,
    max: config_1.ADMIN_LOGIN_RATE_LIMIT.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Try again later.' },
});
// ---------------------------------------------------------------------------
//  Login / Logout
// ---------------------------------------------------------------------------
// POST /api/admin/login
router.post('/admin/login', adminLoginLimiter, (0, validate_1.validate)(schemas_1.adminLoginSchema), (req, res) => {
    const { username, password } = req.body;
    const validUser = timingSafeCompare(username, config_1.ADMIN_USERNAME);
    const validPass = timingSafeCompare(password, config_1.ADMIN_PASSWORD);
    if (!validUser || !validPass) {
        logger_1.default.warn({ username }, 'Failed admin login attempt');
        setTimeout(() => {
            res.status(401).json({ error: 'Invalid username or password' });
        }, config_1.FAILED_LOGIN_DELAY_MS);
        return;
    }
    req.session.admin = true;
    req.session.save((err) => {
        if (err)
            return res.status(500).json({ error: 'Session error' });
        res.status(200).json({ ok: true });
    });
});
// POST /api/admin/logout
router.post('/admin/logout', (req, res) => {
    req.session.destroy(() => {
        res.clearCookie('qbit_admin_sid', { path: '/' });
        res.status(200).json({ ok: true });
    });
});
// ---------------------------------------------------------------------------
//  Protected admin API routes
// ---------------------------------------------------------------------------
router.get('/sessions', adminAuth, (_req, res) => {
    res.json(socketService.getSessionsList());
});
router.get('/users', adminAuth, (req, res) => {
    const onlineIds = socketService.getOnlineUserIds();
    const limitParam = req.query.limit;
    const offsetParam = req.query.offset;
    if (limitParam === undefined && offsetParam === undefined) {
        return res.json(userService.getAllUsers(onlineIds));
    }
    const limit = Math.min(100, Math.max(1, parseInt(String(limitParam), 10) || 20));
    const offset = Math.max(0, parseInt(String(offsetParam), 10) || 0);
    const sortBy = req.query.sort_by || 'lastSeen';
    const order = req.query.order === 'asc' ? 'asc' : 'desc';
    const q = req.query.q || '';
    const validSort = ['userId', 'displayName', 'email', 'lastSeen'].includes(sortBy) ? sortBy : 'lastSeen';
    const result = userService.getUsersPaginated(onlineIds, {
        q: q.trim() || undefined,
        sortBy: validSort,
        order,
        limit,
        offset,
    });
    res.json(result);
});
router.delete('/users/:userId', adminAuth, (0, validate_1.validateParams)(schemas_1.adminUserIdParamSchema), (req, res) => {
    const userId = req.params.userId;
    const deleted = userService.deleteUser(userId);
    if (!deleted)
        return res.status(404).json({ error: 'User not found' });
    logger_1.default.info({ userId }, 'User record deleted');
    res.json({ ok: true });
});
router.get('/devices', adminAuth, (_req, res) => {
    res.json(deviceService.getDeviceRecordList());
});
router.delete('/devices', adminAuth, (0, validate_1.validate)(schemas_1.adminDevicesDeleteSchema), (req, res) => {
    const { deviceIds } = req.body;
    deviceService.deleteDeviceRecords(deviceIds);
    logger_1.default.info({ deviceIds }, 'Device records deleted');
    res.json({ ok: true });
});
router.get('/claims', adminAuth, (_req, res) => {
    const claims = claimService.getAllClaims();
    const recordList = deviceService.getDeviceRecordList();
    const nameByDevice = new Map(recordList.map((r) => [r.id, r.name]));
    const list = Object.entries(claims).map(([deviceId, c]) => ({
        deviceId,
        deviceName: deviceService.getDevicesRaw().get(deviceId)?.name ?? nameByDevice.get(deviceId) ?? null,
        userId: c.userId,
        userName: c.userName,
        userAvatar: c.userAvatar,
        claimedAt: c.claimedAt,
    }));
    res.json(list);
});
router.get('/bans', adminAuth, (_req, res) => {
    res.json(banService.getBanList());
});
router.post('/ban', adminAuth, (0, validate_1.validate)(schemas_1.adminBanSchema), (req, res) => {
    const { userId, ip, deviceId } = req.body;
    banService.addBan(userId, ip, deviceId);
    if (userId)
        socketService.disconnectUserSockets(userId);
    if (deviceId)
        deviceService.disconnectDevice(deviceId);
    if (ip) {
        const disconnectedUsers = socketService.disconnectUserSocketsByIp(ip);
        const disconnectedDevices = deviceService.disconnectDevicesByIp(ip);
        logger_1.default.info({ ip, disconnectedUsers, disconnectedDevices }, 'IP ban: disconnected existing connections');
    }
    logger_1.default.info({ userId, ip, deviceId }, 'Ban added');
    res.json({ ok: true });
});
router.delete('/ban', adminAuth, (0, validate_1.validate)(schemas_1.adminBanSchema), (req, res) => {
    const { userId, ip, deviceId } = req.body;
    banService.removeBan(userId, ip, deviceId);
    logger_1.default.info({ userId, ip, deviceId }, 'Ban removed');
    res.json({ ok: true });
});
router.delete('/claim/:deviceId', adminAuth, (0, validate_1.validateParams)(schemas_1.adminDeviceIdParamSchema), (req, res) => {
    const deviceId = req.params.deviceId;
    const claim = claimService.getClaimByDevice(deviceId);
    if (!claim)
        return res.status(404).json({ error: 'No claim found for this device' });
    claimService.removeClaim(deviceId);
    const pendingFriend = deviceService.clearPendingFriendRequest(deviceId);
    if (pendingFriend) {
        socketService.emitToUser(pendingFriend.requesterUserId, 'friend_request:result', { result: 'cancelled' });
    }
    deviceService.broadcastDevices();
    logger_1.default.info({ deviceId }, 'Claim removed by admin');
    res.json({ ok: true });
});
// GET /api/reports -- list all user reports
router.get('/reports', adminAuth, (_req, res) => {
    res.json(reportService.getAllReports());
});
// DELETE /api/reports/:id -- delete a report after review
router.delete('/reports/:id', adminAuth, (0, validate_1.validateParams)(schemas_1.adminReportIdParamSchema), (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    if (!reportService.deleteReport(id))
        return res.status(404).json({ error: 'Report not found' });
    logger_1.default.info({ reportId: id }, 'Report deleted by admin');
    res.json({ ok: true });
});
// POST /api/broadcast -- send message to all online QBIT devices (title "[ NOTIFY ]", source QBIT-NETWORK)
router.post('/broadcast', adminAuth, (0, validate_1.validate)(schemas_1.adminBroadcastSchema), (req, res) => {
    const { text, senderBitmap, senderBitmapWidth, textBitmap, textBitmapWidth } = req.body;
    const payload = {
        type: 'broadcast',
        sender: 'QBIT-NETWORK',
        title: 'NOTIFY',
        text: text.substring(0, 100),
    };
    if (senderBitmap && textBitmap && senderBitmapWidth && textBitmapWidth) {
        payload.senderBitmap = senderBitmap;
        payload.senderBitmapWidth = senderBitmapWidth;
        payload.textBitmap = textBitmap;
        payload.textBitmapWidth = textBitmapWidth;
    }
    deviceService.broadcastToAllDevices(payload);
    logger_1.default.info({ text: payload.text }, 'Admin broadcast sent to all devices');
    res.json({ ok: true });
});
exports.default = router;
//# sourceMappingURL=admin.routes.js.map