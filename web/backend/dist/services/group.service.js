"use strict";
// ---------------------------------------------------------------------------
//  Groups -- public/private, join requests, invite codes
// ---------------------------------------------------------------------------
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createGroup = createGroup;
exports.getGroup = getGroup;
exports.getGroupByInviteCode = getGroupByInviteCode;
exports.listPublicGroups = listPublicGroups;
exports.getMembership = getMembership;
exports.listApprovedMemberIds = listApprovedMemberIds;
exports.listApprovedMembers = listApprovedMembers;
exports.listPendingMembers = listPendingMembers;
exports.listMyGroups = listMyGroups;
exports.requestJoin = requestJoin;
exports.requestJoinByCode = requestJoinByCode;
exports.setMemberStatus = setMemberStatus;
exports.leaveGroup = leaveGroup;
exports.deleteGroup = deleteGroup;
exports.isApprovedMember = isApprovedMember;
const crypto_1 = __importDefault(require("crypto"));
const db_1 = __importDefault(require("../db"));
function newId() {
    return crypto_1.default.randomBytes(12).toString('hex');
}
function newInviteCode() {
    // 8-char uppercase alphanumeric, easy to type
    return crypto_1.default.randomBytes(6).toString('base64url').slice(0, 8).toUpperCase();
}
const stmtInsertGroup = db_1.default.prepare(`
  INSERT INTO groups (id, name, description, visibility, inviteCode, ownerUserId, createdAt)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const stmtInsertMember = db_1.default.prepare(`
  INSERT INTO group_members (groupId, userId, role, status, createdAt)
  VALUES (?, ?, ?, ?, ?)
`);
const stmtGetGroup = db_1.default.prepare('SELECT * FROM groups WHERE id = ?');
const stmtGetByCode = db_1.default.prepare('SELECT * FROM groups WHERE inviteCode = ?');
const stmtListPublic = db_1.default.prepare(`
  SELECT * FROM groups WHERE visibility = 'public' ORDER BY createdAt DESC
`);
const stmtMember = db_1.default.prepare('SELECT * FROM group_members WHERE groupId = ? AND userId = ?');
const stmtApprovedMembers = db_1.default.prepare(`
  SELECT * FROM group_members WHERE groupId = ? AND status = 'approved'
`);
const stmtPendingMembers = db_1.default.prepare(`
  SELECT * FROM group_members WHERE groupId = ? AND status = 'pending' ORDER BY createdAt ASC
`);
const stmtMyMemberships = db_1.default.prepare(`
  SELECT g.*, m.role AS memberRole, m.status AS memberStatus
  FROM group_members m
  INNER JOIN groups g ON g.id = m.groupId
  WHERE m.userId = ?
  ORDER BY g.createdAt DESC
`);
const stmtUpdateStatus = db_1.default.prepare(`
  UPDATE group_members SET status = ? WHERE groupId = ? AND userId = ?
`);
const stmtDeleteMember = db_1.default.prepare('DELETE FROM group_members WHERE groupId = ? AND userId = ?');
const stmtDeleteGroup = db_1.default.prepare('DELETE FROM groups WHERE id = ?');
const stmtDeleteMembers = db_1.default.prepare('DELETE FROM group_members WHERE groupId = ?');
function createGroup(input) {
    const id = newId();
    const createdAt = new Date().toISOString();
    const inviteCode = input.visibility === 'private' ? newInviteCode() : newInviteCode();
    const tx = db_1.default.transaction(() => {
        stmtInsertGroup.run(id, input.name, input.description ?? '', input.visibility, inviteCode, input.ownerUserId, createdAt);
        stmtInsertMember.run(id, input.ownerUserId, 'owner', 'approved', createdAt);
    });
    tx();
    return stmtGetGroup.get(id);
}
function getGroup(groupId) {
    return stmtGetGroup.get(groupId) ?? null;
}
function getGroupByInviteCode(code) {
    return stmtGetByCode.get(code.trim().toUpperCase()) ?? null;
}
function listPublicGroups() {
    return stmtListPublic.all();
}
function getMembership(groupId, userId) {
    return stmtMember.get(groupId, userId) ?? null;
}
function listApprovedMemberIds(groupId) {
    const rows = stmtApprovedMembers.all(groupId);
    return rows.map((r) => r.userId);
}
function listApprovedMembers(groupId) {
    return stmtApprovedMembers.all(groupId);
}
function listPendingMembers(groupId) {
    return stmtPendingMembers.all(groupId);
}
function listMyGroups(userId) {
    return stmtMyMemberships.all(userId);
}
function requestJoin(groupId, userId) {
    const group = getGroup(groupId);
    if (!group)
        return { error: 'Group not found', status: 404 };
    if (group.visibility !== 'public') {
        return { error: 'Private groups require an invite code', status: 400 };
    }
    const existing = getMembership(groupId, userId);
    if (existing?.status === 'approved')
        return { error: 'Already a member', status: 409 };
    if (existing?.status === 'pending')
        return { error: 'Join request already pending', status: 409 };
    const createdAt = new Date().toISOString();
    if (existing) {
        stmtUpdateStatus.run('pending', groupId, userId);
    }
    else {
        stmtInsertMember.run(groupId, userId, 'member', 'pending', createdAt);
    }
    return { ok: true };
}
function requestJoinByCode(code, userId) {
    const group = getGroupByInviteCode(code);
    if (!group)
        return { error: 'Invalid invite code', status: 404 };
    const existing = getMembership(group.id, userId);
    if (existing?.status === 'approved')
        return { error: 'Already a member', status: 409 };
    if (existing?.status === 'pending')
        return { error: 'Join request already pending', status: 409 };
    const createdAt = new Date().toISOString();
    if (existing) {
        stmtUpdateStatus.run('pending', group.id, userId);
    }
    else {
        stmtInsertMember.run(group.id, userId, 'member', 'pending', createdAt);
    }
    return { ok: true, groupId: group.id };
}
function setMemberStatus(groupId, actorUserId, targetUserId, status) {
    const group = getGroup(groupId);
    if (!group)
        return { error: 'Group not found', status: 404 };
    const actor = getMembership(groupId, actorUserId);
    if (!actor || actor.status !== 'approved' || (actor.role !== 'owner' && actor.role !== 'admin')) {
        return { error: 'Only group owners/admins can manage requests', status: 403 };
    }
    const target = getMembership(groupId, targetUserId);
    if (!target || target.status !== 'pending') {
        return { error: 'No pending request for this user', status: 404 };
    }
    if (target.role === 'owner') {
        return { error: 'Cannot change owner status', status: 400 };
    }
    stmtUpdateStatus.run(status, groupId, targetUserId);
    return { ok: true };
}
function leaveGroup(groupId, userId) {
    const group = getGroup(groupId);
    if (!group)
        return { error: 'Group not found', status: 404 };
    const member = getMembership(groupId, userId);
    if (!member)
        return { error: 'Not a member', status: 404 };
    if (member.role === 'owner') {
        return { error: 'Owner cannot leave; delete the group instead', status: 400 };
    }
    stmtDeleteMember.run(groupId, userId);
    return { ok: true };
}
function deleteGroup(groupId, userId) {
    const group = getGroup(groupId);
    if (!group)
        return { error: 'Group not found', status: 404 };
    if (group.ownerUserId !== userId) {
        return { error: 'Only the owner can delete the group', status: 403 };
    }
    const tx = db_1.default.transaction(() => {
        stmtDeleteMembers.run(groupId);
        stmtDeleteGroup.run(groupId);
        db_1.default.prepare("DELETE FROM animation_grants WHERE granteeType = 'group' AND granteeId = ?").run(groupId);
    });
    tx();
    return { ok: true };
}
function isApprovedMember(groupId, userId) {
    const m = getMembership(groupId, userId);
    return !!m && m.status === 'approved';
}
//# sourceMappingURL=group.service.js.map