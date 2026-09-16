import { useState, useEffect } from 'react';
import type { Device } from '../types';
import { useI18n } from '../i18n';

interface Props {
  device: Device;
  apiUrl: string;
  onClose: () => void;
  onClaimed: () => void;
  socket: {
    on: (ev: string, fn: (data: { result: string }) => void) => void;
    off: (ev: string, fn: (data: { result: string }) => void) => void;
  } | null;
  /** When true, use device.id directly (Devices page) — no manual ID entry */
  knownDevice?: boolean;
}

export default function ClaimDialog({
  device,
  apiUrl,
  onClose,
  onClaimed,
  socket,
  knownDevice = false,
}: Props) {
  const { t } = useI18n();
  const [deviceIdFull, setDeviceIdFull] = useState(knownDevice ? device.id : '');
  const [status, setStatus] = useState<'idle' | 'pending' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!socket) return;
    const handler = (data: { result: string }) => {
      if (data.result === 'accepted') {
        onClaimed();
        onClose();
      } else if (data.result === 'timeout') {
        setStatus('error');
        setErrorMsg(t('claim.waiting'));
      } else if (data.result === 'rejected') {
        setStatus('error');
        setErrorMsg(t('claim.declined'));
      }
    };
    socket.on('claim:result', handler);
    return () => {
      socket.off('claim:result', handler);
    };
  }, [socket, onClaimed, onClose, t]);

  const handleSubmit = async () => {
    const id = knownDevice ? device.id : deviceIdFull.trim();
    if (!id) return;

    setStatus('pending');
    setErrorMsg('');

    try {
      const res = await fetch(`${apiUrl}/api/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          targetId: device.pokeToken,
          deviceIdFull: id,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        setStatus('pending');
      } else {
        setStatus('error');
        setErrorMsg(data.error || t('claim.failed'));
      }
    } catch {
      setStatus('error');
      setErrorMsg(t('common.networkError'));
    }
  };

  const canSubmit = knownDevice ? !!device.id : deviceIdFull.trim().length > 0;

  return (
    <div className="poke-overlay" onClick={onClose}>
      <div className="poke-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="poke-header">
          <span className="poke-title">{t('claim.title')}: {device.name}</span>
          <button className="poke-close" onClick={onClose}>
            &times;
          </button>
        </div>

        {status === 'pending' ? (
          <div className="claim-pending">
            <div className="claim-pending-icon claim-pending-spinner" aria-hidden>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                <path d="M12 2a10 10 0 0 1 10 10" strokeOpacity="1" />
              </svg>
            </div>
            <p>{t('claim.waiting')}</p>
            <p className="claim-pending-hint">{t('claim.longPress')}</p>
          </div>
        ) : (
          <>
            {knownDevice ? (
              <p className="claim-description">
                Device ID <code>{device.id}</code>. Send a claim request, then long-press on the
                QBIT to accept.
              </p>
            ) : (
              <>
                <p className="claim-description">
                  Enter the device ID, then long-press on the QBIT to confirm.
                </p>
                <input
                  className="poke-input"
                  type="text"
                  placeholder={t('claim.deviceId')}
                  maxLength={64}
                  value={deviceIdFull}
                  onChange={(e) => setDeviceIdFull(e.target.value.trim())}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSubmit();
                  }}
                  autoFocus
                  style={{ fontFamily: 'monospace', letterSpacing: '0.05em' }}
                />
              </>
            )}

            {errorMsg && <div className="claim-error">{errorMsg}</div>}

            <button className="btn btn-poke" onClick={handleSubmit} disabled={!canSubmit}>
              Send claim request
            </button>
          </>
        )}
      </div>
    </div>
  );
}
