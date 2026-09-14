"use strict";
// ---------------------------------------------------------------------------
//  Animation grants -- who may set animation on owner's device(s)
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
exports.listGrantsForOwner = listGrantsForOwner;
exports.createGrant = createGrant;
exports.deleteGrant = deleteGrant;
exports.canSetAnimation = canSetAnimation;
exports.pushAnimationToDevice = pushAnimationToDevice;
const crypto_1 = __importDefault(require("crypto"));
const db_1 = __importDefault(require("../db"));
const claimService = __importStar(require("./claim.service"));
const groupService = __importStar(require("./group.service"));
const deviceService = __importStar(require("./device.service"));
const stmtInsert = db_1.default.prepare(`
  INSERT INTO animation_grants (id, ownerUserId, deviceId, granteeType, granteeId, createdAt)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const stmtByOwner = db_1.default.prepare('SELECT * FROM animation_grants WHERE ownerUserId = ? ORDER BY createdAt DESC');
const stmtGet = db_1.default.prepare('SELECT * FROM animation_grants WHERE id = ?');
const stmtDelete = db_1.default.prepare('DELETE FROM animation_grants WHERE id = ?');
const stmtForDevice = db_1.default.prepare(`
  SELECT * FROM animation_grants
  WHERE ownerUserId = ? AND (deviceId IS NULL OR deviceId = ?)
`);
function newId() {
    return crypto_1.default.randomBytes(12).toString('hex');
}
function listGrantsForOwner(ownerUserId) {
    return stmtByOwner.all(ownerUserId);
}
function createGrant(input) {
    if (input.deviceId) {
        const claim = claimService.getClaimByDevice(input.deviceId);
        if (!claim || claim.userId !== input.ownerUserId) {
            return { error: 'You can only grant access to your own devices', status: 403 };
        }
    }
    if (input.granteeType === 'group') {
        const group = groupService.getGroup(input.granteeId);
        if (!group)
            return { error: 'Group not found', status: 404 };
    }
    const id = newId();
    const createdAt = new Date().toISOString();
    stmtInsert.run(id, input.ownerUserId, input.deviceId ?? null, input.granteeType, input.granteeId, createdAt);
    return stmtGet.get(id);
}
function deleteGrant(grantId, actorUserId) {
    const grant = stmtGet.get(grantId);
    if (!grant)
        return { error: 'Grant not found', status: 404 };
    if (grant.ownerUserId !== actorUserId) {
        return { error: 'Only the owner can revoke this grant', status: 403 };
    }
    stmtDelete.run(grantId);
    return { ok: true };
}
function canSetAnimation(actorUserId, deviceId) {
    const claim = claimService.getClaimByDevice(deviceId);
    if (!claim)
        return false;
    if (claim.userId === actorUserId)
        return true;
    const grants = stmtForDevice.all(claim.userId, deviceId);
    for (const g of grants) {
        if (g.granteeType === 'user' && g.granteeId === actorUserId)
            return true;
        if (g.granteeType === 'group' && groupService.isApprovedMember(g.granteeId, actorUserId)) {
            return true;
        }
    }
    return false;
}
/** Push set_animation to device over WS. Firmware may ignore until supported. */
function pushAnimationToDevice(actorUserId, deviceId, payload) {
    if (!canSetAnimation(actorUserId, deviceId)) {
        return { error: 'No permission to set animation on this device', status: 403 };
    }
    const device = deviceService.getDevice(deviceId);
    if (!device) {
        return { error: 'Device not found or offline', status: 404 };
    }
    try {
        device.ws.send(JSON.stringify({
            type: 'set_animation',
            libraryId: payload.libraryId,
            filename: payload.filename,
            animationId: payload.animationId ?? payload.libraryId,
        }));
    }
    catch {
        return { error: 'Failed to send to device', status: 502 };
    }
    return { ok: true };
}
//# sourceMappingURL=animation.service.js.map