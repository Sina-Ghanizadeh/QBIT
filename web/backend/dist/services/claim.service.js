"use strict";
// ---------------------------------------------------------------------------
//  Claim service -- SQLite-backed
// ---------------------------------------------------------------------------
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getClaimByDevice = getClaimByDevice;
exports.getShowInGlobal = getShowInGlobal;
exports.setShowInGlobal = setShowInGlobal;
exports.getAllClaims = getAllClaims;
exports.setClaim = setClaim;
exports.removeClaim = removeClaim;
const db_1 = __importDefault(require("../db"));
const stmtGet = db_1.default.prepare('SELECT * FROM claims WHERE deviceId = ?');
const stmtAll = db_1.default.prepare('SELECT * FROM claims');
const stmtInsert = db_1.default.prepare('INSERT OR REPLACE INTO claims (deviceId, userId, userName, userAvatar, claimedAt, showInGlobal) VALUES (?, ?, ?, ?, ?, COALESCE((SELECT showInGlobal FROM claims WHERE deviceId = ?), 0))');
const stmtDelete = db_1.default.prepare('DELETE FROM claims WHERE deviceId = ?');
const stmtSetShowInGlobal = db_1.default.prepare('UPDATE claims SET showInGlobal = ? WHERE deviceId = ?');
function getClaimByDevice(deviceId) {
    const row = stmtGet.get(deviceId);
    if (!row)
        return null;
    return { userId: row.userId, userName: row.userName, userAvatar: row.userAvatar, claimedAt: row.claimedAt };
}
function getShowInGlobal(deviceId) {
    const row = stmtGet.get(deviceId);
    return row ? (row.showInGlobal ?? 0) !== 0 : false;
}
function setShowInGlobal(deviceId, value) {
    const result = stmtSetShowInGlobal.run(value ? 1 : 0, deviceId);
    return result.changes > 0;
}
function getAllClaims() {
    const rows = stmtAll.all();
    const result = {};
    for (const row of rows) {
        result[row.deviceId] = {
            userId: row.userId,
            userName: row.userName,
            userAvatar: row.userAvatar,
            claimedAt: row.claimedAt,
        };
    }
    return result;
}
function setClaim(deviceId, claim) {
    stmtInsert.run(deviceId, claim.userId, claim.userName, claim.userAvatar, claim.claimedAt, deviceId);
}
function removeClaim(deviceId) {
    const result = stmtDelete.run(deviceId);
    return result.changes > 0;
}
//# sourceMappingURL=claim.service.js.map