"use strict";
// ---------------------------------------------------------------------------
//  Bot account linking (Telegram phase 1; Bale-ready schema)
// ---------------------------------------------------------------------------
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.listLinks = listLinks;
exports.getLink = getLink;
exports.getLinkByChatId = getLinkByChatId;
exports.startLink = startLink;
exports.completeLink = completeLink;
exports.unlink = unlink;
const crypto_1 = __importDefault(require("crypto"));
const db_1 = __importDefault(require("../db"));
const VERIFY_TTL_MS = 10 * 60 * 1000;
const stmtUpsert = db_1.default.prepare(`
  INSERT INTO bot_links (userId, platform, platformChatId, platformUsername, linkedAt, verifyCode, verifyExpiresAt)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(userId, platform) DO UPDATE SET
    platformChatId = excluded.platformChatId,
    platformUsername = excluded.platformUsername,
    linkedAt = excluded.linkedAt,
    verifyCode = excluded.verifyCode,
    verifyExpiresAt = excluded.verifyExpiresAt
`);
const stmtGet = db_1.default.prepare('SELECT * FROM bot_links WHERE userId = ? AND platform = ?');
const stmtByUser = db_1.default.prepare('SELECT * FROM bot_links WHERE userId = ?');
const stmtByCode = db_1.default.prepare('SELECT * FROM bot_links WHERE platform = ? AND verifyCode = ?');
const stmtByChat = db_1.default.prepare('SELECT * FROM bot_links WHERE platform = ? AND platformChatId = ?');
const stmtDelete = db_1.default.prepare('DELETE FROM bot_links WHERE userId = ? AND platform = ?');
function newVerifyCode() {
    return crypto_1.default.randomBytes(4).toString('hex').toUpperCase();
}
function listLinks(userId) {
    return stmtByUser.all(userId);
}
function getLink(userId, platform) {
    return stmtGet.get(userId, platform) ?? null;
}
function getLinkByChatId(platform, chatId) {
    return stmtByChat.get(platform, chatId) ?? null;
}
/** Create / refresh a one-time link code for the logged-in user. */
function startLink(userId, platform) {
    const verifyCode = newVerifyCode();
    const expiresAt = new Date(Date.now() + VERIFY_TTL_MS).toISOString();
    const existing = getLink(userId, platform);
    stmtUpsert.run(userId, platform, existing?.platformChatId ?? null, existing?.platformUsername ?? null, existing?.linkedAt ?? null, verifyCode, expiresAt);
    return { verifyCode, expiresAt };
}
function completeLink(platform, verifyCode, chatId, username) {
    const row = stmtByCode.get(platform, verifyCode.trim().toUpperCase());
    if (!row || !row.verifyCode)
        return { error: 'Invalid code' };
    if (!row.verifyExpiresAt || new Date(row.verifyExpiresAt).getTime() < Date.now()) {
        return { error: 'Code expired' };
    }
    const taken = getLinkByChatId(platform, chatId);
    if (taken && taken.userId !== row.userId) {
        return { error: 'This chat is already linked to another account' };
    }
    stmtUpsert.run(row.userId, platform, chatId, username ?? null, new Date().toISOString(), null, null);
    return { ok: true, userId: row.userId };
}
function unlink(userId, platform) {
    const result = stmtDelete.run(userId, platform);
    return result.changes > 0;
}
//# sourceMappingURL=bot.service.js.map