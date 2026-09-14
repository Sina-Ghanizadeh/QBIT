export interface Device {
  id: string;
  name: string;
  ip: string;
  publicIp?: string;
  version: string;
  connectedAt: string;
  pokeToken: string;
  claimedBy?: {
    publicUserId: string;
    userName: string;
    userAvatar: string;
  } | null;
}

export interface UserSettings {
  onlyFriendsCanPoke: boolean;
  publicFriends?: boolean;
  isGlobal?: boolean;
}

export interface User {
  publicUserId: string;
  displayName: string;
  email: string;
  avatar: string;
}

export interface OnlineUser {
  publicUserId: string;
  displayName: string;
  avatar?: string;
  connectedAt: string;
  socketIds: string[];
}

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

export interface GroupInfo {
  id: string;
  name: string;
  description: string;
  visibility: 'public' | 'private';
  inviteCode?: string;
  ownerPublicUserId: string;
  createdAt: string;
  memberRole?: string;
  memberStatus?: string;
  memberCount?: number;
}
