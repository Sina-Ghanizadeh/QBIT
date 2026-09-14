import { useState, useEffect, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import Navbar from './components/Navbar';
import NetworkGraph from './components/NetworkGraph';
import SocialNetworkGraph from './components/SocialNetworkGraph';
import DashboardPage from './components/DashboardPage';
import DevicesPage from './components/DevicesPage';
import GroupsPage from './components/GroupsPage';
import PokeDialog from './components/PokeDialog';
import type { BitmapPayload } from './components/PokeDialog';
import UserPokeDialog from './components/UserPokeDialog';
import AddFriendDialog from './components/AddFriendDialog';
import FlashPage from './components/FlashPage';
import LibraryPage from './components/LibraryPage';
import PokeHistoryPanel from './components/PokeHistoryPanel';
import ReportDialog from './components/ReportDialog';
import type { Device, User, OnlineUser, NetworkUserNode, GroupInfo } from './types';
import { isTTSSupported, speakPokeMessage } from './utils/tts';
import { getPokeHistory, addPokeHistory, clearPokeHistory, type PokeHistoryEntry } from './utils/pokeHistory';

export type Page = 'dashboard' | 'devices' | 'network' | 'groups' | 'flash' | 'library';
export type NetworkMode = 'legacy' | 'global' | 'group';

const API_URL = import.meta.env.VITE_API_URL || '';

interface PokeNotification {
  id: number;
  from: string;
  text: string;
  exiting?: boolean;
}

export default function App() {
  const [page, setPage] = useState<Page>('network');
  const [devices, setDevices] = useState<Device[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [selectedUser, setSelectedUser] = useState<OnlineUser | null>(null);
  const [addFriendDevice, setAddFriendDevice] = useState<Device | null>(null);
  const [friendIds, setFriendIds] = useState<string[]>([]);
  const [friendDisplayNames, setFriendDisplayNames] = useState<Record<string, string>>({});
  const [friendAvatars, setFriendAvatars] = useState<Record<string, string>>({});
  const [friendPairs, setFriendPairs] = useState<Array<{ a: string; b: string }>>([]);
  const [onlyFriendsCanPoke, setOnlyFriendsCanPoke] = useState(false);
  const [publicFriends, setPublicFriends] = useState(true);
  const [notifications, setNotifications] = useState<PokeNotification[]>([]);
  const [showPokeHistory, setShowPokeHistory] = useState(false);
  const [pokeHistoryEntries, setPokeHistoryEntries] = useState<PokeHistoryEntry[]>([]);
  const [showReport, setShowReport] = useState(false);
  const notificationIdRef = useRef(0);
  const socketRef = useRef<Socket | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const fetchFriendsRef = useRef<() => void>(() => {});
  const addFriendDeviceRef = useRef<Device | null>(null);
  const devicesRef = useRef<Device[]>([]);
  const networkBarTouchStartRef = useRef<number | null>(null);
  const networkBarMouseStartRef = useRef<number | null>(null);
  const pillOpenedByMouseDragRef = useRef(false);
  const [isPillMouseDragging, setIsPillMouseDragging] = useState(false);
  const [pokeHighlight, setPokeHighlight] = useState<{
    deviceId?: string;
    publicUserId?: string;
    seq: number;
  } | null>(null);

  const [networkMode, setNetworkMode] = useState<NetworkMode>('global');
  const [networkUsers, setNetworkUsers] = useState<NetworkUserNode[]>([]);
  const networkUsersRef = useRef<NetworkUserNode[]>([]);
  const [myGroups, setMyGroups] = useState<GroupInfo[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string>('');
  const [networkError, setNetworkError] = useState<string | null>(null);
  const fetchScopedNetworkRef = useRef<() => void>(() => {});
  const networkModeRef = useRef(networkMode);

  const openPokeHistoryIfSwipeUp = useCallback((startY: number, endY: number) => {
    if (startY - endY > 28) {
      setPokeHistoryEntries(getPokeHistory());
      setShowPokeHistory(true);
    }
  }, []);

  useEffect(() => {
    if (!isPillMouseDragging) return;
    const handleMouseMove = (e: MouseEvent) => {
      const startY = networkBarMouseStartRef.current;
      if (startY == null) return;
      if (startY - e.clientY > 28) {
        pillOpenedByMouseDragRef.current = true;
        setPokeHistoryEntries(getPokeHistory());
        setShowPokeHistory(true);
        networkBarMouseStartRef.current = null;
        setIsPillMouseDragging(false);
      }
    };
    const handleMouseUp = (e: MouseEvent) => {
      const startY = networkBarMouseStartRef.current;
      if (startY != null) {
        if (startY - e.clientY > 28) pillOpenedByMouseDragRef.current = true;
        openPokeHistoryIfSwipeUp(startY, e.clientY);
      }
      networkBarMouseStartRef.current = null;
      setIsPillMouseDragging(false);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isPillMouseDragging, openPokeHistoryIfSwipeUp]);

  useEffect(() => {
    fetch(`${API_URL}/auth/me`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((u) => {
        setUser(u);
        if (u) setPage('dashboard');
      })
      .catch(() => setUser(null));
  }, []);

  useEffect(() => {
    if (!user && (page === 'dashboard' || page === 'groups' || page === 'devices')) {
      setPage('network');
    }
  }, [user, page]);

  const fetchFriends = useCallback(() => {
    if (user) {
      fetch(`${API_URL}/api/friends`, { credentials: 'include' })
        .then((r) => (r.ok ? r.json() : { friendIds: [], friends: [] }))
        .then((data) => {
          const ids = data.friendIds || [];
          const friends = data.friends || [];
          setFriendIds(ids);
          const names: Record<string, string> = {};
          const avatars: Record<string, string> = {};
          friends.forEach((f: { publicUserId: string; displayName: string; avatar?: string }) => {
            names[f.publicUserId] = f.displayName ?? 'Friend';
            avatars[f.publicUserId] = f.avatar ?? '';
          });
          setFriendDisplayNames(names);
          setFriendAvatars(avatars);
        })
        .catch(() => {
          setFriendIds([]);
          setFriendDisplayNames({});
          setFriendAvatars({});
        });
    } else {
      setFriendIds([]);
      setFriendDisplayNames({});
      setFriendAvatars({});
    }
    fetch(`${API_URL}/api/friends/pairs`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { friendPairs: [] }))
      .then((data) => setFriendPairs(data.friendPairs || []))
      .catch(() => setFriendPairs([]));
  }, [user]);

  const fetchSettings = useCallback(() => {
    if (!user) {
      setOnlyFriendsCanPoke(false);
      setPublicFriends(true);
      return;
    }
    fetch(`${API_URL}/api/me/settings`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { onlyFriendsCanPoke: false, publicFriends: true }))
      .then((data) => {
        setOnlyFriendsCanPoke(!!data.onlyFriendsCanPoke);
        setPublicFriends(data.publicFriends !== false);
      })
      .catch(() => {
        setOnlyFriendsCanPoke(false);
        setPublicFriends(true);
      });
  }, [user]);

  useEffect(() => {
    fetchFriends();
    fetchSettings();
  }, [fetchFriends, fetchSettings]);

  const fetchScopedNetwork = useCallback(() => {
    if (!user || networkMode === 'legacy') return;
    setNetworkError(null);
    if (networkMode === 'global') {
      fetch(`${API_URL}/api/network/global`, { credentials: 'include' })
        .then(async (r) => {
          const data = await r.json();
          if (!r.ok) throw new Error(data.error || 'Failed to load global network');
          setNetworkUsers(data.users || []);
        })
        .catch((e) => {
          setNetworkUsers([]);
          setNetworkError(e instanceof Error ? e.message : 'Failed');
        });
      return;
    }
    if (!selectedGroupId) {
      setNetworkUsers([]);
      return;
    }
    fetch(`${API_URL}/api/network/groups/${selectedGroupId}`, { credentials: 'include' })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Failed to load group network');
        setNetworkUsers(data.users || []);
      })
      .catch((e) => {
        setNetworkUsers([]);
        setNetworkError(e instanceof Error ? e.message : 'Failed');
      });
  }, [user, networkMode, selectedGroupId]);

  useEffect(() => {
    networkUsersRef.current = networkUsers;
  }, [networkUsers]);
  useEffect(() => {
    fetchScopedNetworkRef.current = fetchScopedNetwork;
  }, [fetchScopedNetwork]);
  useEffect(() => {
    networkModeRef.current = networkMode;
  }, [networkMode]);

  useEffect(() => {
    if (!user) return;
    fetch(`${API_URL}/api/groups/mine`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { groups: [] }))
      .then((d) => {
        const approved = (d.groups || []).filter((g: GroupInfo) => g.memberStatus === 'approved');
        setMyGroups(approved);
        setSelectedGroupId((prev) => prev || approved[0]?.id || '');
      })
      .catch(() => setMyGroups([]));
  }, [user]);

  useEffect(() => {
    if (page !== 'network') return;
    fetchScopedNetwork();
    const t = setInterval(fetchScopedNetwork, 8000);
    return () => clearInterval(t);
  }, [page, fetchScopedNetwork]);

  useEffect(() => {
    addFriendDeviceRef.current = addFriendDevice;
  }, [addFriendDevice]);

  useEffect(() => {
    devicesRef.current = devices;
  }, [devices]);

  fetchFriendsRef.current = fetchFriends;

  useEffect(() => {
    const s = io(API_URL || window.location.origin, {
      withCredentials: true,
    });

    s.on('devices:update', (data: Device[]) => {
      devicesRef.current = data;
      setDevices(data);
      if (networkModeRef.current !== 'legacy') fetchScopedNetworkRef.current();
    });

    s.on('users:update', (data: OnlineUser[]) => {
      setOnlineUsers(data);
      if (networkModeRef.current !== 'legacy') fetchScopedNetworkRef.current();
    });

    s.on('poke:highlight', (data: { deviceToken?: string; publicUserId?: string }) => {
      const { deviceToken, publicUserId } = data;
      const list = devicesRef.current;
      let resolvedDeviceId =
        deviceToken != null ? list.find((d) => d.pokeToken === deviceToken)?.id : undefined;
      if (!resolvedDeviceId && deviceToken) {
        for (const u of networkUsersRef.current) {
          const d = u.devices.find((x) => x.pokeToken === deviceToken);
          if (d) {
            resolvedDeviceId = d.deviceId;
            break;
          }
        }
      }
      setPokeHighlight((prev) => {
        const same =
          prev &&
          ((resolvedDeviceId != null && prev.deviceId === resolvedDeviceId) ||
            (publicUserId != null && prev.publicUserId === publicUserId));
        const seq = same ? Math.min(prev!.seq + 1, 5) : 1;
        return { deviceId: resolvedDeviceId, publicUserId, seq };
      });
    });

    s.on('friends:update', () => {
      setAddFriendDevice(null);
      fetchFriendsRef.current();
    });

    s.on('friend_request:result', () => {
      setAddFriendDevice(null);
    });

    s.on('poke', (data: { from: string; text: string }) => {
      addPokeHistory({ fromUserId: '', fromName: data.from, direction: 'received', text: data.text });
      const id = ++notificationIdRef.current;
      setNotifications((prev) => {
        const next = [...prev, { id, from: data.from, text: data.text }];
        return next.slice(-3);
      });
      if (isTTSSupported()) {
        speakPokeMessage(data.from, data.text);
      }
      setTimeout(() => {
        setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, exiting: true } : n)));
        setTimeout(() => {
          setNotifications((prev) => prev.filter((n) => n.id !== id));
        }, 300);
      }, 10000);
    });

    socketRef.current = s;
    setSocket(s);
    return () => {
      s.disconnect();
      setSocket(null);
    };
  }, []);

  const handlePoke = useCallback(async (targetId: string, text: string, bitmapData?: BitmapPayload) => {
    try {
      const body: Record<string, unknown> = { targetId, text };
      if (bitmapData) {
        body.senderBitmap = bitmapData.senderBitmap;
        body.senderBitmapWidth = bitmapData.senderBitmapWidth;
        body.textBitmap = bitmapData.textBitmap;
        body.textBitmapWidth = bitmapData.textBitmapWidth;
      }

      const res = await fetch(`${API_URL}/api/poke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'Failed to send poke');
        return;
      }
    } catch {
      alert('Network error');
      return;
    }
    setSelectedDevice(null);
  }, []);

  const handleUnclaim = useCallback(async (device: Device) => {
    if (!confirm(`Unclaim ${device.name}?`)) return;
    try {
      const res = await fetch(`${API_URL}/api/claim/${device.pokeToken}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'Failed to unclaim');
        return;
      }
    } catch {
      alert('Network error');
      return;
    }
    setSelectedDevice(null);
  }, []);

  const handleDeviceSelect = useCallback((device: Device) => {
    setSelectedDevice(device);
  }, []);

  const handleUserSelect = useCallback((onlineUser: OnlineUser) => {
    setSelectedUser(onlineUser);
  }, []);

  const handleUserPoke = useCallback(
    async (targetPublicUserId: string, text: string, targetDisplayName?: string) => {
      try {
        const res = await fetch(`${API_URL}/api/poke/user`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ targetPublicUserId, text }),
        });
        if (!res.ok) {
          const data = await res.json();
          alert(data.error || 'Failed to send poke');
          return;
        }
        addPokeHistory({
          fromUserId: targetPublicUserId,
          fromName: targetDisplayName ?? 'User',
          direction: 'sent',
          text,
        });
      } catch {
        alert('Network error');
        return;
      }
      setSelectedUser(null);
    },
    []
  );

  const scopedNodeCount = networkUsers.reduce((n, u) => n + 1 + u.devices.length, 0);
  const hasLegacyNodes = devices.length > 0 || onlineUsers.length > 0;
  const hasNetworkNodes = networkMode === 'legacy' ? hasLegacyNodes : scopedNodeCount > 0;
  const deviceCountScoped = networkUsers.reduce((n, u) => n + u.devices.length, 0);

  return (
    <div className="app">
      <Navbar user={user} apiUrl={API_URL} page={page} setPage={setPage} onUserChange={setUser} />
      <main className="main">
        {page === 'dashboard' && user && (
          <DashboardPage
            user={user}
            onOpenNetwork={() => setPage('network')}
            onOpenGroups={() => setPage('groups')}
            onOpenDevices={() => setPage('devices')}
          />
        )}
        {page === 'devices' && user && (
          <DevicesPage user={user} liveDevices={devices} socket={socket} />
        )}
        {page === 'groups' && user && <GroupsPage user={user} />}
        {page === 'network' && (
          <>
            <div className="network-mode-bar">
              <div className="network-mode-switch">
                <button
                  type="button"
                  className={networkMode === 'global' ? 'active' : ''}
                  onClick={() => setNetworkMode('global')}
                  disabled={!user}
                >
                  Global
                </button>
                <button
                  type="button"
                  className={networkMode === 'group' ? 'active' : ''}
                  onClick={() => setNetworkMode('group')}
                  disabled={!user}
                >
                  Group
                </button>
                <button
                  type="button"
                  className={networkMode === 'legacy' ? 'active' : ''}
                  onClick={() => setNetworkMode('legacy')}
                >
                  Live
                </button>
              </div>
              {networkMode === 'group' && user && (
                <select
                  className="network-group-select"
                  value={selectedGroupId}
                  onChange={(e) => setSelectedGroupId(e.target.value)}
                >
                  <option value="">Select group…</option>
                  {myGroups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {networkError && <div className="network-mode-error">{networkError}</div>}
            {!user && networkMode !== 'legacy' ? (
              <div className="empty-state">
                <p>Log in to view Global or Group networks</p>
                <p className="empty-sub">Or switch to Live to see online devices.</p>
              </div>
            ) : !hasNetworkNodes ? (
              <div className="empty-state">
                <p>
                  {networkMode === 'global'
                    ? 'No global users yet'
                    : networkMode === 'group'
                      ? selectedGroupId
                        ? 'No members in this group'
                        : 'Select a group'
                      : 'No QBIT devices online'}
                </p>
                <p className="empty-sub">
                  {networkMode === 'global'
                    ? 'Enable Global in your Dashboard and show devices on the global network.'
                    : networkMode === 'group'
                      ? 'Join or create a group from the Groups page.'
                      : 'Devices will appear here when they connect.'}
                </p>
              </div>
            ) : networkMode === 'legacy' ? (
              <NetworkGraph
                devices={devices}
                onlineUsers={onlineUsers}
                currentUserId={user?.publicUserId ?? null}
                friendIds={friendIds}
                friendPairs={friendPairs}
                pokeHighlight={pokeHighlight}
                onPokeHighlightEnd={() => setPokeHighlight(null)}
                onSelectDevice={handleDeviceSelect}
                onSelectUser={handleUserSelect}
              />
            ) : (
              <SocialNetworkGraph
                users={networkUsers}
                currentUserId={user?.publicUserId ?? null}
                pokeHighlight={pokeHighlight}
                onPokeHighlightEnd={() => setPokeHighlight(null)}
                onSelectDevice={handleDeviceSelect}
                onSelectUser={handleUserSelect}
              />
            )}
            {hasNetworkNodes && !showPokeHistory && (
              <div className="network-online-pill-wrap">
                <div
                  className="network-device-count"
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    if (pillOpenedByMouseDragRef.current) {
                      pillOpenedByMouseDragRef.current = false;
                      return;
                    }
                    setPokeHistoryEntries(getPokeHistory());
                    setShowPokeHistory(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setPokeHistoryEntries(getPokeHistory());
                      setShowPokeHistory(true);
                    }
                  }}
                  onMouseDown={(e) => {
                    networkBarMouseStartRef.current = e.clientY;
                    setIsPillMouseDragging(true);
                  }}
                  onTouchStart={(e) => {
                    networkBarTouchStartRef.current = e.changedTouches[0].clientY;
                  }}
                  onTouchMove={(e) => {
                    const startY = networkBarTouchStartRef.current;
                    if (startY == null) return;
                    const currentY = e.changedTouches[0].clientY;
                    if (startY - currentY > 28) {
                      setPokeHistoryEntries(getPokeHistory());
                      setShowPokeHistory(true);
                      networkBarTouchStartRef.current = null;
                    }
                  }}
                  onTouchEnd={(e) => {
                    const startY = networkBarTouchStartRef.current;
                    if (startY == null) return;
                    const endY = e.changedTouches[0].clientY;
                    if (startY - endY > 28) {
                      setPokeHistoryEntries(getPokeHistory());
                      setShowPokeHistory(true);
                    }
                    networkBarTouchStartRef.current = null;
                  }}
                  aria-label="Network status. Tap to open Poke history"
                >
                  <span className="network-device-count-text">
                    {networkMode === 'legacy' ? (
                      <>
                        {devices.length > 0 && (
                          <span>
                            {devices.length} device{devices.length !== 1 ? 's' : ''}
                          </span>
                        )}
                        {devices.length > 0 && onlineUsers.length > 0 && ' · '}
                        {onlineUsers.length > 0 && (
                          <span>
                            {onlineUsers.length} user{onlineUsers.length !== 1 ? 's' : ''}
                          </span>
                        )}
                        {' online'}
                      </>
                    ) : (
                      <span>
                        {networkUsers.length} user{networkUsers.length !== 1 ? 's' : ''} ·{' '}
                        {deviceCountScoped} device{deviceCountScoped !== 1 ? 's' : ''}
                      </span>
                    )}
                  </span>
                </div>
              </div>
            )}
          </>
        )}
        {page === 'flash' && <FlashPage />}
        {page === 'library' && <LibraryPage user={user} apiUrl={API_URL} />}
      </main>
      {selectedDevice && (
        <PokeDialog
          device={selectedDevice}
          user={user}
          onPoke={handlePoke}
          onUnclaim={handleUnclaim}
          onAddFriend={(device) => {
            setSelectedDevice(null);
            setAddFriendDevice(device);
          }}
          onClose={() => setSelectedDevice(null)}
          isLoggedIn={!!user}
          friendIds={friendIds}
          friendDisplayNames={friendDisplayNames}
          friendAvatars={friendAvatars}
          onlineUsers={onlineUsers}
          onlyFriendsCanPoke={onlyFriendsCanPoke}
          onOnlyFriendsCanPokeChange={async (value) => {
            try {
              const res = await fetch(`${API_URL}/api/me/settings`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ onlyFriendsCanPoke: value }),
              });
              if (res.ok) setOnlyFriendsCanPoke(value);
            } catch {
              // ignore
            }
          }}
          publicFriends={publicFriends}
          onPublicFriendsChange={async (value) => {
            try {
              const res = await fetch(`${API_URL}/api/me/settings`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ publicFriends: value }),
              });
              if (res.ok) {
                setPublicFriends(value);
                fetchFriendsRef.current();
              }
            } catch {
              // ignore
            }
          }}
          onRemoveFriend={async (publicUserId) => {
            const res = await fetch(`${API_URL}/api/friends/${encodeURIComponent(publicUserId)}`, {
              method: 'DELETE',
              credentials: 'include',
            });
            if (!res.ok) {
              const data = await res.json();
              alert(data.error || 'Failed to remove friend');
              return;
            }
            fetchFriendsRef.current();
          }}
        />
      )}
      {selectedUser && (
        <UserPokeDialog
          target={selectedUser}
          onPoke={handleUserPoke}
          onClose={() => setSelectedUser(null)}
          isLoggedIn={!!user}
          isFriend={friendIds.includes(selectedUser.publicUserId)}
          onRemoveFriend={async (publicUserId) => {
            const res = await fetch(`${API_URL}/api/friends/${encodeURIComponent(publicUserId)}`, {
              method: 'DELETE',
              credentials: 'include',
            });
            if (!res.ok) {
              const data = await res.json();
              alert(data.error || 'Failed to remove friend');
              return;
            }
            fetchFriendsRef.current();
          }}
        />
      )}
      {addFriendDevice && (
        <AddFriendDialog
          device={addFriendDevice}
          apiUrl={API_URL}
          onClose={() => setAddFriendDevice(null)}
        />
      )}
      {hasNetworkNodes && (
        <PokeHistoryPanel
          entries={pokeHistoryEntries}
          hasEntries={pokeHistoryEntries.length > 0}
          onClose={() => setShowPokeHistory(false)}
          onClear={() => {
            clearPokeHistory();
            setPokeHistoryEntries([]);
          }}
          visible={showPokeHistory}
        />
      )}
      {showReport && (
        <ReportDialog
          onlineUsers={onlineUsers}
          apiUrl={API_URL}
          onClose={() => setShowReport(false)}
          onSubmitted={() => {}}
        />
      )}
      {page === 'network' && (
        <button
          type="button"
          className={`report-floating-btn${hasNetworkNodes ? ' report-floating-btn-stacked' : ''}`}
          onClick={() => setShowReport(true)}
          title="Report user"
          aria-label="Report user"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path fill="currentColor" d="M14.4 6L14 4H5v17h2v-7h5.6l.4 2h7V6h-5.6z" />
          </svg>
        </button>
      )}
      <div className="poke-notifications" aria-live="polite">
        {notifications.map((n) => (
          <div
            key={n.id}
            className={`poke-notification ${n.exiting ? 'poke-notification-exit' : 'poke-notification-enter'}`}
          >
            <div className="poke-notification-from">Poke from {n.from}</div>
            <div className="poke-notification-text">{n.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
