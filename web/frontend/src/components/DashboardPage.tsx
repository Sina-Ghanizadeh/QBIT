import { useCallback, useEffect, useState } from 'react';
import type { NetworkDeviceNode, User } from '../types';
import { useI18n } from '../i18n';
import RoutinesPanel from './RoutinesPanel';
import WaterPanel from './WaterPanel';

const API_URL = import.meta.env.VITE_API_URL || '';

interface Props {
  user: User;
  onOpenNetwork: () => void;
  onOpenDevices: () => void;
  onOpenProfile: () => void;
}

export default function DashboardPage({
  user,
  onOpenNetwork,
  onOpenDevices,
  onOpenProfile,
}: Props) {
  const { t } = useI18n();
  const [isGlobal, setIsGlobal] = useState(false);
  const [devices, setDevices] = useState<NetworkDeviceNode[]>([]);

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
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onlineCount = devices.filter((d) => d.online).length;
  const needsDevice = devices.length === 0;
  const needsGlobal = !isGlobal;
  const showGuide = needsDevice || needsGlobal;

  return (
    <div className="page-scroll dashboard-page">
      <header className="page-header">
        <h1>{t('home.title')}</h1>
        <p className="page-sub">
          {t('home.greeting', { name: user.displayName })}
        </p>
      </header>

      {showGuide && (
        <section className="dash-section flow-guide">
          <h2>{t('home.startHere')}</h2>
          <ol className="flow-steps">
            <li className={needsDevice ? 'active' : 'done'}>
              <div>
                <strong>{t('home.claimTitle')}</strong>
                <p className="page-sub">
                  {needsDevice
                    ? t('home.claimNeed')
                    : t('home.claimDone', { count: devices.length, online: onlineCount })}
                </p>
              </div>
              {needsDevice && (
                <button type="button" className="btn-primary" onClick={onOpenDevices}>
                  {t('home.goDevices')}
                </button>
              )}
            </li>
            <li className={!needsDevice && needsGlobal ? 'active' : needsGlobal ? '' : 'done'}>
              <div>
                <strong>{t('home.globalTitle')}</strong>
                <p className="page-sub">{t('home.globalSub')}</p>
              </div>
              {!needsDevice && needsGlobal && (
                <button type="button" className="btn-secondary" onClick={onOpenProfile}>
                  {t('home.openProfile')}
                </button>
              )}
            </li>
            <li className={!needsDevice ? 'active' : ''}>
              <div>
                <strong>{t('home.networkTitle')}</strong>
                <p className="page-sub">{t('home.networkSub')}</p>
              </div>
              {!needsDevice && (
                <button type="button" className="btn-primary" onClick={onOpenNetwork}>
                  {t('home.openNetwork')}
                </button>
              )}
            </li>
          </ol>
        </section>
      )}

      <div className="dash-widgets">
        <WaterPanel />
        <RoutinesPanel />
      </div>

      {!showGuide && (
        <section className="dash-section dash-actions">
          <button type="button" className="btn-primary" onClick={onOpenNetwork}>
            {t('home.openNetwork')}
          </button>
        </section>
      )}
    </div>
  );
}
