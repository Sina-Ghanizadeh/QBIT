import { useState } from 'react';
import type { Device } from '../types';
import { useI18n } from '../i18n';

interface Props {
  device: Device;
  apiUrl: string;
  onClose: () => void;
}

export default function AddFriendDialog({ device, apiUrl, onClose }: Props) {
  const { t } = useI18n();
  const [deviceIdFull, setDeviceIdFull] = useState('');
  const [status, setStatus] = useState<'idle' | 'pending' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async () => {
    if (!deviceIdFull.trim()) return;

    setStatus('pending');
    setErrorMsg('');

    try {
      const res = await fetch(`${apiUrl}/api/friends/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          targetId: device.pokeToken,
          deviceIdFull: deviceIdFull.trim().toUpperCase(),
        }),
      });

      const data = await res.json();

      if (res.ok) {
        setStatus('pending');
      } else {
        setStatus('error');
        setErrorMsg(data.error || t('friend.failed'));
      }
    } catch {
      setStatus('error');
      setErrorMsg(t('common.networkError'));
    }
  };

  return (
    <div className="poke-overlay" onClick={onClose}>
      <div className="poke-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="poke-header">
          <span className="poke-title">{t('friend.title')}: {device.name}</span>
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
            <p>{t('friend.waiting')}</p>
            <p className="claim-pending-hint">{t('claim.longPress')}</p>
          </div>
        ) : (
          <>
            <p className="claim-description">
              Enter the 12-character device ID. Owner confirms by long-press on the QBIT.
            </p>

            <input
              className="poke-input"
              type="text"
              placeholder="e.g. 30A0E710B894"
              maxLength={12}
              value={deviceIdFull}
              onChange={(e) => setDeviceIdFull(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSubmit();
              }}
              autoFocus
              style={{ fontFamily: 'monospace', letterSpacing: '0.1em' }}
            />

            {errorMsg && (
              <div className="claim-error">{errorMsg}</div>
            )}

            <button
              className="btn btn-poke"
              onClick={handleSubmit}
              disabled={deviceIdFull.trim().length !== 12}
            >
              Send Friend Request
            </button>
          </>
        )}
      </div>
    </div>
  );
}
