// ---------------------------------------------------------------------------
//  Group routes
// ---------------------------------------------------------------------------

import { Router, Request } from 'express';
import { validate, validateParams } from '../middleware/validate';
import { requireNotBanned } from '../middleware/requireNotBanned';
import {
  createGroupSchema,
  groupIdParamSchema,
  joinByCodeSchema,
  memberDecisionSchema,
} from '../schemas';
import * as groupService from '../services/group.service';
import * as userService from '../services/user.service';
import { ensurePublicUserId, getUserIdFromPublicId } from '../services/publicUserId.service';
import type { AppUser } from '../types';

const router = Router();

function requireAuth(req: Request): AppUser | null {
  if (!req.isAuthenticated()) return null;
  return req.user as AppUser;
}

function serializeGroup(
  g: groupService.GroupRow,
  extras?: { memberRole?: string; memberStatus?: string; memberCount?: number }
) {
  return {
    id: g.id,
    name: g.name,
    description: g.description,
    visibility: g.visibility,
    inviteCode: g.visibility === 'private' ? g.inviteCode : undefined,
    ownerPublicUserId: ensurePublicUserId(g.ownerUserId),
    createdAt: g.createdAt,
    ...extras,
  };
}

// GET /api/groups/public
router.get('/public', (_req, res) => {
  const groups = groupService.listPublicGroups().map((g) =>
    serializeGroup(g, { memberCount: groupService.listApprovedMemberIds(g.id).length })
  );
  res.json({ groups });
});

// GET /api/groups/mine
router.get('/mine', (req, res) => {
  const user = requireAuth(req);
  if (!user) return res.status(401).json({ error: 'Login required' });
  const groups = groupService.listMyGroups(user.id).map((g) =>
    serializeGroup(g, {
      memberRole: g.memberRole,
      memberStatus: g.memberStatus,
      memberCount: groupService.listApprovedMemberIds(g.id).length,
    })
  );
  res.json({ groups });
});

// POST /api/groups
router.post('/', requireNotBanned, validate(createGroupSchema), (req, res) => {
  const user = requireAuth(req);
  if (!user) return res.status(401).json({ error: 'Login required' });
  const { name, description, visibility } = req.body as {
    name: string;
    description?: string;
    visibility: 'public' | 'private';
  };
  const group = groupService.createGroup({
    name,
    description,
    visibility,
    ownerUserId: user.id,
  });
  res.status(201).json({
    group: serializeGroup(group, { memberRole: 'owner', memberStatus: 'approved' }),
  });
});

// POST /api/groups/join-by-code
router.post('/join-by-code', requireNotBanned, validate(joinByCodeSchema), (req, res) => {
  const user = requireAuth(req);
  if (!user) return res.status(401).json({ error: 'Login required' });
  const result = groupService.requestJoinByCode(req.body.code, user.id);
  if ('error' in result) return res.status(result.status).json({ error: result.error });
  res.json({ ok: true, groupId: result.groupId, status: 'pending' });
});

// GET /api/groups/:groupId
router.get('/:groupId', validateParams(groupIdParamSchema), (req, res) => {
  const groupId = req.params.groupId as string;
  const group = groupService.getGroup(groupId);
  if (!group) return res.status(404).json({ error: 'Group not found' });
  const user = requireAuth(req);
  const membership = user ? groupService.getMembership(groupId, user.id) : null;
  const canSeeCode =
    group.visibility === 'private' &&
    membership &&
    membership.status === 'approved' &&
    (membership.role === 'owner' || membership.role === 'admin');
  res.json({
    group: {
      ...serializeGroup(group, {
        memberCount: groupService.listApprovedMemberIds(groupId).length,
        memberRole: membership?.role,
        memberStatus: membership?.status,
      }),
      inviteCode: canSeeCode || (user && group.ownerUserId === user.id) ? group.inviteCode : undefined,
    },
  });
});

// POST /api/groups/:groupId/join
router.post('/:groupId/join', requireNotBanned, validateParams(groupIdParamSchema), (req, res) => {
  const user = requireAuth(req);
  if (!user) return res.status(401).json({ error: 'Login required' });
  const result = groupService.requestJoin(req.params.groupId as string, user.id);
  if ('error' in result) return res.status(result.status).json({ error: result.error });
  res.json({ ok: true, status: 'pending' });
});

// GET /api/groups/:groupId/members
router.get('/:groupId/members', validateParams(groupIdParamSchema), (req, res) => {
  const user = requireAuth(req);
  if (!user) return res.status(401).json({ error: 'Login required' });
  const groupId = req.params.groupId as string;
  if (!groupService.isApprovedMember(groupId, user.id)) {
    return res.status(403).json({ error: 'Members only' });
  }
  const members = groupService.listApprovedMembers(groupId).map((m) => {
    const u = userService.getUserById(m.userId);
    return {
      publicUserId: ensurePublicUserId(m.userId),
      displayName: u?.displayName ?? 'User',
      avatar: u?.avatar ?? '',
      role: m.role,
      status: m.status,
    };
  });
  res.json({ members });
});

// GET /api/groups/:groupId/requests (owner/admin)
router.get('/:groupId/requests', validateParams(groupIdParamSchema), (req, res) => {
  const user = requireAuth(req);
  if (!user) return res.status(401).json({ error: 'Login required' });
  const groupId = req.params.groupId as string;
  const membership = groupService.getMembership(groupId, user.id);
  if (!membership || membership.status !== 'approved' || (membership.role !== 'owner' && membership.role !== 'admin')) {
    return res.status(403).json({ error: 'Only owners/admins can view requests' });
  }
  const requests = groupService.listPendingMembers(groupId).map((m) => {
    const u = userService.getUserById(m.userId);
    return {
      publicUserId: ensurePublicUserId(m.userId),
      displayName: u?.displayName ?? 'User',
      avatar: u?.avatar ?? '',
      createdAt: m.createdAt,
    };
  });
  res.json({ requests });
});

// POST /api/groups/:groupId/requests
router.post(
  '/:groupId/requests',
  requireNotBanned,
  validateParams(groupIdParamSchema),
  validate(memberDecisionSchema),
  (req, res) => {
    const user = requireAuth(req);
    if (!user) return res.status(401).json({ error: 'Login required' });
    const targetUserId = getUserIdFromPublicId(req.body.userPublicId);
    if (!targetUserId) return res.status(404).json({ error: 'User not found' });
    const result = groupService.setMemberStatus(
      req.params.groupId as string,
      user.id,
      targetUserId,
      req.body.decision
    );
    if ('error' in result) return res.status(result.status).json({ error: result.error });
    res.json({ ok: true });
  }
);

// POST /api/groups/:groupId/leave
router.post('/:groupId/leave', requireNotBanned, validateParams(groupIdParamSchema), (req, res) => {
  const user = requireAuth(req);
  if (!user) return res.status(401).json({ error: 'Login required' });
  const result = groupService.leaveGroup(req.params.groupId as string, user.id);
  if ('error' in result) return res.status(result.status).json({ error: result.error });
  res.json({ ok: true });
});

// DELETE /api/groups/:groupId
router.delete('/:groupId', requireNotBanned, validateParams(groupIdParamSchema), (req, res) => {
  const user = requireAuth(req);
  if (!user) return res.status(401).json({ error: 'Login required' });
  const result = groupService.deleteGroup(req.params.groupId as string, user.id);
  if ('error' in result) return res.status(result.status).json({ error: result.error });
  res.json({ ok: true });
});

export default router;
