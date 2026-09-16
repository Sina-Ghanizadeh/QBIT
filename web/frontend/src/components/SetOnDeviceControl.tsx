import { useCallback, useEffect, useRef, useState } from 'react';
import type { User } from '../types';
import { useI18n } from '../i18n';

export interface AnimDeviceOption {
  deviceId: string;
  name: string;
  online: boolean;
  source: 'mine' | 'granted';
  ownerLabel?: string;
}

interface Props {
  apiUrl: string;
  libraryId: string;
  user: User | null;
  onToast: (message: string, ok?: boolean) => void;
  /** Stop parent card click from opening item */
  stopPropagation?: boolean;
  compact?: boolean;
}

export async function fetchAnimDeviceOptions(apiUrl: string): Promise<AnimDeviceOption[]> {
  const [mineRes, grantRes] = await Promise.all([
    fetch(`${apiUrl}/api/me/devices`, { credentials: 'include' }),
    fetch(`${apiUrl}/api/me/animation-targets`, { credentials: 'include' }),
  ]);
  const mineData = mineRes.ok ? await mineRes.json() : { devices: [] };
  const grantData = grantRes.ok ? await grantRes.json() : { targets: [] };

  const mine: AnimDeviceOption[] = (mineData.devices || []).map(
    (d: { deviceId: string; name: string; online?: boolean }) => ({
      deviceId: d.deviceId,
      name: d.name,
      online: !!d.online,
      source: 'mine' as const,
    })
  );

  const granted: AnimDeviceOption[] = (grantData.targets || []).map(
    (t: {
      deviceId: string;
      deviceName: string;
      online: boolean;
      ownerDisplayName: string;
    }) => ({
      deviceId: t.deviceId,
      name: t.deviceName,
      online: !!t.online,
      source: 'granted' as const,
      ownerLabel: t.ownerDisplayName,
    })
  );

  const seen = new Set(mine.map((d) => d.deviceId));
  const merged = [...mine];
  for (const g of granted) {
    if (!seen.has(g.deviceId)) merged.push(g);
  }
  return merged.sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
}

export default function SetOnDeviceControl({
  apiUrl,
  libraryId,
  user,
  onToast,
  stopPropagation = true,
  compact = false,
}: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [devices, setDevices] = useState<AnimDeviceOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const loadDevices = useCallback(() => {
    if (!user) return;
    setLoading(true);
    fetchAnimDeviceOptions(apiUrl)
      .then(setDevices)
      .catch(() => setDevices([]))
      .finally(() => setLoading(false));
  }, [apiUrl, user]);

  useEffect(() => {
    if (!open) return;
    loadDevices();
  }, [open, loadDevices]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const sendTo = async (deviceId: string, deviceName: string) => {
    setSendingId(deviceId);
    try {
      const res = await fetch(`${apiUrl}/api/devices/${encodeURIComponent(deviceId)}/animation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ libraryId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t('library.failSet'));
      onToast(t('library.setOn', { name: deviceName }), true);
      setOpen(false);
    } catch (e) {
      onToast(e instanceof Error ? e.message : t('library.failSet'), false);
    } finally {
      setSendingId(null);
    }
  };

  if (!user) {
    return (
      <button
        type="button"
        className={`btn-primary${compact ? ' btn-sm' : ''}`}
        disabled
        title={t('library.loginToSet')}
        onClick={(e) => stopPropagation && e.stopPropagation()}
      >
        {t('library.setOnDevice')}
      </button>
    );
  }

  return (
    <div
      className="set-on-device"
      ref={rootRef}
      onClick={(e) => stopPropagation && e.stopPropagation()}
    >
      <button
        type="button"
        className={`btn-primary set-on-device-trigger${compact ? ' btn-sm' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {t('library.setOnDevice')}
      </button>
      {open && (
        <div className="set-on-device-menu" role="listbox">
          {loading ? (
            <p className="page-sub set-on-device-empty">{t('library.loadingDevices')}</p>
          ) : devices.length === 0 ? (
            <p className="page-sub set-on-device-empty">
              {t('library.noDevices')}
            </p>
          ) : (
            <ul className="set-on-device-list">
              {devices.map((d) => (
                <li key={d.deviceId}>
                  <button
                    type="button"
                    className="set-on-device-option"
                    disabled={!d.online || sendingId === d.deviceId}
                    onClick={() => void sendTo(d.deviceId, d.name)}
                  >
                    <span className="set-on-device-option-main">
                      <strong>{d.name}</strong>
                      <span className={`status-pill ${d.online ? 'on' : 'off'}`}>
                        {d.online ? t('status.online') : t('status.offline')}
                      </span>
                    </span>
                    <span className="page-sub">
                      {d.source === 'mine'
                        ? t('library.yourDevice')
                        : t('library.granted', { name: d.ownerLabel || 'friend' })}
                      {sendingId === d.deviceId ? ` · ${t('profile.sending')}` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
