"use strict";
// ---------------------------------------------------------------------------
//  Opaque public user id (stable, not reversible to Google userId)
// ---------------------------------------------------------------------------
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensurePublicUserId = ensurePublicUserId;
exports.getUserIdFromPublicId = getUserIdFromPublicId;
const crypto_1 = __importDefault(require("crypto"));
const db_1 = __importDefault(require("../db"));
const stmtGet = db_1.default.prepare('SELECT publicId FROM user_public_ids WHERE userId = ?');
const stmtGetByPublic = db_1.default.prepare('SELECT userId FROM user_public_ids WHERE publicId = ?');
const stmtInsert = db_1.default.prepare('INSERT INTO user_public_ids (userId, publicId) VALUES (?, ?)');
function generatePublicId() {
    return crypto_1.default.randomBytes(12).toString('hex');
}
function ensurePublicUserId(userId) {
    const row = stmtGet.get(userId);
    if (row)
        return row.publicId;
    let publicId = generatePublicId();
    for (let i = 0; i < 5; i++) {
        try {
            stmtInsert.run(userId, publicId);
            return publicId;
        }
        catch {
            // Race: another request may have inserted same userId; re-read and return if present
            const again = stmtGet.get(userId);
            if (again)
                return again.publicId;
            publicId = generatePublicId();
        }
    }
    throw new Error('Failed to generate unique public user id');
}
function getUserIdFromPublicId(publicId) {
    const row = stmtGetByPublic.get(publicId);
    return row?.userId ?? null;
}
//# sourceMappingURL=publicUserId.service.js.map