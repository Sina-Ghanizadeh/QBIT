"use strict";
// ---------------------------------------------------------------------------
//  User service -- known users, SQLite-backed
// ---------------------------------------------------------------------------
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUserById = getUserById;
exports.upsertUser = upsertUser;
exports.setUserOffline = setUserOffline;
exports.deleteUser = deleteUser;
exports.getAllUsers = getAllUsers;
exports.getUsersPaginated = getUsersPaginated;
const db_1 = __importDefault(require("../db"));
const stmtGet = db_1.default.prepare('SELECT * FROM users WHERE userId = ?');
const stmtAll = db_1.default.prepare('SELECT * FROM users ORDER BY lastSeen DESC');
const stmtUpsert = db_1.default.prepare(`
  INSERT INTO users (userId, displayName, email, avatar, firstSeen, lastSeen)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(userId) DO UPDATE SET
    displayName = excluded.displayName,
    email = excluded.email,
    avatar = excluded.avatar,
    lastSeen = excluded.lastSeen
`);
const stmtUpdateLastSeen = db_1.default.prepare('UPDATE users SET lastSeen = ? WHERE userId = ?');
const stmtDelete = db_1.default.prepare('DELETE FROM users WHERE userId = ?');
function getUserById(userId) {
    const row = stmtGet.get(userId);
    if (!row)
        return null;
    return { id: row.userId, displayName: row.displayName, email: row.email, avatar: row.avatar };
}
function upsertUser(userId, data) {
    const now = new Date().toISOString();
    stmtUpsert.run(userId, data.displayName, data.email, data.avatar, now, now);
}
function setUserOffline(userId) {
    stmtUpdateLastSeen.run(new Date().toISOString(), userId);
}
function deleteUser(userId) {
    const result = stmtDelete.run(userId);
    return result.changes > 0;
}
function getAllUsers(onlineUserIds) {
    const rows = stmtAll.all();
    const now = new Date().toISOString();
    return rows.map((u) => toKnownUser(u, onlineUserIds, now));
}
function toKnownUser(u, onlineUserIds, now) {
    const isOnline = onlineUserIds.has(u.userId);
    return {
        userId: u.userId,
        displayName: u.displayName,
        email: u.email,
        avatar: u.avatar,
        firstSeen: u.firstSeen,
        lastSeen: isOnline ? now : u.lastSeen,
        status: isOnline ? 'online' : 'offline',
    };
}
function getUsersPaginated(onlineUserIds, options) {
    let rows = stmtAll.all();
    const q = (options.q ?? '').trim().toLowerCase();
    if (q) {
        rows = rows.filter((u) => u.userId.toLowerCase().includes(q) ||
            (u.displayName ?? '').toLowerCase().includes(q) ||
            (u.email ?? '').toLowerCase().includes(q));
    }
    const total = rows.length;
    const sortBy = options.sortBy ?? 'lastSeen';
    const order = options.order ?? 'desc';
    rows.sort((a, b) => {
        let va;
        let vb;
        switch (sortBy) {
            case 'userId':
                va = a.userId;
                vb = b.userId;
                break;
            case 'displayName':
                va = (a.displayName ?? '').toLowerCase();
                vb = (b.displayName ?? '').toLowerCase();
                break;
            case 'email':
                va = (a.email ?? '').toLowerCase();
                vb = (b.email ?? '').toLowerCase();
                break;
            case 'lastSeen':
            default:
                va = new Date(a.lastSeen).getTime();
                vb = new Date(b.lastSeen).getTime();
                break;
        }
        if (typeof va === 'number' && typeof vb === 'number') {
            return order === 'asc' ? va - vb : vb - va;
        }
        const r = String(va).localeCompare(String(vb));
        return order === 'asc' ? r : -r;
    });
    const limit = Math.min(Math.max(1, options.limit), 100);
    const offset = Math.max(0, options.offset);
    const slice = rows.slice(offset, offset + limit);
    const now = new Date().toISOString();
    const items = slice.map((u) => toKnownUser(u, onlineUserIds, now));
    return { items, total };
}
//# sourceMappingURL=user.service.js.map