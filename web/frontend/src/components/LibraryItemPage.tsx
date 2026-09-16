import { useEffect, useRef, useState, useCallback } from 'react';
import QgifPreview from './QgifPreview';
import SetOnDeviceControl from './SetOnDeviceControl';
import { useI18n } from '../i18n';
import type { User } from '../types';

interface Item {
  id: string;
  filename: string;
  uploader: string;
  uploaderPublicId: string;
  uploadedAt: string;
  size: number;
  frameCount: number;
  downloadCount?: number;
  starCount?: number;
  tags?: string[];
}

interface Props {
  id: string;
  apiUrl: string;
  user: User | null;
  onBack: () => void;
  onUploader: (uploaderPublicId: string) => void;
  onTag: (tag: string) => void;
}

export default function LibraryItemPage({ id, apiUrl, user, onBack, onUploader, onTag }: Props) {
  const { t } = useI18n();
  const [item, setItem] = useState<Item | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Array<{ id: number; text: string; ok: boolean; exiting?: boolean }>>([]);
  const toastIdRef = useRef(0);

  const showToast = useCallback((text: string, ok = true) => {
    const tid = ++toastIdRef.current;
    setToasts((prev) => [...prev.slice(-2), { id: tid, text, ok }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.map((toast) => (toast.id === tid ? { ...toast, exiting: true } : toast)));
    }, 2600);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== tid));
    }, 3200);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`${apiUrl}/api/library/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(t('library.notFound')))))
      .then((d) => {
        if (!cancelled) setItem(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : t('common.failed'));
      });
    return () => {
      cancelled = true;
    };
  }, [apiUrl, id, t]);

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    fetch(`${apiUrl}/api/library/${id}/raw`)
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        if (cancelled) return;
        url = URL.createObjectURL(new Blob([buf], { type: 'application/octet-stream' }));
        setBlobUrl(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [apiUrl, id]);

  const copyLink = async () => {
    const link = `${window.location.origin}/library/${id}`;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      setMsg(link);
      return;
    }
    showToast(t('library.linkCopied'), true);
  };

  const saveTags = async () => {
    if (!item || !user) return;
    const tags = tagInput
      .split(/[,\s]+/)
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 8);
    const res = await fetch(`${apiUrl}/api/library/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || t('common.failed'));
      return;
    }
    setItem({ ...item, tags: data.tags || tags });
    showToast(t('library.tagsSaved'), true);
  };

  useEffect(() => {
    if (item?.tags) setTagInput((item.tags || []).join(', '));
  }, [item]);

  if (error && !item) {
    return (
      <div className="library-page">
        <button type="button" className="btn-secondary" onClick={onBack}>
          {t('common.back')}
        </button>
        <p className="page-error">{error}</p>
      </div>
    );
  }

  if (!item) {
    return <div className="library-page">{t('library.loading')}</div>;
  }

  const isOwner = !!user && user.publicUserId === item.uploaderPublicId;

  return (
    <div className="library-page library-item-page">
      <div className="library-header">
        <button type="button" className="btn-secondary" onClick={onBack}>
          {t('library.back')}
        </button>
      </div>
      <h1 className="library-title">{item.filename}</h1>
      <div className="library-item-preview">
        {blobUrl ? <QgifPreview src={blobUrl} /> : <div className="library-empty">{t('library.loadingPreview')}</div>}
      </div>
      <p className="page-sub">
        {t('library.framesBy', { n: item.frameCount })}
        <button type="button" className="btn-text" onClick={() => onUploader(item.uploaderPublicId)}>
          {item.uploader}
        </button>
      </p>
      <div className="chip-row">
        {(item.tags || []).map((tag) => (
          <button key={tag} type="button" className="chip" onClick={() => onTag(tag)}>
            #{tag}
          </button>
        ))}
      </div>
      {isOwner && (
        <div className="dash-form-row">
          <input
            className="text-input"
            placeholder={t('library.tagsPlaceholder')}
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
          />
          <button type="button" className="btn-primary" onClick={() => void saveTags()}>
            {t('library.saveTags')}
          </button>
        </div>
      )}
      <div className="btn-row library-item-actions">
        <SetOnDeviceControl apiUrl={apiUrl} libraryId={id} user={user} onToast={showToast} />
        <button type="button" className="btn-secondary" onClick={() => void copyLink()}>
          {t('library.copyLink')}
        </button>
        <a className="btn-secondary" href={`${apiUrl}/api/library/${id}/download`}>
          {t('library.download')}
        </a>
      </div>
      {msg && <p className="page-sub">{msg}</p>}
      {error && <p className="page-error">{error}</p>}

      <div className="poke-notifications library-toasts" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`poke-notification ${toast.exiting ? 'poke-notification-exit' : 'poke-notification-enter'}${toast.ok ? '' : ' library-toast-error'}`}
          >
            <div className="poke-notification-from">{toast.ok ? t('library.toastOk') : t('library.toastErr')}</div>
            <div className="poke-notification-text">{toast.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
