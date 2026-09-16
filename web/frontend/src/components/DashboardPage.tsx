import { useCallback, useEffect, useState } from 'react';
import type { NetworkDeviceNode, User } from '../types';
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
        <h1>
          <span className="brand-mark">Q</span>BIT Home
        </h1>
        <p className="page-sub">
          Hi {user.displayName} — your daily dashboard. Devices, groups, and account live in the menu.
        </p>
      </header>

      {showGuide && (
        <section className="dash-section flow-guide">
          <h2>Start here</h2>
          <ol className="flow-steps">
            <li className={needsDevice ? 'active' : 'done'}>
              <div>
                <strong>Claim a QBIT</strong>
                <p className="page-sub">
                  {needsDevice
                    ? 'Turn the device on, open Devices in the menu, and claim it when it appears.'
                    : `${devices.length} device(s) linked · ${onlineCount} online`}
                </p>
              </div>
              {needsDevice && (
                <button type="button" className="btn-primary" onClick={onOpenDevices}>
                  Go to Devices
                </button>
              )}
            </li>
            <li className={!needsDevice && needsGlobal ? 'active' : needsGlobal ? '' : 'done'}>
              <div>
                <strong>Show up on Global Network</strong>
                <p className="page-sub">Optional — enable it from Profile so others can find you.</p>
              </div>
              {!needsDevice && needsGlobal && (
                <button type="button" className="btn-secondary" onClick={onOpenProfile}>
                  Open Profile
                </button>
              )}
            </li>
            <li className={!needsDevice ? 'active' : ''}>
              <div>
                <strong>Open Network & poke</strong>
                <p className="page-sub">Tap a device or friend node, or use Studio for quick messages.</p>
              </div>
              {!needsDevice && (
                <button type="button" className="btn-primary" onClick={onOpenNetwork}>
                  Open Network
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
            Open Network
          </button>
        </section>
      )}
    </div>
  );
}
