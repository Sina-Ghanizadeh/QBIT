import { useState, useRef, useCallback, useEffect } from 'react';
import type { PokeHistoryEntry } from '../utils/pokeHistory';
import { useI18n } from '../i18n';

const SNAP_CLOSE_THRESHOLD = 100;

interface Props {
  entries: PokeHistoryEntry[];
  hasEntries?: boolean;
  onClose: () => void;
  onClear: () => void;
  visible: boolean;
}

export default function PokeHistoryPanel({ entries, hasEntries = false, onClose, onClear, visible }: Props) {
  const { t } = useI18n();
  const [dragOffset, setDragOffset] = useState(0);
  const touchStartY = useRef<number | null>(null);
  const initialDragOffset = useRef(0);
  const dragOffsetRef = useRef(0);
  const justHandledTouch = useRef(false);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.changedTouches[0].clientY;
    initialDragOffset.current = dragOffset;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const start = touchStartY.current;
    if (start == null) return;
    const current = e.changedTouches[0].clientY;
    const delta = current - start;
    const next = Math.max(0, initialDragOffset.current + delta);
    dragOffsetRef.current = next;
    setDragOffset(next);
  };

  const handleTouchEnd = () => {
    const start = touchStartY.current;
    if (start == null) return;
    touchStartY.current = null;
    justHandledTouch.current = true;
    const offset = dragOffsetRef.current;
    if (offset > SNAP_CLOSE_THRESHOLD) {
      setDragOffset(0);
      onClose();
    } else {
      setDragOffset(0);
    }
  };

  const mouseStartY = useRef<number | null>(null);
  const [isMouseDragging, setIsMouseDragging] = useState(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    mouseStartY.current = e.clientY;
    initialDragOffset.current = dragOffset;
    setIsMouseDragging(true);
  }, [dragOffset]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (mouseStartY.current == null) return;
    const delta = e.clientY - mouseStartY.current;
    const next = Math.max(0, initialDragOffset.current + delta);
    dragOffsetRef.current = next;
    setDragOffset(next);
  }, []);

  const handleMouseUp = useCallback(() => {
    if (mouseStartY.current == null) return;
    mouseStartY.current = null;
    setIsMouseDragging(false);
    justHandledTouch.current = true;
    const offset = dragOffsetRef.current;
    if (offset > SNAP_CLOSE_THRESHOLD) {
      setDragOffset(0);
      onClose();
    } else {
      setDragOffset(0);
    }
  }, [onClose]);

  useEffect(() => {
    if (!isMouseDragging) return;
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isMouseDragging, handleMouseMove, handleMouseUp]);

  return (
    <div
      className={`poke-history-overlay ${visible ? 'poke-history-overlay-visible' : ''}`}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      aria-hidden={!visible}
    >
      <div
        className={`poke-history-sheet ${hasEntries ? 'has-entries' : ''}`}
        style={visible && dragOffset > 0 ? { transform: `translateY(${dragOffset}px)` } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="poke-history-sheet-handle"
          aria-hidden="true"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onMouseDown={handleMouseDown}
        >
          <span className="poke-history-sheet-handle-bar" />
        </div>
        <div className="poke-header">
          <span className="poke-title">{t('poke.history')}</span>
          <button className="poke-close" onClick={onClose} aria-label={t('common.close')}>
            &times;
          </button>
        </div>
        <div className="poke-history-list">
          {entries.length === 0 ? (
            <p className="poke-history-empty">{t('poke.historyEmpty')}</p>
          ) : (
            <ul>
              {entries.map((e, i) => (
                <li key={`${e.at}-${i}`} className="poke-history-item">
                  <span className="poke-history-direction">{e.direction === 'sent' ? 'To' : 'From'}</span>
                  <span className="poke-history-name">{e.fromName || 'Unknown'}</span>
                  {e.text && <span className="poke-history-text">&quot;{e.text}&quot;</span>}
                  <span className="poke-history-time">{new Date(e.at).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="poke-history-actions">
          <button type="button" className="btn btn-ghost" onClick={onClear} disabled={entries.length === 0}>
            {t('poke.clearHistory')}
          </button>
        </div>
      </div>
    </div>
  );
}
