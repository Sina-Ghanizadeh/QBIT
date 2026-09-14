// ---------------------------------------------------------------------------
//  Groups -- public/private, join requests, invite codes
// ---------------------------------------------------------------------------

import crypto from 'crypto';
import db from '../db';

export type GroupVisibility = 'public' | 'private';
export type MemberRole = 'owner' | 'admin' | 'member';
export type MemberStatus = 'pending' | 'approved' | 'rejected';

export interface GroupRow {
  id: string;
  name: string;
  description: string;
  visibility: GroupVisibility;
  inviteCode: string | null;
  ownerUserId: string;
  createdAt: string;
}

export interface GroupMemberRow {
  groupId: string;
  userId: string;
  role: MemberRole;
  status: MemberStatus;
  createdAt: string;
}

function newId(): string {
  return crypto.randomBytes(12).toString('hex');
}

function newInviteCode(): string {
  // 8-char uppercase alphanumeric, easy to type
  return crypto.randomBytes(6).toString('base64url').slice(0, 8).toUpperCase();
}

const stmtInsertGroup = db.prepare(`
  INSERT INTO groups (id, name, description, visibility, inviteCode, ownerUserId, createdAt)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const stmtInsertMember = db.prepare(`
  INSERT INTO group_members (groupId, userId, role, status, createdAt)
  VALUES (?, ?, ?, ?, ?)
`);
const stmtGetGroup = db.prepare('SELECT * FROM groups WHERE id = ?');
const stmtGetByCode = db.prepare('SELECT * FROM groups WHERE inviteCode = ?');
const stmtListPublic = db.prepare(`
  SELECT * FROM groups WHERE visibility = 'public' ORDER BY createdAt DESC
`);
const stmtMember = db.prepare('SELECT * FROM group_members WHERE groupId = ? AND userId = ?');
const stmtApprovedMembers = db.prepare(`
  SELECT * FROM group_members WHERE groupId = ? AND status = 'approved'
`);
const stmtPendingMembers = db.prepare(`
  SELECT * FROM group_members WHERE groupId = ? AND status = 'pending' ORDER BY createdAt ASC
`);
const stmtMyMemberships = db.prepare(`
  SELECT g.*, m.role AS memberRole, m.status AS memberStatus
  FROM group_members m
  INNER JOIN groups g ON g.id = m.groupId
  WHERE m.userId = ?
  ORDER BY g.createdAt DESC
`);
const stmtUpdateStatus = db.prepare(`
  UPDATE group_members SET status = ? WHERE groupId = ? AND userId = ?
`);
const stmtDeleteMember = db.prepare('DELETE FROM group_members WHERE groupId = ? AND userId = ?');
const stmtDeleteGroup = db.prepare('DELETE FROM groups WHERE id = ?');
const stmtDeleteMembers = db.prepare('DELETE FROM group_members WHERE groupId = ?');

export function createGroup(input: {
  name: string;
  description?: string;
  visibility: GroupVisibility;
  ownerUserId: string;
}): GroupRow {
  const id = newId();
  const createdAt = new Date().toISOString();
  const inviteCode = input.visibility === 'private' ? newInviteCode() : newInviteCode();
  const tx = db.transaction(() => {
    stmtInsertGroup.run(
      id,
      input.name,
      input.description ?? '',
      input.visibility,
      inviteCode,
      input.ownerUserId,
      createdAt
    );
    stmtInsertMember.run(id, input.ownerUserId, 'owner', 'approved', createdAt);
  });
  tx();
  return stmtGetGroup.get(id) as GroupRow;
}

export function getGroup(groupId: string): GroupRow | null {
  return (stmtGetGroup.get(groupId) as GroupRow | undefined) ?? null;
}

export function getGroupByInviteCode(code: string): GroupRow | null {
  return (stmtGetByCode.get(code.trim().toUpperCase()) as GroupRow | undefined) ?? null;
}

export function listPublicGroups(): GroupRow[] {
  return stmtListPublic.all() as GroupRow[];
}

export function getMembership(groupId: string, userId: string): GroupMemberRow | null {
  return (stmtMember.get(groupId, userId) as GroupMemberRow | undefined) ?? null;
}

export function listApprovedMemberIds(groupId: string): string[] {
  const rows = stmtApprovedMembers.all(groupId) as GroupMemberRow[];
  return rows.map((r) => r.userId);
}

export function listApprovedMembers(groupId: string): GroupMemberRow[] {
  return stmtApprovedMembers.all(groupId) as GroupMemberRow[];
}

export function listPendingMembers(groupId: string): GroupMemberRow[] {
  return stmtPendingMembers.all(groupId) as GroupMemberRow[];
}

export function listMyGroups(userId: string): Array<
  GroupRow & { memberRole: MemberRole; memberStatus: MemberStatus }
> {
  return stmtMyMemberships.all(userId) as Array<
    GroupRow & { memberRole: MemberRole; memberStatus: MemberStatus }
  >;
}

export function requestJoin(groupId: string, userId: string): { ok: true } | { error: string; status: number } {
  const group = getGroup(groupId);
  if (!group) return { error: 'Group not found', status: 404 };
  if (group.visibility !== 'public') {
    return { error: 'Private groups require an invite code', status: 400 };
  }
  const existing = getMembership(groupId, userId);
  if (existing?.status === 'approved') return { error: 'Already a member', status: 409 };
  if (existing?.status === 'pending') return { error: 'Join request already pending', status: 409 };
  const createdAt = new Date().toISOString();
  if (existing) {
    stmtUpdateStatus.run('pending', groupId, userId);
  } else {
    stmtInsertMember.run(groupId, userId, 'member', 'pending', createdAt);
  }
  return { ok: true };
}

export function requestJoinByCode(
  code: string,
  userId: string
): { ok: true; groupId: string } | { error: string; status: number } {
  const group = getGroupByInviteCode(code);
  if (!group) return { error: 'Invalid invite code', status: 404 };
  const existing = getMembership(group.id, userId);
  if (existing?.status === 'approved') return { error: 'Already a member', status: 409 };
  if (existing?.status === 'pending') return { error: 'Join request already pending', status: 409 };
  const createdAt = new Date().toISOString();
  if (existing) {
    stmtUpdateStatus.run('pending', group.id, userId);
  } else {
    stmtInsertMember.run(group.id, userId, 'member', 'pending', createdAt);
  }
  return { ok: true, groupId: group.id };
}

export function setMemberStatus(
  groupId: string,
  actorUserId: string,
  targetUserId: string,
  status: 'approved' | 'rejected'
): { ok: true } | { error: string; status: number } {
  const group = getGroup(groupId);
  if (!group) return { error: 'Group not found', status: 404 };
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

export function leaveGroup(
  groupId: string,
  userId: string
): { ok: true } | { error: string; status: number } {
  const group = getGroup(groupId);
  if (!group) return { error: 'Group not found', status: 404 };
  const member = getMembership(groupId, userId);
  if (!member) return { error: 'Not a member', status: 404 };
  if (member.role === 'owner') {
    return { error: 'Owner cannot leave; delete the group instead', status: 400 };
  }
  stmtDeleteMember.run(groupId, userId);
  return { ok: true };
}

export function deleteGroup(
  groupId: string,
  userId: string
): { ok: true } | { error: string; status: number } {
  const group = getGroup(groupId);
  if (!group) return { error: 'Group not found', status: 404 };
  if (group.ownerUserId !== userId) {
    return { error: 'Only the owner can delete the group', status: 403 };
  }
  const tx = db.transaction(() => {
    stmtDeleteMembers.run(groupId);
    stmtDeleteGroup.run(groupId);
    db.prepare(
      "DELETE FROM animation_grants WHERE granteeType = 'group' AND granteeId = ?"
    ).run(groupId);
  });
  tx();
  return { ok: true };
}

export function isApprovedMember(groupId: string, userId: string): boolean {
  const m = getMembership(groupId, userId);
  return !!m && m.status === 'approved';
}
