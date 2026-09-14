"use strict";
// ---------------------------------------------------------------------------
//  Scoped network graph payloads (global / group)
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
exports.getGlobalNetwork = getGlobalNetwork;
exports.getGroupNetwork = getGroupNetwork;
exports.getMyDevices = getMyDevices;
const db_1 = __importDefault(require("../db"));
const claimService = __importStar(require("./claim.service"));
const deviceService = __importStar(require("./device.service"));
const groupService = __importStar(require("./group.service"));
const socialService = __importStar(require("./social.service"));
const userService = __importStar(require("./user.service"));
const socketService = __importStar(require("./socket.service"));
const publicUserId_service_1 = require("./publicUserId.service");
function onlineUserIdSet() {
    const set = new Set();
    for (const u of socketService.getOnlineUsersMap().values()) {
        set.add(u.userId);
    }
    return set;
}
function devicesForUser(userId, opts) {
    const claims = claimService.getAllClaims();
    const live = deviceService.getDevicesRaw();
    const out = [];
    for (const [deviceId, claim] of Object.entries(claims)) {
        if (claim.userId !== userId)
            continue;
        const showInGlobal = claimService.getShowInGlobal(deviceId);
        if (opts.globalOnly && !showInGlobal)
            continue;
        const liveDev = live.get(deviceId);
        out.push({
            deviceId,
            pokeToken: liveDev?.pokeToken ?? null,
            name: liveDev?.name ?? deviceId.slice(0, 8),
            online: !!liveDev,
            showInGlobal,
            version: liveDev?.version,
            connectedAt: liveDev?.connectedAt.toISOString(),
        });
    }
    return out;
}
function toUserNode(userId, online, globalOnly) {
    const u = userService.getUserById(userId);
    if (!u)
        return null;
    return {
        publicUserId: (0, publicUserId_service_1.ensurePublicUserId)(userId),
        displayName: u.displayName || 'User',
        avatar: u.avatar || '',
        isGlobal: socialService.getIsGlobal(userId),
        online: online.has(userId),
        devices: devicesForUser(userId, { globalOnly }),
    };
}
/** Users with isGlobal=true and their showInGlobal devices. */
function getGlobalNetwork() {
    const online = onlineUserIdSet();
    const rows = db_1.default
        .prepare('SELECT userId FROM user_settings WHERE isGlobal = 1')
        .all();
    const users = [];
    for (const r of rows) {
        const node = toUserNode(r.userId, online, true);
        if (node)
            users.push(node);
    }
    return { users };
}
function getGroupNetwork(groupId, viewerUserId) {
    if (!groupService.isApprovedMember(groupId, viewerUserId)) {
        return { error: 'You must be an approved member to view this group network', status: 403 };
    }
    const online = onlineUserIdSet();
    const memberIds = groupService.listApprovedMemberIds(groupId);
    const users = [];
    for (const userId of memberIds) {
        const node = toUserNode(userId, online, false);
        if (node)
            users.push(node);
    }
    return { users };
}
/** Devices claimed by a user (for dashboard). */
function getMyDevices(userId) {
    return devicesForUser(userId, { globalOnly: false });
}
//# sourceMappingURL=network.service.js.map