import { useCallback, useEffect, useState } from 'react';
import type { NetworkDeviceNode, User } from '../types';
import ActivityFeed, { type ActivityEventDto } from './ActivityFeed';

const API_URL = import.meta.env.VITE_API_URL || '';

interface Props {
  user: User;
  liveActivity?: ActivityEventDto | null;
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

export default function ProfilePage({ user, liveActivity = null }: Props) {
  const [isGlobal, setIsGlobal] = useState(false);
  const [devices, setDevices] = useState<NetworkDeviceNode[]>([]);
  const [bots, setBots] = useState<BotLink[]>([]);
  const [grants, setGrants] = useState<AnimationGrant[]>([]);
  const [linkCode, setLinkCode] = useState<string | null>(null);
  const [linkExpires, setLinkExpires] = useState<string | null>(null);
  const [grantType, setGrantType] = useState<'user' | 'group'>('user');
  const [grantTarget, setGrantTarget] = useState('');
  const [grantDeviceId, setGrantDeviceId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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

    fetch(`${API_URL}/api/me/bots`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { links: [] }))
      .then((d) => setBots(d.links || []))
      .catch(() => setBots([]));

    fetch(`${API_URL}/api/me/animation-grants`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { grants: [] }))
      .then((d) => setGrants(d.grants || []))
      .catch(() => setGrants([]));
  }, []);

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

  useEffect(() => {
    refresh();
  }, [refresh]);

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

  const copyPublicId = async () => {
    try {
      await navigator.clipboard.writeText(user.publicUserId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // ignore
    }
  };

  const telegramLinked = bots.some((b) => b.platform === 'telegram' && b.linked);

  return (
    <div className="page-scroll profile-page">
      <header className="page-header">
        <h1>Profile</h1>
        <p className="page-sub">Activity, account, and advanced connections.</p>
      </header>

      {error && <div className="page-error">{error}</div>}

      <section className="dash-section profile-card">
        <div className="profile-identity">
          {user.avatar ? (
            <img
              className="profile-avatar"
              src={user.avatar}
              alt=""
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="profile-avatar profile-avatar-fallback" aria-hidden>
              {(user.displayName || '?').slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="profile-identity-text">
            <h2>{user.displayName}</h2>
            <p className="page-sub">Public ID</p>
            <div className="profile-id-row">
              <code className="profile-id">{user.publicUserId}</code>
              <button type="button" className="btn-secondary" onClick={() => void copyPublicId()}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="dash-section">
        <h2>Appear on Global</h2>
        <p className="page-sub">When on, you show up in Network → Global for other global users.</p>
        <label className="dash-toggle">
          <input type="checkbox" checked={isGlobal} disabled={busy} onChange={() => void toggleGlobal()} />
          <span>{isGlobal ? 'Global is on' : 'Global is off'}</span>
        </label>
      </section>

      <ActivityFeed apiUrl={API_URL} liveEvent={liveActivity} />

      <section className="dash-section">
        <h2>Animation permissions</h2>
        <p className="page-sub">Let a friend or group set GIFs on your device.</p>
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
          <button type="button" className="btn-primary" disabled={busy} onClick={() => void addGrant()}>
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
                <button type="button" className="btn-text" onClick={() => void revokeGrant(g.id)}>
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="dash-section">
        <h2>Telegram</h2>
        <p className="page-sub">Link the bot for water and routine reminders outside the web app.</p>
        {telegramLinked ? (
          <div className="dash-form-row">
            <span className="page-sub">Linked</span>
            <button type="button" className="btn-secondary" onClick={() => void unlinkTelegram()}>
              Unlink
            </button>
          </div>
        ) : (
          <>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => void startTelegramLink()}>
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
    </div>
  );
}
