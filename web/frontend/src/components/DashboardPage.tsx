import { useCallback, useEffect, useState } from 'react';
import type { GroupInfo, NetworkDeviceNode, User } from '../types';

const API_URL = import.meta.env.VITE_API_URL || '';

interface Props {
  user: User;
  onOpenNetwork: () => void;
  onOpenGroups: () => void;
  onOpenDevices: () => void;
}

interface BotLink {
  platform: string;
  linked: boolean;
  platformUsername: string | null;
  linkedAt: string | null;
}

interface AnimationGrant {
  id: string;
  deviceId: string | null;
  granteeType: 'user' | 'group';
  granteeId: string;
  createdAt: string;
}

export default function DashboardPage({ user, onOpenNetwork, onOpenGroups, onOpenDevices }: Props) {
  const [isGlobal, setIsGlobal] = useState(false);
  const [devices, setDevices] = useState<NetworkDeviceNode[]>([]);
  const [myGroups, setMyGroups] = useState<GroupInfo[]>([]);
  const [bots, setBots] = useState<BotLink[]>([]);
  const [grants, setGrants] = useState<AnimationGrant[]>([]);
  const [linkCode, setLinkCode] = useState<string | null>(null);
  const [linkExpires, setLinkExpires] = useState<string | null>(null);
  const [grantType, setGrantType] = useState<'user' | 'group'>('user');
  const [grantTarget, setGrantTarget] = useState('');
  const [grantDeviceId, setGrantDeviceId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetch(`${API_URL}/api/me/settings`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setIsGlobal(!!d.isGlobal);
      })
      .catch(() => {});

    fetch(`${API_URL}/api/me/devices`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { devices: [] }))
      .then((d) => setDevices(d.devices || []))
      .catch(() => setDevices([]));

    fetch(`${API_URL}/api/groups/mine`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { groups: [] }))
      .then((d) => setMyGroups(d.groups || []))
      .catch(() => setMyGroups([]));

    fetch(`${API_URL}/api/me/bots`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { links: [] }))
      .then((d) => setBots(d.links || []))
      .catch(() => setBots([]));

    fetch(`${API_URL}/api/me/animation-grants`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { grants: [] }))
      .then((d) => setGrants(d.grants || []))
      .catch(() => setGrants([]));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const toggleGlobal = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/me/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ isGlobal: !isGlobal }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setIsGlobal(!!data.isGlobal);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const toggleDeviceGlobal = async (deviceId: string, showInGlobal: boolean) => {
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/me/devices/${encodeURIComponent(deviceId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ showInGlobal }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setDevices((prev) =>
        prev.map((d) => (d.deviceId === deviceId ? { ...d, showInGlobal: data.showInGlobal } : d))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  };

  const startTelegramLink = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/me/bots/telegram/link`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setLinkCode(data.verifyCode);
      setLinkExpires(data.expiresAt);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const unlinkTelegram = async () => {
    await fetch(`${API_URL}/api/me/bots/telegram`, { method: 'DELETE', credentials: 'include' });
    setLinkCode(null);
    refresh();
  };

  const addGrant = async () => {
    if (!grantTarget.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/me/animation-grants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          granteeType: grantType,
          granteeId: grantTarget.trim(),
          deviceId: grantDeviceId || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setGrantTarget('');
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const revokeGrant = async (id: string) => {
    await fetch(`${API_URL}/api/me/animation-grants/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    refresh();
  };

  const telegramLinked = bots.some((b) => b.platform === 'telegram' && b.linked);
  const pendingGroups = myGroups.filter((g) => g.memberStatus === 'pending');

  return (
    <div className="page-scroll dashboard-page">
      <header className="page-header">
        <h1>Dashboard</h1>
        <p className="page-sub">Welcome, {user.displayName}</p>
      </header>

      {error && <div className="page-error">{error}</div>}

      <section className="dash-section">
        <h2>Global network</h2>
        <p className="page-sub">Appear on the global Network graph for other global users.</p>
        <label className="dash-toggle">
          <input type="checkbox" checked={isGlobal} disabled={busy} onChange={toggleGlobal} />
          <span>I am a global user</span>
        </label>
      </section>

      <section className="dash-section">
        <div className="dash-section-head">
          <h2>My devices</h2>
          <button type="button" className="btn-secondary" onClick={onOpenDevices}>
            Manage
          </button>
        </div>
        {devices.length === 0 ? (
          <p className="page-sub">No claimed devices yet. Add one from the Devices page.</p>
        ) : (
          <ul className="dash-list">
            {devices.map((d) => (
              <li key={d.deviceId} className="dash-list-item">
                <div>
                  <strong>{d.name}</strong>
                  <span className="page-sub">
                    {' '}
                    · {d.online ? 'online' : 'offline'}
                  </span>
                </div>
                <label className="dash-toggle compact">
                  <input
                    type="checkbox"
                    checked={!!d.showInGlobal}
                    onChange={(e) => toggleDeviceGlobal(d.deviceId, e.target.checked)}
                  />
                  <span>Show in global</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="dash-section">
        <div className="dash-section-head">
          <h2>Groups</h2>
          <button type="button" className="btn-secondary" onClick={onOpenGroups}>
            Manage
          </button>
        </div>
        {myGroups.length === 0 ? (
          <p className="page-sub">You have not joined any groups.</p>
        ) : (
          <ul className="dash-list">
            {myGroups.slice(0, 5).map((g) => (
              <li key={g.id} className="dash-list-item">
                <div>
                  <strong>{g.name}</strong>
                  <span className="page-sub">
                    {' '}
                    · {g.visibility} · {g.memberStatus}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
        {pendingGroups.length > 0 && (
          <p className="page-sub">{pendingGroups.length} pending join request(s)</p>
        )}
      </section>

      <section className="dash-section">
        <h2>Animation permissions</h2>
        <p className="page-sub">Allow a user or group to set animations on your device(s).</p>
        <div className="dash-form-row">
          <select value={grantType} onChange={(e) => setGrantType(e.target.value as 'user' | 'group')}>
            <option value="user">User (public ID)</option>
            <option value="group">Group ID</option>
          </select>
          <input
            placeholder={grantType === 'user' ? 'Public user ID' : 'Group ID'}
            value={grantTarget}
            onChange={(e) => setGrantTarget(e.target.value)}
          />
          <select value={grantDeviceId} onChange={(e) => setGrantDeviceId(e.target.value)}>
            <option value="">All my devices</option>
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.name}
              </option>
            ))}
          </select>
          <button type="button" className="btn-primary" disabled={busy} onClick={addGrant}>
            Grant
          </button>
        </div>
        {grants.length > 0 && (
          <ul className="dash-list">
            {grants.map((g) => (
              <li key={g.id} className="dash-list-item">
                <span>
                  {g.granteeType}:{g.granteeId.slice(0, 12)}…
                  {g.deviceId ? ` @ ${g.deviceId.slice(0, 8)}` : ' (all)'}
                </span>
                <button type="button" className="btn-text" onClick={() => revokeGrant(g.id)}>
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="dash-section">
        <h2>Telegram</h2>
        {telegramLinked ? (
          <div className="dash-form-row">
            <span className="page-sub">Linked</span>
            <button type="button" className="btn-secondary" onClick={unlinkTelegram}>
              Unlink
            </button>
          </div>
        ) : (
          <>
            <button type="button" className="btn-primary" disabled={busy} onClick={startTelegramLink}>
              Generate link code
            </button>
            {linkCode && (
              <p className="dash-code">
                Send to the bot: <code>/start {linkCode}</code>
                {linkExpires && (
                  <span className="page-sub"> (expires {new Date(linkExpires).toLocaleTimeString()})</span>
                )}
              </p>
            )}
          </>
        )}
      </section>

      <section className="dash-section dash-actions">
        <button type="button" className="btn-primary" onClick={onOpenDevices}>
          Devices
        </button>
        <button type="button" className="btn-primary" onClick={onOpenNetwork}>
          Open Network
        </button>
        <button type="button" className="btn-secondary" onClick={onOpenGroups}>
          Browse Groups
        </button>
      </section>
    </div>
  );
}
