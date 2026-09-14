"use strict";
// ---------------------------------------------------------------------------
//  Ban service -- SQLite-backed with in-memory Set cache for O(1) lookups
// ---------------------------------------------------------------------------
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isBanned = isBanned;
exports.isBannedDevice = isBannedDevice;
exports.addBan = addBan;
exports.removeBan = removeBan;
exports.getBanList = getBanList;
const db_1 = __importDefault(require("../db"));
const logger_1 = __importDefault(require("../logger"));
// In-memory cache: Map<type, Set<value>>
const cache = new Map([
    ['userId', new Set()],
    ['ip', new Set()],
    ['deviceId', new Set()],
]);
// Prepared statements
const stmtInsert = db_1.default.prepare('INSERT OR IGNORE INTO bans (type, value) VALUES (?, ?)');
const stmtDelete = db_1.default.prepare('DELETE FROM bans WHERE type = ? AND value = ?');
const stmtSelectAll = db_1.default.prepare('SELECT type, value FROM bans');
// ---------------------------------------------------------------------------
//  Load cache from SQLite at startup
// ---------------------------------------------------------------------------
function loadCache() {
    for (const set of cache.values())
        set.clear();
    const rows = stmtSelectAll.all();
    for (const row of rows) {
        cache.get(row.type)?.add(row.value);
    }
    logger_1.default.info({
        userIds: cache.get('userId').size,
        ips: cache.get('ip').size,
        deviceIds: cache.get('deviceId').size,
    }, 'Ban cache loaded');
}
loadCache();
// ---------------------------------------------------------------------------
//  Public API
// ---------------------------------------------------------------------------
function isBanned(userId, ip) {
    if (userId && cache.get('userId').has(userId))
        return true;
    if (ip && cache.get('ip').has(ip))
        return true;
    return false;
}
function isBannedDevice(deviceId) {
    return cache.get('deviceId').has(deviceId);
}
function addBan(userId, ip, deviceId) {
    const tx = db_1.default.transaction(() => {
        if (userId) {
            stmtInsert.run('userId', userId);
            cache.get('userId').add(userId);
        }
        if (ip) {
            stmtInsert.run('ip', ip);
            cache.get('ip').add(ip);
        }
        if (deviceId) {
            stmtInsert.run('deviceId', deviceId);
            cache.get('deviceId').add(deviceId);
        }
    });
    tx();
}
function removeBan(userId, ip, deviceId) {
    const tx = db_1.default.transaction(() => {
        if (userId) {
            stmtDelete.run('userId', userId);
            cache.get('userId').delete(userId);
        }
        if (ip) {
            stmtDelete.run('ip', ip);
            cache.get('ip').delete(ip);
        }
        if (deviceId) {
            stmtDelete.run('deviceId', deviceId);
            cache.get('deviceId').delete(deviceId);
        }
    });
    tx();
}
function getBanList() {
    return {
        userIds: [...cache.get('userId')],
        ips: [...cache.get('ip')],
        deviceIds: [...cache.get('deviceId')],
    };
}
//# sourceMappingURL=ban.service.js.map