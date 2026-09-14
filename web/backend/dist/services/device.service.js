"use strict";
// ---------------------------------------------------------------------------
//  Device service -- WebSocket server, device state, heartbeat
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
exports.setBroadcastCallback = setBroadcastCallback;
exports.getDeviceList = getDeviceList;
exports.getDeviceRecordList = getDeviceRecordList;
exports.deleteDeviceRecords = deleteDeviceRecords;
exports.broadcastDevices = broadcastDevices;
exports.broadcastToAllDevices = broadcastToAllDevices;
exports.getDevice = getDevice;
exports.getDeviceCount = getDeviceCount;
exports.getDevicesRaw = getDevicesRaw;
exports.getDeviceByPokeToken = getDeviceByPokeToken;
exports.disconnectDevice = disconnectDevice;
exports.disconnectDevicesByIp = disconnectDevicesByIp;
exports.getPendingClaim = getPendingClaim;
exports.hasPendingClaim = hasPendingClaim;
exports.setPendingClaim = setPendingClaim;
exports.clearPendingClaim = clearPendingClaim;
exports.getPendingFriendRequest = getPendingFriendRequest;
exports.hasPendingFriendRequest = hasPendingFriendRequest;
exports.setPendingFriendRequest = setPendingFriendRequest;
exports.clearPendingFriendRequest = clearPendingFriendRequest;
exports.extractPublicIp = extractPublicIp;
exports.setupWebSocketServer = setupWebSocketServer;
exports.getWss = getWss;
exports.closeAll = closeAll;
const crypto_1 = __importDefault(require("crypto"));
const ws_1 = require("ws");
const config_1 = require("../config");
const ban_service_1 = require("./ban.service");
const claimService = __importStar(require("./claim.service"));
const friendService = __importStar(require("./friend.service"));
const socketService = __importStar(require("./socket.service"));
const publicUserId_service_1 = require("./publicUserId.service");
const db_1 = __importDefault(require("../db"));
const logger_1 = __importDefault(require("../logger"));
// Device records (persisted for admin: online + offline)
const stmtRecordUpsert = db_1.default.prepare('INSERT OR REPLACE INTO device_records (deviceId, name, ip, publicIp, version, lastSeen, status) VALUES (?, ?, ?, ?, ?, ?, ?)');
const stmtRecordUpdateOffline = db_1.default.prepare('UPDATE device_records SET status = ?, lastSeen = ? WHERE deviceId = ?');
const stmtRecordAll = db_1.default.prepare('SELECT deviceId, name, ip, publicIp, version, lastSeen, status FROM device_records');
const stmtRecordDelete = db_1.default.prepare('DELETE FROM device_records WHERE deviceId = ?');
// ---------------------------------------------------------------------------
//  State
// ---------------------------------------------------------------------------
const devices = new Map();
const pendingClaims = new Map();
const pendingFriendRequests = new Map();
// Throttle ban-rejection log to avoid log flood
const bannedDeviceLogLast = new Map();
const BANNED_LOG_INTERVAL_MS = 5 * 60 * 1000;
// Throttle per-IP limit rejection log (same interval)
const perIpLimitLogLast = new Map();
// Broadcast callback -- set by index.ts after Socket.io is ready
let broadcastCallback = null;
function setBroadcastCallback(cb) {
    broadcastCallback = cb;
}
// ---------------------------------------------------------------------------
//  Public helpers
// ---------------------------------------------------------------------------
function getDeviceList() {
    return Array.from(devices.values()).map((d) => {
        const claim = claimService.getClaimByDevice(d.id);
        return {
            id: d.id,
            pokeToken: d.pokeToken,
            name: d.name,
            ip: d.ip,
            publicIp: d.publicIp,
            version: d.version,
            connectedAt: d.connectedAt.toISOString(),
            claimedBy: claim
                ? { publicUserId: (0, publicUserId_service_1.ensurePublicUserId)(claim.userId), userName: claim.userName, userAvatar: claim.userAvatar }
                : null,
        };
    });
}
function getDeviceRecordList() {
    const now = new Date().toISOString();
    const rows = stmtRecordAll.all();
    const liveMap = new Map(Array.from(devices.entries()).map(([id, d]) => [id, d]));
    return rows.map((r) => {
        const live = liveMap.get(r.deviceId);
        if (live) {
            return {
                id: r.deviceId,
                name: live.name,
                ip: live.ip,
                publicIp: live.publicIp,
                version: live.version,
                lastSeen: live.connectedAt.toISOString(),
                status: 'online',
            };
        }
        return {
            id: r.deviceId,
            name: r.name,
            ip: r.ip,
            publicIp: r.publicIp ?? undefined,
            version: r.version,
            lastSeen: r.lastSeen,
            status: (r.status === 'online' ? 'online' : 'offline'),
        };
    });
}
function deleteDeviceRecords(deviceIds) {
    for (const id of deviceIds) {
        stmtRecordDelete.run(id);
        const dev = devices.get(id);
        if (dev) {
            dev.ws.close();
            devices.delete(id);
        }
    }
    if (deviceIds.length > 0)
        broadcastDevices();
}
function broadcastDevices() {
    broadcastCallback?.();
}
/** Send a JSON payload to all connected QBIT devices (e.g. broadcast message like poke). */
function broadcastToAllDevices(payload) {
    const data = JSON.stringify(payload);
    for (const [, dev] of devices) {
        if (dev.ws.readyState === 1) {
            try {
                dev.ws.send(data);
            }
            catch {
                // ignore per-device send errors
            }
        }
    }
}
function getDevice(id) {
    return devices.get(id);
}
function getDeviceCount() {
    return devices.size;
}
function getDevicesRaw() {
    return devices;
}
function getDeviceByPokeToken(token) {
    for (const dev of devices.values()) {
        if (dev.pokeToken === token)
            return dev;
    }
    return undefined;
}
function disconnectDevice(deviceId) {
    const dev = devices.get(deviceId);
    if (dev) {
        dev.ws.close();
        devices.delete(deviceId);
        broadcastDevices();
    }
}
function disconnectDevicesByIp(ip) {
    const toDisconnect = [];
    for (const [id, dev] of devices) {
        if (dev.publicIp === ip)
            toDisconnect.push(id);
    }
    for (const id of toDisconnect) {
        const dev = devices.get(id);
        if (dev)
            dev.ws.close();
        devices.delete(id);
    }
    if (toDisconnect.length > 0)
        broadcastDevices();
    return toDisconnect.length;
}
// ---------------------------------------------------------------------------
//  Pending claims
// ---------------------------------------------------------------------------
function getPendingClaim(deviceId) {
    return pendingClaims.get(deviceId);
}
function hasPendingClaim(deviceId) {
    return pendingClaims.has(deviceId);
}
function setPendingClaim(deviceId, claim) {
    pendingClaims.set(deviceId, claim);
}
function clearPendingClaim(deviceId) {
    const pending = pendingClaims.get(deviceId);
    if (pending) {
        clearTimeout(pending.timer);
        pendingClaims.delete(deviceId);
    }
}
// ---------------------------------------------------------------------------
//  Pending friend requests (device owner confirms on device)
// ---------------------------------------------------------------------------
function getPendingFriendRequest(deviceId) {
    return pendingFriendRequests.get(deviceId);
}
function hasPendingFriendRequest(deviceId) {
    return pendingFriendRequests.has(deviceId);
}
function setPendingFriendRequest(deviceId, request) {
    pendingFriendRequests.set(deviceId, request);
}
/** Returns the pending request if one was cleared, so caller can notify requester. */
function clearPendingFriendRequest(deviceId) {
    const pending = pendingFriendRequests.get(deviceId);
    if (pending) {
        clearTimeout(pending.timer);
        pendingFriendRequests.delete(deviceId);
        return pending;
    }
    return undefined;
}
// ---------------------------------------------------------------------------
//  Extract public IP from request
// ---------------------------------------------------------------------------
function extractPublicIp(request) {
    const xff = request.headers['x-forwarded-for'];
    if (xff) {
        const first = (Array.isArray(xff) ? xff[0] : xff).split(',')[0].trim();
        if (first)
            return first;
    }
    const cfIp = request.headers['cf-connecting-ip'];
    if (cfIp)
        return Array.isArray(cfIp) ? cfIp[0] : cfIp;
    return request.socket.remoteAddress || '';
}
// ---------------------------------------------------------------------------
//  WebSocket server setup
// ---------------------------------------------------------------------------
let wss;
function setupWebSocketServer(httpServer) {
    wss = new ws_1.WebSocketServer({ noServer: true });
    // Log startup warning if DEVICE_API_KEY is empty
    if (!config_1.DEVICE_API_KEY) {
        logger_1.default.warn('DEVICE_API_KEY is empty -- all device WebSocket connections will be REJECTED');
    }
    httpServer.on('upgrade', (request, socket, head) => {
        const url = new URL(request.url || '/', `http://${request.headers.host}`);
        if (url.pathname === '/device') {
            // --- Device API Key validation via Authorization header ---
            // Header format: "Bearer <DEVICE_API_KEY>"
            const authHeader = request.headers['authorization'] || '';
            const key = authHeader.replace(/^Bearer\s+/i, '').trim();
            if (!config_1.DEVICE_API_KEY || key !== config_1.DEVICE_API_KEY) {
                logger_1.default.warn({ ip: request.socket.remoteAddress }, 'Device WS rejected: invalid or missing API key');
                socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
                socket.destroy();
                return;
            }
            // --- Connection count limit ---
            if (wss.clients.size >= config_1.MAX_DEVICE_CONNECTIONS) {
                logger_1.default.warn('Device WS rejected: max connections reached');
                socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
                socket.destroy();
                return;
            }
            wss.handleUpgrade(request, socket, head, (ws) => {
                wss.emit('connection', ws, request);
            });
        }
        // Other paths (e.g. /socket.io/) are handled by Socket.io automatically.
    });
    // --- Connection handler ---
    wss.on('connection', (ws, request) => {
        let deviceId = null;
        const publicIp = extractPublicIp(request);
        // Per-socket heartbeat: each socket gets its own 30s timer starting from
        // connection time. Terminate only after 3 consecutive missed pongs (~90s
        // of silence) so transient pong delays through the Cloudflare Tunnel do
        // not kill a healthy connection.
        let missedPongs = 0;
        const pingTimer = setInterval(() => {
            if (missedPongs >= 3) {
                clearInterval(pingTimer);
                logger_1.default.warn({ deviceId }, 'Device WS terminate: pong timeout');
                ws.terminate();
                return;
            }
            missedPongs += 1;
            try {
                ws.ping();
            }
            catch { /* socket already gone */ }
        }, 30_000);
        ws.on('message', (raw) => {
            const rawSize = (() => {
                if (typeof raw === 'string')
                    return Buffer.byteLength(raw);
                if (Array.isArray(raw))
                    return raw.reduce((sum, part) => sum + part.length, 0);
                if (raw instanceof ArrayBuffer)
                    return raw.byteLength;
                return raw.byteLength;
            })();
            // Limit message size to 1MB to prevent memory exhaustion
            if (rawSize > 1024 * 1024) {
                logger_1.default.warn({ deviceId, ip: publicIp }, 'Device WS message exceeds size limit (1MB)');
                ws.close(1009, 'Message too large');
                return;
            }
            try {
                const msg = JSON.parse(raw.toString());
                if (msg.type === 'device.register' && msg.id) {
                    deviceId = msg.id;
                    if ((0, ban_service_1.isBannedDevice)(msg.id) || (0, ban_service_1.isBanned)(undefined, publicIp)) {
                        const now = Date.now();
                        const last = bannedDeviceLogLast.get(msg.id) ?? 0;
                        if (now - last >= BANNED_LOG_INTERVAL_MS) {
                            bannedDeviceLogLast.set(msg.id, now);
                            logger_1.default.warn({ deviceId: msg.id, publicIp }, 'Device WS rejected: banned (device or IP)');
                        }
                        ws.close();
                        return;
                    }
                    // Per-IP device limit (QBIT devices only; does not affect web users)
                    if (config_1.MAX_DEVICE_CONNECTIONS_PER_IP > 0) {
                        const sameIpCount = [...devices.values()].filter((d) => d.publicIp === publicIp && d.id !== msg.id).length;
                        if (sameIpCount >= config_1.MAX_DEVICE_CONNECTIONS_PER_IP) {
                            const now = Date.now();
                            const last = perIpLimitLogLast.get(publicIp) ?? 0;
                            if (now - last >= BANNED_LOG_INTERVAL_MS) {
                                perIpLimitLogLast.set(publicIp, now);
                                logger_1.default.warn({ publicIp, limit: config_1.MAX_DEVICE_CONNECTIONS_PER_IP }, 'Device WS rejected: max devices per IP reached');
                            }
                            ws.close();
                            return;
                        }
                    }
                    // If device reconnects, close the stale socket
                    const existing = devices.get(msg.id);
                    if (existing && existing.ws !== ws) {
                        existing.ws.close();
                    }
                    const connectedAt = existing?.ws === ws ? existing.connectedAt : new Date();
                    const name = msg.name || msg.id;
                    const version = msg.version || '1.0.0';
                    const ip = msg.ip || '';
                    devices.set(msg.id, {
                        id: msg.id,
                        name,
                        ip,
                        publicIp,
                        version,
                        ws,
                        connectedAt,
                        pokeToken: existing?.pokeToken ?? crypto_1.default.randomBytes(12).toString('hex'),
                    });
                    const lastSeen = connectedAt.toISOString();
                    stmtRecordUpsert.run(msg.id, name, ip, publicIp, version, lastSeen, 'online');
                    broadcastDevices();
                    logger_1.default.info({ deviceId: msg.id, name: msg.name, localIp: msg.ip, publicIp }, 'Device online');
                }
                // Handle claim confirmation from device
                if (msg.type === 'claim_confirm' && deviceId) {
                    const pending = pendingClaims.get(deviceId);
                    if (pending) {
                        clearTimeout(pending.timer);
                        pendingClaims.delete(deviceId);
                        const claim = {
                            userId: pending.userId,
                            userName: pending.userName,
                            userAvatar: pending.userAvatar,
                            claimedAt: new Date().toISOString(),
                        };
                        claimService.setClaim(deviceId, claim);
                        broadcastDevices();
                        socketService.emitToUser(pending.userId, 'claim:result', { result: 'accepted' });
                        logger_1.default.info({ deviceId, userName: pending.userName }, 'Device claimed');
                    }
                }
                if (msg.type === 'claim_reject' && deviceId) {
                    const pending = pendingClaims.get(deviceId);
                    if (pending) {
                        clearTimeout(pending.timer);
                        pendingClaims.delete(deviceId);
                        socketService.emitToUser(pending.userId, 'claim:result', { result: 'rejected' });
                        logger_1.default.info({ deviceId, userName: pending.userName }, 'Device claim rejected');
                    }
                }
                if (msg.type === 'friend_confirm' && deviceId) {
                    const pending = pendingFriendRequests.get(deviceId);
                    if (pending) {
                        const claim = claimService.getClaimByDevice(deviceId);
                        if (claim?.userId !== pending.ownerUserId) {
                            clearPendingFriendRequest(deviceId);
                            logger_1.default.warn({ deviceId, pendingOwner: pending.ownerUserId, currentOwner: claim?.userId }, 'Friend confirm ignored: device owner changed since request');
                            socketService.emitToUser(pending.requesterUserId, 'friend_request:result', { result: 'cancelled' });
                        }
                        else {
                            clearTimeout(pending.timer);
                            pendingFriendRequests.delete(deviceId);
                            friendService.addFriend(pending.ownerUserId, pending.requesterUserId);
                            broadcastDevices();
                            socketService.emitToUser(pending.ownerUserId, 'friends:update');
                            socketService.emitToUser(pending.requesterUserId, 'friends:update');
                            socketService.emitToUser(pending.requesterUserId, 'friend_request:result', { result: 'accepted' });
                            logger_1.default.info({ deviceId, owner: pending.ownerUserId, friend: pending.requesterUserId }, 'Friend added via device confirm');
                        }
                    }
                }
                if (msg.type === 'friend_reject' && deviceId) {
                    const pending = pendingFriendRequests.get(deviceId);
                    if (pending) {
                        clearTimeout(pending.timer);
                        pendingFriendRequests.delete(deviceId);
                        socketService.emitToUser(pending.requesterUserId, 'friend_request:result', { result: 'rejected' });
                        logger_1.default.info({ deviceId, requester: pending.requesterUserId }, 'Friend request rejected');
                    }
                }
            }
            catch (e) {
                logger_1.default.error({ err: e }, 'Invalid device message');
            }
        });
        ws.on('close', () => {
            clearInterval(pingTimer);
            if (deviceId) {
                const registered = devices.get(deviceId);
                if (registered && registered.ws === ws) {
                    const now = new Date().toISOString();
                    stmtRecordUpdateOffline.run('offline', now, deviceId);
                    devices.delete(deviceId);
                    broadcastDevices();
                    logger_1.default.info({ deviceId }, 'Device offline');
                }
            }
        });
        ws.on('pong', () => {
            missedPongs = 0;
        });
    });
    return wss;
}
function getWss() {
    return wss;
}
/**
 * Close all device WebSocket connections (for graceful shutdown).
 */
function closeAll() {
    if (wss) {
        // Per-socket heartbeat timers are cleared by each socket's 'close' handler.
        wss.clients.forEach((ws) => ws.close());
        wss.close();
    }
}
//# sourceMappingURL=device.service.js.map