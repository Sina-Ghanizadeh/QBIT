"use strict";
// ---------------------------------------------------------------------------
//  Social access helpers -- Global + Groups + Friends poke / visibility
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
exports.getIsGlobal = getIsGlobal;
exports.setIsGlobal = setIsGlobal;
exports.shareApprovedGroup = shareApprovedGroup;
exports.canPoke = canPoke;
exports.canPokeReason = canPokeReason;
const db_1 = __importDefault(require("../db"));
const friendService = __importStar(require("./friend.service"));
const stmtGetIsGlobal = db_1.default.prepare('SELECT isGlobal FROM user_settings WHERE userId = ?');
const stmtSetIsGlobal = db_1.default.prepare(`
  INSERT INTO user_settings (userId, onlyFriendsCanPoke, publicFriends, isGlobal)
  VALUES (?, 0, 1, ?)
  ON CONFLICT(userId) DO UPDATE SET isGlobal = excluded.isGlobal
`);
const stmtShareGroup = db_1.default.prepare(`
  SELECT 1 FROM group_members a
  INNER JOIN group_members b ON a.groupId = b.groupId
  WHERE a.userId = ? AND b.userId = ?
    AND a.status = 'approved' AND b.status = 'approved'
  LIMIT 1
`);
function getIsGlobal(userId) {
    const row = stmtGetIsGlobal.get(userId);
    return row ? (row.isGlobal ?? 0) !== 0 : false;
}
function setIsGlobal(userId, value) {
    const existing = db_1.default
        .prepare('SELECT onlyFriendsCanPoke, publicFriends FROM user_settings WHERE userId = ?')
        .get(userId);
    if (existing) {
        db_1.default.prepare('UPDATE user_settings SET isGlobal = ? WHERE userId = ?').run(value ? 1 : 0, userId);
    }
    else {
        stmtSetIsGlobal.run(userId, value ? 1 : 0);
    }
}
function shareApprovedGroup(userIdA, userIdB) {
    if (userIdA === userIdB)
        return true;
    return !!stmtShareGroup.get(userIdA, userIdB);
}
/**
 * Base poke rule: friends OR both global OR share an approved group.
 * Device-level onlyFriendsCanPoke is applied separately by callers.
 */
function canPoke(senderUserId, targetUserId) {
    if (senderUserId === targetUserId)
        return true;
    if (friendService.areFriends(senderUserId, targetUserId))
        return true;
    if (getIsGlobal(senderUserId) && getIsGlobal(targetUserId))
        return true;
    if (shareApprovedGroup(senderUserId, targetUserId))
        return true;
    return false;
}
function canPokeReason(senderUserId, targetUserId) {
    if (canPoke(senderUserId, targetUserId))
        return null;
    return 'You can only poke friends, global users, or members of a shared group';
}
//# sourceMappingURL=social.service.js.map