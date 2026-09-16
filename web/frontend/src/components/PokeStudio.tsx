import { useEffect, useMemo, useRef, useState } from 'react';
import type { OnlineUser } from '../types';
import { POKE_TEMPLATES, QUICK_POKES } from '../lib/pokeTemplates';
import { drawOledPreview, renderTextToBitmap } from '../lib/oledBitmap';
import type { BitmapPayload } from './PokeDialog';
import { useI18n } from '../i18n';

const API_URL = import.meta.env.VITE_API_URL || '';

interface FriendRow {
  publicUserId: string;
  displayName: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  userDisplayName: string;
  onlineUsers: OnlineUser[];
  onPokeDevice?: (text: string, bitmap?: BitmapPayload) => void;
  deviceMode?: boolean;
}

export default function PokeStudio({
  open,
  onClose,
  userDisplayName,
  onlineUsers,
  onPokeDevice,
  deviceMode,
}: Props) {
  const { t } = useI18n();
  const [text, setText] = useState('Hi!');
  const [friends, setFriends] = useState<FriendRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!open) return;
    fetch(`${API_URL}/api/friends`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { friends: [] }))
      .then((d) => {
        const list = Array.isArray(d.friends) ? d.friends : Array.isArray(d) ? d : [];
        setFriends(
          list.map((f: { publicUserId?: string; userPublicId?: string; displayName?: string; name?: string }) => ({
            publicUserId: f.publicUserId || f.userPublicId || '',
            displayName: f.displayName || f.name || 'Friend',
          })).filter((f: FriendRow) => f.publicUserId)
        );
      })
      .catch(() => setFriends([]));
  }, [open]);

  useEffect(() => {
    if (!open || !canvasRef.current) return;
    drawOledPreview(canvasRef.current, userDisplayName || 'You', text || ' ');
  }, [open, text, userDisplayName]);

  const onlineFriendIds = useMemo(() => {
    const set = new Set(onlineUsers.map((u) => u.publicUserId).filter(Boolean));
    return friends.filter((f) => set.has(f.publicUserId));
  }, [friends, onlineUsers]);

  if (!open) return null;

  const buildBitmap = (): BitmapPayload => {
    const sender = renderTextToBitmap(userDisplayName || 'You', 12);
    const body = renderTextToBitmap(text.slice(0, 25) || 'Poke!', 14);
    return {
      senderBitmap: sender.bitmap,
      senderBitmapWidth: sender.width,
      textBitmap: body.bitmap,
      textBitmapWidth: body.width,
    };
  };

  const pokeAllOnline = async () => {
    setBusy(true);
    setMsg(null);
    let ok = 0;
    let fail = 0;
    for (const f of onlineFriendIds) {
      try {
        const res = await fetch(`${API_URL}/api/poke/user`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetPublicUserId: f.publicUserId, text: text.slice(0, 25) || 'Poke!' }),
        });
        if (res.ok) ok += 1;
        else fail += 1;
      } catch {
        fail += 1;
      }
      await new Promise((r) => setTimeout(r, 120));
    }
    setMsg(`Sent to ${ok} online friend(s)` + (fail ? `, ${fail} failed` : ''));
    setBusy(false);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card poke-studio" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h2>{t('poke.studio')}</h2>
          <button type="button" className="btn-text" onClick={onClose}>{t('poke.close')}</button>
        </header>
        <p className="page-sub">{t('poke.studioSub')}</p>
        <canvas ref={canvasRef} className="oled-preview" width={128} height={64} />
        <label className="field-label">
          Message
          <input
            maxLength={25}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="text-input"
          />
        </label>
        <div className="chip-row">
          {QUICK_POKES.map((q) => (
            <button key={q.id} type="button" className="chip" onClick={() => setText(q.text)}>
              {q.label}
            </button>
          ))}
        </div>
        <div className="chip-row">
          {POKE_TEMPLATES.map((tmpl) => (
            <button key={tmpl.id} type="button" className="chip chip-secondary" onClick={() => setText(tmpl.text)}>
              {tmpl.label}
            </button>
          ))}
        </div>
        <div className="btn-row">
          {deviceMode && onPokeDevice && (
            <button
              type="button"
              className="btn-primary"
              disabled={busy || !text.trim()}
              onClick={() => onPokeDevice(text.slice(0, 25), buildBitmap())}
            >
              Send to device
            </button>
          )}
          <button
            type="button"
            className="btn-primary"
            disabled={busy || onlineFriendIds.length === 0 || !text.trim()}
            onClick={() => void pokeAllOnline()}
          >
            {busy ? t('poke.broadcasting') : `${t('poke.broadcast')} (${onlineFriendIds.length})`}
          </button>
        </div>
        {msg && <p className="page-sub">{msg}</p>}
      </div>
    </div>
  );
}