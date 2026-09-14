"use strict";
// ---------------------------------------------------------------------------
//  Friends and user settings (onlyFriendsCanPoke)
// ---------------------------------------------------------------------------
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFriendIds = getFriendIds;
exports.getAllFriendPairs = getAllFriendPairs;
exports.getPublicFriends = getPublicFriends;
exports.setPublicFriends = setPublicFriends;
exports.getPublicFriendPairs = getPublicFriendPairs;
exports.addFriend = addFriend;
exports.removeFriend = removeFriend;
exports.areFriends = areFriends;
exports.getOnlyFriendsCanPoke = getOnlyFriendsCanPoke;
exports.setOnlyFriendsCanPoke = setOnlyFriendsCanPoke;
const db_1 = __importDefault(require("../db"));
const stmtGetFriends = db_1.default.prepare('SELECT friendId FROM friends WHERE userId = ?');
const stmtAddFriend = db_1.default.prepare('INSERT OR IGNORE INTO friends (userId, friendId) VALUES (?, ?)');
const stmtRemoveFriend = db_1.default.prepare('DELETE FROM friends WHERE userId = ? AND friendId = ?');
const stmtAreFriends = db_1.default.prepare('SELECT 1 FROM friends WHERE (userId = ? AND friendId = ?) OR (userId = ? AND friendId = ?) LIMIT 1');
const stmtGetSettings = db_1.default.prepare('SELECT onlyFriendsCanPoke, publicFriends, isGlobal FROM user_settings WHERE userId = ?');
const stmtSetSettings = db_1.default.prepare(`INSERT INTO user_settings (userId, onlyFriendsCanPoke, publicFriends, isGlobal)
   VALUES (?, ?, ?, COALESCE((SELECT isGlobal FROM user_settings WHERE userId = ?), 0))
   ON CONFLICT(userId) DO UPDATE SET
     onlyFriendsCanPoke = excluded.onlyFriendsCanPoke,
     publicFriends = excluded.publicFriends`);
function getFriendIds(userId) {
    const rows = stmtGetFriends.all(userId);
    return rows.map((r) => r.friendId);
}
/** All unique friend pairs (each pair once, normalized so a < b by internal id). For global graph display. */
function getAllFriendPairs() {
    const rows = db_1.default.prepare('SELECT userId, friendId FROM friends').all();
    const seen = new Set();
    const pairs = [];
    for (const r of rows) {
        const a = r.userId < r.friendId ? r.userId : r.friendId;
        const b = r.userId < r.friendId ? r.friendId : r.userId;
        const key = `${a}\t${b}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        pairs.push({ a, b });
    }
    return pairs;
}
function getPublicFriends(userId) {
    const row = stmtGetSettings.get(userId);
    return row ? (row.publicFriends ?? 1) !== 0 : true;
}
function setPublicFriends(userId, value) {
    const row = stmtGetSettings.get(userId);
    const onlyFriendsCanPoke = row ? (row.onlyFriendsCanPoke ?? 0) !== 0 : false;
    stmtSetSettings.run(userId, onlyFriendsCanPoke ? 1 : 0, value ? 1 : 0, userId);
}
/** Friend pairs where both users have publicFriends enabled. No settings row = public (same as getPublicFriends). */
function getPublicFriendPairs() {
    const all = getAllFriendPairs();
    const privateSet = new Set();
    const stmt = db_1.default.prepare('SELECT userId FROM user_settings WHERE publicFriends = 0');
    for (const r of stmt.all()) {
        privateSet.add(r.userId);
    }
    return all.filter(({ a, b }) => !privateSet.has(a) && !privateSet.has(b));
}
function addFriend(userIdA, userIdB) {
    if (userIdA === userIdB)
        return;
    stmtAddFriend.run(userIdA, userIdB);
    stmtAddFriend.run(userIdB, userIdA);
}
function removeFriend(userIdA, userIdB) {
    stmtRemoveFriend.run(userIdA, userIdB);
    stmtRemoveFriend.run(userIdB, userIdA);
}
function areFriends(userIdA, userIdB) {
    if (userIdA === userIdB)
        return true;
    const row = stmtAreFriends.get(userIdA, userIdB, userIdB, userIdA);
    return !!row;
}
function getOnlyFriendsCanPoke(userId) {
    const row = stmtGetSettings.get(userId);
    return row ? (row.onlyFriendsCanPoke ?? 0) !== 0 : false;
}
function setOnlyFriendsCanPoke(userId, value) {
    const row = stmtGetSettings.get(userId);
    const publicFriends = row ? (row.publicFriends ?? 1) !== 0 : true;
    stmtSetSettings.run(userId, value ? 1 : 0, publicFriends ? 1 : 0, userId);
}
//# sourceMappingURL=friend.service.js.map