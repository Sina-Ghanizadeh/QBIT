"use strict";
// ---------------------------------------------------------------------------
//  Socket.io service -- online web users tracking
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
exports.getOnlineUsersList = getOnlineUsersList;
exports.getOnlineUserIds = getOnlineUserIds;
exports.getOnlineUsersMap = getOnlineUsersMap;
exports.broadcastOnlineUsers = broadcastOnlineUsers;
exports.broadcastDeviceList = broadcastDeviceList;
exports.getSessionsList = getSessionsList;
exports.disconnectUserSockets = disconnectUserSockets;
exports.disconnectUserSocketsByIp = disconnectUserSocketsByIp;
exports.getIo = getIo;
exports.emitToUser = emitToUser;
exports.setupSocketIo = setupSocketIo;
const socket_io_1 = require("socket.io");
const config_1 = require("../config");
const ban_service_1 = require("./ban.service");
const userService = __importStar(require("./user.service"));
const deviceService = __importStar(require("./device.service"));
const publicUserId_service_1 = require("./publicUserId.service");
const logger_1 = __importDefault(require("../logger"));
// ---------------------------------------------------------------------------
//  State
// ---------------------------------------------------------------------------
const onlineUsers = new Map();
// Throttle ban-rejection log
const bannedUserLogLast = new Map();
const BANNED_LOG_INTERVAL_MS = 5 * 60 * 1000;
let io;
// ---------------------------------------------------------------------------
//  Public helpers
// ---------------------------------------------------------------------------
function getOnlineUsersList() {
    const byUserId = new Map();
    for (const u of onlineUsers.values()) {
        const existing = byUserId.get(u.userId);
        if (existing) {
            existing.socketIds.push(u.socketId);
        }
        else {
            byUserId.set(u.userId, {
                publicUserId: (0, publicUserId_service_1.ensurePublicUserId)(u.userId),
                displayName: u.displayName,
                avatar: u.avatar || undefined,
                connectedAt: u.connectedAt.toISOString(),
                socketIds: [u.socketId],
            });
        }
    }
    return Array.from(byUserId.values());
}
function getOnlineUserIds() {
    const ids = new Set();
    for (const u of onlineUsers.values())
        ids.add(u.userId);
    return ids;
}
function getOnlineUsersMap() {
    return onlineUsers;
}
function broadcastOnlineUsers() {
    io?.emit('users:update', getOnlineUsersList());
}
function broadcastDeviceList() {
    io?.emit('devices:update', deviceService.getDeviceList());
}
function getSessionsList() {
    return Array.from(onlineUsers.values()).map((u) => ({
        socketId: u.socketId,
        userId: u.userId,
        displayName: u.displayName,
        email: u.email,
        avatar: u.avatar || '',
        ip: u.ip,
        connectedAt: u.connectedAt.toISOString(),
    }));
}
function disconnectUserSockets(userId) {
    const toDisconnect = Array.from(onlineUsers.entries())
        .filter(([, u]) => u.userId === userId)
        .map(([sid]) => sid);
    for (const sid of toDisconnect) {
        const s = io.sockets.sockets.get(sid);
        if (s)
            s.disconnect(true);
        onlineUsers.delete(sid);
    }
    broadcastOnlineUsers();
}
function disconnectUserSocketsByIp(ip) {
    const toDisconnect = Array.from(onlineUsers.entries())
        .filter(([, u]) => u.ip === ip)
        .map(([sid]) => sid);
    for (const sid of toDisconnect) {
        const s = io.sockets.sockets.get(sid);
        if (s)
            s.disconnect(true);
        onlineUsers.delete(sid);
    }
    if (toDisconnect.length > 0)
        broadcastOnlineUsers();
    return toDisconnect.length;
}
function getIo() {
    return io;
}
/** Emit an event to all sockets belonging to a user (by userId). */
function emitToUser(userId, event, data) {
    if (!io)
        return;
    for (const [sid, u] of onlineUsers.entries()) {
        if (u.userId === userId) {
            const s = io.sockets.sockets.get(sid);
            if (s)
                s.emit(event, data);
        }
    }
}
// ---------------------------------------------------------------------------
//  Setup
// ---------------------------------------------------------------------------
function setupSocketIo(httpServer, sessionMiddleware) {
    io = new socket_io_1.Server(httpServer, {
        cors: { origin: config_1.ALLOW_ANY_ORIGIN ? true : config_1.FRONTEND_URL, credentials: true },
        maxHttpBufferSize: 1024 * 1024, // 1MB limit per message
    });
    // Share session with Socket.io
    io.engine.use(sessionMiddleware);
    // Wire broadcast callback so device service can push updates
    deviceService.setBroadcastCallback(() => {
        io.emit('devices:update', deviceService.getDeviceList());
    });
    io.on('connection', (socket) => {
        // Send current device and user lists on connect
        socket.emit('devices:update', deviceService.getDeviceList());
        socket.emit('users:update', getOnlineUsersList());
        const req = socket.request;
        const clientIp = deviceService.extractPublicIp(req);
        // Session stores only the user ID (string) after the serializeUser security fix.
        // Passport's deserializeUser does NOT run for socket.io (only sessionMiddleware does),
        // so we must manually look up the full user from the database.
        const sessionData = socket.request
            ?.session?.passport?.user;
        const passportUser = typeof sessionData === 'string'
            ? userService.getUserById(sessionData) ?? undefined
            : typeof sessionData === 'object' && sessionData && 'id' in sessionData
                ? sessionData
                : undefined;
        if (passportUser && passportUser.id) {
            if ((0, ban_service_1.isBanned)(passportUser.id, clientIp)) {
                socket.disconnect(true);
                const banKey = `${passportUser.id}:${clientIp}`;
                const now = Date.now();
                const last = bannedUserLogLast.get(banKey) ?? 0;
                if (now - last >= BANNED_LOG_INTERVAL_MS) {
                    bannedUserLogLast.set(banKey, now);
                    logger_1.default.info({ userId: passportUser.id, ip: clientIp }, 'Banned user/IP rejected');
                }
                return;
            }
            onlineUsers.set(socket.id, {
                socketId: socket.id,
                userId: passportUser.id,
                displayName: passportUser.displayName || 'Unknown',
                email: passportUser.email || '',
                avatar: passportUser.avatar || '',
                ip: clientIp,
                connectedAt: new Date(),
            });
            userService.upsertUser(passportUser.id, {
                displayName: passportUser.displayName || 'Unknown',
                email: passportUser.email || '',
                avatar: passportUser.avatar || '',
            });
            logger_1.default.info({ userId: passportUser.id, displayName: passportUser.displayName }, 'User online');
            broadcastOnlineUsers();
        }
        socket.on('disconnect', (reason) => {
            const user = onlineUsers.get(socket.id);
            if (user) {
                onlineUsers.delete(socket.id);
                userService.setUserOffline(user.userId);
                logger_1.default.info({ userId: user.userId, displayName: user.displayName }, 'User offline');
                broadcastOnlineUsers();
            }
        });
    });
    return io;
}
//# sourceMappingURL=socket.service.js.map