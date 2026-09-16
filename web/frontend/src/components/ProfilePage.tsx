import { useCallback, useEffect, useState } from 'react';
import type { NetworkDeviceNode, User } from '../types';
import { useI18n } from '../i18n';
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

interface AnimationTarget {
  deviceId: string;
  deviceName: string;
  online: boolean;
  ownerPublicUserId: string;
  ownerDisplayName: string;
  via: 'user' | 'group';
  groupId?: string;
  grantId: string;
}

interface LibraryOption {
  id: string;
  filename: string;
}

export default function ProfilePage({ user, liveActivity = null }: Props) {
  const { t } = useI18n();
  const [isGlobal, setIsGlobal] = useState(false);
  const [devices, setDevices] = useState<NetworkDeviceNode[]>([]);
  const [bots, setBots] = useState<BotLink[]>([]);
  const [grants, setGrants] = useState<AnimationGrant[]>([]);
  const [targets, setTargets] = useState<AnimationTarget[]>([]);
  const [library, setLibrary] = useState<LibraryOption[]>([]);
  const [gifByDevice, setGifByDevice] = useState<Record<string, string>>({});
  const [sendingDeviceId, setSendingDeviceId] = useState<string | null>(null);
  const [animMsg, setAnimMsg] = useState<string | null>(null);
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

    fetch(`${API_URL}/api/me/animation-targets`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { targets: [] }))
      .then((d) => setTargets(d.targets || []))
      .catch(() => setTargets([]));

    fetch(`${API_URL}/api/library?sort=newest`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => {
        const list = Array.isArray(d) ? d : [];
        setLibrary(
          list.slice(0, 60).map((x: { id: string; filename: string }) => ({
            id: x.id,
            filename: x.filename,
          }))
        );
      })
      .catch(() => setLibrary([]));
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
    const id = window.setInterval(refresh, 30_000);
    return () => window.clearInterval(id);
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

  const setGifOnTarget = async (deviceId: string) => {
    const libraryId = gifByDevice[deviceId] || library[0]?.id;
    if (!libraryId) {
      setError('Pick a library GIF first');
      return;
    }
    setSendingDeviceId(deviceId);
    setError(null);
    setAnimMsg(null);
    try {
      const res = await fetch(`${API_URL}/api/devices/${encodeURIComponent(deviceId)}/animation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ libraryId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to set animation');
      setAnimMsg('GIF sent — device is downloading and playing.');
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setSendingDeviceId(null);
    }
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
        <h1>{t('profile.title')}</h1>
        <p className="page-sub">{t('profile.sub')}</p>
      </header>

      {error && <div className="page-error">{error}</div>}
      {animMsg && <p className="page-sub">{animMsg}</p>}

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
            <p className="page-sub">{t('profile.publicId')}</p>
            <div className="profile-id-row">
              <code className="profile-id">{user.publicUserId}</code>
              <button type="button" className="btn-secondary" onClick={() => void copyPublicId()}>
                {copied ? t('profile.copied') : t('profile.copy')}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="dash-section">
        <h2>{t('profile.globalTitle')}</h2>
        <p className="page-sub">{t('profile.globalSub')}</p>
        <label className="dash-toggle">
          <input type="checkbox" checked={isGlobal} disabled={busy} onChange={() => void toggleGlobal()} />
          <span>{isGlobal ? t('profile.globalOn') : t('profile.globalOff')}</span>
        </label>
      </section>

      <ActivityFeed apiUrl={API_URL} liveEvent={liveActivity} />

      <section className="dash-section">
        <h2>{t('profile.canAnimate')}</h2>
        <p className="page-sub">
          {t('profile.canAnimateSub')}
        </p>
        {targets.length === 0 ? (
          <p className="page-sub">{t('profile.canAnimateEmpty')}</p>
        ) : (
          <ul className="dash-list">
            {targets.map((target) => {
              const selected = gifByDevice[target.deviceId] || library[0]?.id || '';
              return (
                <li key={`${target.grantId}-${target.deviceId}`} className="dash-list-item col">
                  <div>
                    <strong>{target.deviceName}</strong>
                    <span className={`status-pill ${target.online ? 'on' : 'off'}`}>
                      {target.online ? t('status.online') : t('status.offline')}
                    </span>
                    <p className="page-sub">
                      {t('profile.owner', { name: target.ownerDisplayName })}
                      {target.via === 'group' ? t('profile.viaGroup') : t('profile.viaDirect')}
                    </p>
                  </div>
                  <div className="dash-form-row">
                    <select
                      value={selected}
                      disabled={!target.online || library.length === 0 || sendingDeviceId === target.deviceId}
                      onChange={(e) =>
                        setGifByDevice((prev) => ({ ...prev, [target.deviceId]: e.target.value }))
                      }
                      aria-label={`GIF for ${target.deviceName}`}
                    >
                      {library.length === 0 ? (
                        <option value="">{t('profile.noLibrary')}</option>
                      ) : (
                        library.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.filename}
                          </option>
                        ))
                      )}
                    </select>
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={!target.online || !selected || sendingDeviceId === target.deviceId}
                      onClick={() => void setGifOnTarget(target.deviceId)}
                    >
                      {sendingDeviceId === target.deviceId ? t('profile.sending') : t('profile.setGif')}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="dash-section">
        <h2>{t('profile.allowed')}</h2>
        <p className="page-sub">{t('profile.allowedSub')}</p>
        <div className="dash-form-row">
          <select value={grantType} onChange={(e) => setGrantType(e.target.value as 'user' | 'group')}>
            <option value="user">{t('profile.grantUser')}</option>
            <option value="group">{t('profile.grantGroup')}</option>
          </select>
          <input
            placeholder={grantType === 'user' ? t('profile.publicUserId') : t('profile.groupId')}
            value={grantTarget}
            onChange={(e) => setGrantTarget(e.target.value)}
          />
          <select value={grantDeviceId} onChange={(e) => setGrantDeviceId(e.target.value)}>
            <option value="">{t('profile.allDevices')}</option>
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.name}
              </option>
            ))}
          </select>
          <button type="button" className="btn-primary" disabled={busy} onClick={() => void addGrant()}>
            {t('profile.grant')}
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
                  {t('profile.revoke')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="dash-section">
        <h2>{t('profile.telegram')}</h2>
        <p className="page-sub">{t('profile.telegramSub')}</p>
        {telegramLinked ? (
          <div className="dash-form-row">
            <span className="page-sub">{t('profile.linked')}</span>
            <button type="button" className="btn-secondary" onClick={() => void unlinkTelegram()}>
              {t('profile.unlink')}
            </button>
          </div>
        ) : (
          <>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => void startTelegramLink()}>
              {t('profile.genLink')}
            </button>
            {linkCode && (
              <p className="dash-code">
                {t('profile.sendBot')} <code>/start {linkCode}</code>
                {linkExpires && (
                  <span className="page-sub">
                    {t('profile.expires', { time: new Date(linkExpires).toLocaleTimeString() })}
                  </span>
                )}
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
