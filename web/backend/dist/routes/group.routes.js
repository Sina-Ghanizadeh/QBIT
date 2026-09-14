"use strict";
// ---------------------------------------------------------------------------
//  Group routes
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
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const validate_1 = require("../middleware/validate");
const requireNotBanned_1 = require("../middleware/requireNotBanned");
const schemas_1 = require("../schemas");
const groupService = __importStar(require("../services/group.service"));
const userService = __importStar(require("../services/user.service"));
const publicUserId_service_1 = require("../services/publicUserId.service");
const router = (0, express_1.Router)();
function requireAuth(req) {
    if (!req.isAuthenticated())
        return null;
    return req.user;
}
function serializeGroup(g, extras) {
    return {
        id: g.id,
        name: g.name,
        description: g.description,
        visibility: g.visibility,
        inviteCode: g.visibility === 'private' ? g.inviteCode : undefined,
        ownerPublicUserId: (0, publicUserId_service_1.ensurePublicUserId)(g.ownerUserId),
        createdAt: g.createdAt,
        ...extras,
    };
}
// GET /api/groups/public
router.get('/public', (_req, res) => {
    const groups = groupService.listPublicGroups().map((g) => serializeGroup(g, { memberCount: groupService.listApprovedMemberIds(g.id).length }));
    res.json({ groups });
});
// GET /api/groups/mine
router.get('/mine', (req, res) => {
    const user = requireAuth(req);
    if (!user)
        return res.status(401).json({ error: 'Login required' });
    const groups = groupService.listMyGroups(user.id).map((g) => serializeGroup(g, {
        memberRole: g.memberRole,
        memberStatus: g.memberStatus,
        memberCount: groupService.listApprovedMemberIds(g.id).length,
    }));
    res.json({ groups });
});
// POST /api/groups
router.post('/', requireNotBanned_1.requireNotBanned, (0, validate_1.validate)(schemas_1.createGroupSchema), (req, res) => {
    const user = requireAuth(req);
    if (!user)
        return res.status(401).json({ error: 'Login required' });
    const { name, description, visibility } = req.body;
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
router.post('/join-by-code', requireNotBanned_1.requireNotBanned, (0, validate_1.validate)(schemas_1.joinByCodeSchema), (req, res) => {
    const user = requireAuth(req);
    if (!user)
        return res.status(401).json({ error: 'Login required' });
    const result = groupService.requestJoinByCode(req.body.code, user.id);
    if ('error' in result)
        return res.status(result.status).json({ error: result.error });
    res.json({ ok: true, groupId: result.groupId, status: 'pending' });
});
// GET /api/groups/:groupId
router.get('/:groupId', (0, validate_1.validateParams)(schemas_1.groupIdParamSchema), (req, res) => {
    const groupId = req.params.groupId;
    const group = groupService.getGroup(groupId);
    if (!group)
        return res.status(404).json({ error: 'Group not found' });
    const user = requireAuth(req);
    const membership = user ? groupService.getMembership(groupId, user.id) : null;
    const canSeeCode = group.visibility === 'private' &&
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
router.post('/:groupId/join', requireNotBanned_1.requireNotBanned, (0, validate_1.validateParams)(schemas_1.groupIdParamSchema), (req, res) => {
    const user = requireAuth(req);
    if (!user)
        return res.status(401).json({ error: 'Login required' });
    const result = groupService.requestJoin(req.params.groupId, user.id);
    if ('error' in result)
        return res.status(result.status).json({ error: result.error });
    res.json({ ok: true, status: 'pending' });
});
// GET /api/groups/:groupId/members
router.get('/:groupId/members', (0, validate_1.validateParams)(schemas_1.groupIdParamSchema), (req, res) => {
    const user = requireAuth(req);
    if (!user)
        return res.status(401).json({ error: 'Login required' });
    const groupId = req.params.groupId;
    if (!groupService.isApprovedMember(groupId, user.id)) {
        return res.status(403).json({ error: 'Members only' });
    }
    const members = groupService.listApprovedMembers(groupId).map((m) => {
        const u = userService.getUserById(m.userId);
        return {
            publicUserId: (0, publicUserId_service_1.ensurePublicUserId)(m.userId),
            displayName: u?.displayName ?? 'User',
            avatar: u?.avatar ?? '',
            role: m.role,
            status: m.status,
        };
    });
    res.json({ members });
});
// GET /api/groups/:groupId/requests (owner/admin)
router.get('/:groupId/requests', (0, validate_1.validateParams)(schemas_1.groupIdParamSchema), (req, res) => {
    const user = requireAuth(req);
    if (!user)
        return res.status(401).json({ error: 'Login required' });
    const groupId = req.params.groupId;
    const membership = groupService.getMembership(groupId, user.id);
    if (!membership || membership.status !== 'approved' || (membership.role !== 'owner' && membership.role !== 'admin')) {
        return res.status(403).json({ error: 'Only owners/admins can view requests' });
    }
    const requests = groupService.listPendingMembers(groupId).map((m) => {
        const u = userService.getUserById(m.userId);
        return {
            publicUserId: (0, publicUserId_service_1.ensurePublicUserId)(m.userId),
            displayName: u?.displayName ?? 'User',
            avatar: u?.avatar ?? '',
            createdAt: m.createdAt,
        };
    });
    res.json({ requests });
});
// POST /api/groups/:groupId/requests
router.post('/:groupId/requests', requireNotBanned_1.requireNotBanned, (0, validate_1.validateParams)(schemas_1.groupIdParamSchema), (0, validate_1.validate)(schemas_1.memberDecisionSchema), (req, res) => {
    const user = requireAuth(req);
    if (!user)
        return res.status(401).json({ error: 'Login required' });
    const targetUserId = (0, publicUserId_service_1.getUserIdFromPublicId)(req.body.userPublicId);
    if (!targetUserId)
        return res.status(404).json({ error: 'User not found' });
    const result = groupService.setMemberStatus(req.params.groupId, user.id, targetUserId, req.body.decision);
    if ('error' in result)
        return res.status(result.status).json({ error: result.error });
    res.json({ ok: true });
});
// POST /api/groups/:groupId/leave
router.post('/:groupId/leave', requireNotBanned_1.requireNotBanned, (0, validate_1.validateParams)(schemas_1.groupIdParamSchema), (req, res) => {
    const user = requireAuth(req);
    if (!user)
        return res.status(401).json({ error: 'Login required' });
    const result = groupService.leaveGroup(req.params.groupId, user.id);
    if ('error' in result)
        return res.status(result.status).json({ error: result.error });
    res.json({ ok: true });
});
// DELETE /api/groups/:groupId
router.delete('/:groupId', requireNotBanned_1.requireNotBanned, (0, validate_1.validateParams)(schemas_1.groupIdParamSchema), (req, res) => {
    const user = requireAuth(req);
    if (!user)
        return res.status(401).json({ error: 'Login required' });
    const result = groupService.deleteGroup(req.params.groupId, user.id);
    if ('error' in result)
        return res.status(result.status).json({ error: result.error });
    res.json({ ok: true });
});
exports.default = router;
//# sourceMappingURL=group.routes.js.map