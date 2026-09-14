// ---------------------------------------------------------------------------
//  Scoped network graph payloads (global / group)
// ---------------------------------------------------------------------------

import db from '../db';
import * as claimService from './claim.service';
import * as deviceService from './device.service';
import * as groupService from './group.service';
import * as socialService from './social.service';
import * as userService from './user.service';
import * as socketService from './socket.service';
import { ensurePublicUserId } from './publicUserId.service';

export interface NetworkDeviceNode {
  deviceId: string;
  pokeToken: string | null;
  name: string;
  online: boolean;
  showInGlobal?: boolean;
  version?: string;
  connectedAt?: string;
}

export interface NetworkUserNode {
  publicUserId: string;
  displayName: string;
  avatar: string;
  isGlobal: boolean;
  online: boolean;
  devices: NetworkDeviceNode[];
}

function onlineUserIdSet(): Set<string> {
  const set = new Set<string>();
  for (const u of socketService.getOnlineUsersMap().values()) {
    set.add(u.userId);
  }
  return set;
}

function devicesForUser(userId: string, opts: { globalOnly: boolean }): NetworkDeviceNode[] {
  const claims = claimService.getAllClaims();
  const live = deviceService.getDevicesRaw();
  const out: NetworkDeviceNode[] = [];
  for (const [deviceId, claim] of Object.entries(claims)) {
    if (claim.userId !== userId) continue;
    const showInGlobal = claimService.getShowInGlobal(deviceId);
    if (opts.globalOnly && !showInGlobal) continue;
    const liveDev = live.get(deviceId);
    out.push({
      deviceId,
      pokeToken: liveDev?.pokeToken ?? null,
      name: liveDev?.name ?? deviceId.slice(0, 8),
      online: !!liveDev,
      showInGlobal,
      version: liveDev?.version,
      connectedAt: liveDev?.connectedAt.toISOString(),
    });
  }
  return out;
}

function toUserNode(userId: string, online: Set<string>, globalOnly: boolean): NetworkUserNode | null {
  const u = userService.getUserById(userId);
  if (!u) return null;
  return {
    publicUserId: ensurePublicUserId(userId),
    displayName: u.displayName || 'User',
    avatar: u.avatar || '',
    isGlobal: socialService.getIsGlobal(userId),
    online: online.has(userId),
    devices: devicesForUser(userId, { globalOnly }),
  };
}

/** Users with isGlobal=true and their showInGlobal devices. */
export function getGlobalNetwork(): { users: NetworkUserNode[] } {
  const online = onlineUserIdSet();
  const rows = db
    .prepare('SELECT userId FROM user_settings WHERE isGlobal = 1')
    .all() as Array<{ userId: string }>;
  const users: NetworkUserNode[] = [];
  for (const r of rows) {
    const node = toUserNode(r.userId, online, true);
    if (node) users.push(node);
  }
  return { users };
}

export function getGroupNetwork(
  groupId: string,
  viewerUserId: string
): { users: NetworkUserNode[] } | { error: string; status: number } {
  if (!groupService.isApprovedMember(groupId, viewerUserId)) {
    return { error: 'You must be an approved member to view this group network', status: 403 };
  }
  const online = onlineUserIdSet();
  const memberIds = groupService.listApprovedMemberIds(groupId);
  const users: NetworkUserNode[] = [];
  for (const userId of memberIds) {
    const node = toUserNode(userId, online, false);
    if (node) users.push(node);
  }
  return { users };
}

/** Devices claimed by a user (for dashboard). */
export function getMyDevices(userId: string): NetworkDeviceNode[] {
  return devicesForUser(userId, { globalOnly: false });
}
