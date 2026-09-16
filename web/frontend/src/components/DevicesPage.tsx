import { useCallback, useEffect, useState } from 'react';
import type { Device, NetworkDeviceNode, User } from '../types';
import { useI18n } from '../i18n';
import ClaimDialog from './ClaimDialog';
import DeviceCloudPanel, { type DeviceSocket } from './DeviceCloudPanel';

const API_URL = import.meta.env.VITE_API_URL || '';

interface Props {
  user: User;
  liveDevices: Device[];
  socket: DeviceSocket | null;
}

export default function DevicesPage({ liveDevices, socket }: Props) {
  const { t } = useI18n();
  const [myDevices, setMyDevices] = useState<NetworkDeviceNode[]>([]);
  const [claimDevice, setClaimDevice] = useState<Device | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshMine = useCallback(() => {
    fetch(`${API_URL}/api/me/devices`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { devices: [] }))
      .then((d) => setMyDevices(d.devices || []))
      .catch(() => setMyDevices([]));
  }, []);

  useEffect(() => {
    refreshMine();
  }, [refreshMine, liveDevices]);

  const unclaimedOnline = liveDevices.filter((d) => !d.claimedBy);

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
      setMyDevices((prev) =>
        prev.map((d) => (d.deviceId === deviceId ? { ...d, showInGlobal: data.showInGlobal } : d))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  };

  const handleUnclaim = async (device: NetworkDeviceNode) => {
    if (!device.online || !device.pokeToken) {
      setError(t('devices.mustOnline'));
      return;
    }
    if (!confirm(`${t('devices.unclaim')} ${device.name}?`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/claim/${device.pokeToken}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to unclaim');
      refreshMine();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-scroll devices-page">
      <header className="page-header">
        <h1>{t('devices.title')}</h1>
        <p className="page-sub">{t('devices.sub')}</p>
      </header>

      {error && <div className="page-error">{error}</div>}

      <section className="dash-section">
        <h2>{t('devices.unclaimed')}</h2>
        <p className="page-sub">
          {t('devices.addHint')}
        </p>
        {unclaimedOnline.length === 0 ? (
          <p className="page-sub">{t('devices.none')}</p>
        ) : (
          <ul className="dash-list">
            {unclaimedOnline.map((d) => (
              <li key={d.id} className="dash-list-item">
                <div>
                  <strong>{d.name}</strong>
                  <span className="page-sub">
                    {' '}
                    · {d.id} · v{d.version || '?'}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy}
                  onClick={() => setClaimDevice(d)}
                >
                  {t('devices.claim')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="dash-section">
        <h2>{t('devices.mine')}</h2>
        {myDevices.length === 0 ? (
          <p className="page-sub">{t('devices.none')}</p>
        ) : (
          <ul className="dash-list">
            {myDevices.map((d) => (
              <li key={d.deviceId} className="dash-list-item col">
                <div className="dash-list-item">
                  <div>
                    <strong>{d.name}</strong>
                    <span className="page-sub">
                      {' '}
                      · {d.online ? t('devices.online') : t('devices.offline')} · {d.deviceId}
                    </span>
                  </div>
                  <div className="dash-form-row">
                    <label className="dash-toggle compact">
                      <input
                        type="checkbox"
                        checked={!!d.showInGlobal}
                        onChange={(e) => toggleDeviceGlobal(d.deviceId, e.target.checked)}
                      />
                      <span>{t('devices.visibleGlobal')}</span>
                    </label>
                    <button
                      type="button"
                      className="btn-text"
                      disabled={busy || !d.online}
                      title={!d.online ? t('devices.mustOnline') : t('devices.unclaim')}
                      onClick={() => handleUnclaim(d)}
                    >
                      {t('devices.unclaim')}
                    </button>
                  </div>
                </div>
                <DeviceCloudPanel device={d} socket={socket} onError={setError} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {claimDevice && (
        <ClaimDialog
          device={claimDevice}
          apiUrl={API_URL}
          socket={socket}
          knownDevice
          onClose={() => setClaimDevice(null)}
          onClaimed={() => {
            setClaimDevice(null);
            refreshMine();
          }}
        />
      )}
    </div>
  );
}
