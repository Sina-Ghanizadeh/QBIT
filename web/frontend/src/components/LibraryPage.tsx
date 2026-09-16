import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import QgifPreview from './QgifPreview';
import GifConverterPanel from './GifConverterPanel';
import SetOnDeviceControl from './SetOnDeviceControl';
import { useI18n } from '../i18n';
import type { User } from '../types';

const MAX_CONCURRENT_RAW = 8;
const rawQueue: Array<() => void> = [];
let rawInFlight = 0;

function runWithConcurrencyLimit<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = () => {
      rawInFlight++;
      fn()
        .then(resolve, reject)
        .finally(() => {
          rawInFlight--;
          if (rawQueue.length > 0) rawQueue.shift()!();
        });
    };
    if (rawInFlight < MAX_CONCURRENT_RAW) run();
    else rawQueue.push(run);
  });
}

function LazyLibraryPreview({ apiUrl, id }: { apiUrl: string; id: string }) {
  const [inView, setInView] = useState(false);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) setInView(true);
      },
      { rootMargin: '100px', threshold: 0 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  useEffect(() => {
    if (!inView || blobUrl) return;
    const url = `${apiUrl}/api/library/${id}/raw`;
    let cancelled = false;
    runWithConcurrencyLimit(() => fetch(url).then((r) => r.arrayBuffer()))
      .then((buf) => {
        if (cancelled) return;
        const blob = new Blob([buf], { type: 'application/octet-stream' });
        setBlobUrl(URL.createObjectURL(blob));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [inView, apiUrl, id, blobUrl]);
  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);
  return (
    <div ref={ref} className="library-card-preview-inner">
      {blobUrl ? <QgifPreview src={blobUrl} /> : null}
    </div>
  );
}

interface LibraryItem {
  id: string;
  filename: string;
  uploader: string;
  uploaderPublicId: string;
  uploadedAt: string;
  size: number;
  frameCount: number;
  downloadCount?: number;
  starCount?: number;
  starredByMe?: boolean;
  tags?: string[];
}

interface Props {
  user: User | null;
  apiUrl: string;
  initialUploaderId?: string | null;
  initialTag?: string | null;
  onOpenItem?: (id: string) => void;
  onClearFilters?: () => void;
}

type SortMode = 'stars' | 'downloads' | 'newest' | 'oldest' | 'az' | 'za' | 'trending';

function formatSize(b: number): string {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export default function LibraryPage({
  user,
  apiUrl,
  initialUploaderId = null,
  initialTag = null,
  onOpenItem,
  onClearFilters,
}: Props) {
  const { t } = useI18n();
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Filtering and sorting
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('stars');
  const [tagFilter, setTagFilter] = useState(initialTag || '');
  const [uploaderFilter, setUploaderFilter] = useState(initialUploaderId || '');
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareBlobs, setCompareBlobs] = useState<Record<string, string>>({});

  // Multi-select
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [batchDownloading, setBatchDownloading] = useState(false);
  const [toasts, setToasts] = useState<Array<{ id: number; text: string; ok: boolean; exiting?: boolean }>>([]);
  const toastIdRef = useRef(0);

  const showToast = useCallback((text: string, ok = true) => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev.slice(-2), { id, text, ok }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)));
    }, 2600);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3200);
  }, []);

  useEffect(() => {
    setTagFilter(initialTag || '');
  }, [initialTag]);
  useEffect(() => {
    setUploaderFilter(initialUploaderId || '');
  }, [initialUploaderId]);

  const fetchItems = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      const sortParam =
        sortMode === 'stars'
          ? 'stars'
          : sortMode === 'downloads'
            ? 'downloads'
            : sortMode === 'trending'
              ? 'trending'
              : 'newest';
      params.set('sort', sortParam);
      if (tagFilter.trim()) params.set('tag', tagFilter.trim().toLowerCase());
      if (uploaderFilter.trim()) params.set('uploaderPublicId', uploaderFilter.trim());
      const res = await fetch(`${apiUrl}/api/library?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setItems(data);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [apiUrl, sortMode, tagFilter, uploaderFilter]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  // Filtered and sorted items
  const displayItems = useMemo(() => {
    let filtered = items;

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      filtered = filtered.filter((item) =>
        item.filename.toLowerCase().includes(q)
      );
    }

    const sorted = [...filtered];
    switch (sortMode) {
      case 'stars':
        sorted.sort((a, b) => (b.starCount ?? 0) - (a.starCount ?? 0) || new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
        break;
      case 'downloads':
        sorted.sort((a, b) => (b.downloadCount ?? 0) - (a.downloadCount ?? 0) || new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
        break;
      case 'newest':
        sorted.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
        break;
      case 'oldest':
        sorted.sort((a, b) => new Date(a.uploadedAt).getTime() - new Date(b.uploadedAt).getTime());
        break;
      case 'az':
        sorted.sort((a, b) => a.filename.localeCompare(b.filename));
        break;
      case 'za':
        sorted.sort((a, b) => b.filename.localeCompare(a.filename));
        break;
    }

    return sorted;
  }, [items, searchQuery, sortMode]);

  const uploadFile = async (file: File) => {
    if (!file.name.endsWith('.qgif')) {
      setUploadMsg({ text: 'Only .qgif files are accepted', ok: false });
      return;
    }

    setUploading(true);
    setUploadMsg(null);

    try {
      const fd = new FormData();
      fd.append('file', file);

      const res = await fetch(`${apiUrl}/api/library/upload`, {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });

      const data = await res.json();

      if (res.ok) {
        setUploadMsg({ text: `Uploaded ${file.name}`, ok: true });
        await fetchItems();
      } else {
        setUploadMsg({ text: data.error || t('library.uploadFailed'), ok: false });
      }
    } catch {
      setUploadMsg({ text: t('common.networkError'), ok: false });
    } finally {
      setUploading(false);
    }
  };

  const uploadFiles = async (files: File[]) => {
    const qgifFiles = files.filter((f) => f.name.endsWith('.qgif'));
    if (qgifFiles.length === 0) {
      setUploadMsg({ text: 'Only .qgif files are accepted', ok: false });
      return;
    }

    setUploading(true);
    setUploadMsg(null);

    let successCount = 0;
    let failCount = 0;
    let duplicateCount = 0;
    const CONCURRENCY = 4;

    const uploadOne = async (file: File): Promise<void> => {
      try {
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch(`${apiUrl}/api/library/upload`, {
          method: 'POST',
          credentials: 'include',
          body: fd,
        });
        if (res.ok) {
          successCount++;
        } else {
          const data = await res.json().catch(() => ({}));
          if (res.status === 409 && data.code === 'DUPLICATE_CONTENT') {
            duplicateCount++;
          } else {
            failCount++;
          }
        }
      } catch {
        failCount++;
      }
    };

    for (let i = 0; i < qgifFiles.length; i += CONCURRENCY) {
      const chunk = qgifFiles.slice(i, i + CONCURRENCY);
      await Promise.all(chunk.map(uploadOne));
    }

    await fetchItems();

    if (failCount === 0 && duplicateCount === 0) {
      setUploadMsg({ text: `Uploaded ${successCount} file${successCount > 1 ? 's' : ''}`, ok: true });
    } else if (failCount === 0 && duplicateCount > 0) {
      setUploadMsg({
        text: successCount > 0
          ? `Uploaded ${successCount}, ${duplicateCount} duplicate(s) skipped (same content already in library)`
          : `All ${duplicateCount} file(s) already in library (same content)`,
        ok: successCount > 0,
      });
    } else {
      setUploadMsg({
        text: `${successCount} uploaded, ${failCount} failed${duplicateCount > 0 ? `, ${duplicateCount} duplicate(s) skipped` : ''}`,
        ok: successCount > 0,
      });
    }

    setUploading(false);
  };

  const handleToggleStar = useCallback(
    async (id: string) => {
      if (!user) return;
      try {
        const res = await fetch(`${apiUrl}/api/library/${id}/star`, {
          method: 'POST',
          credentials: 'include',
        });
        if (res.ok) await fetchItems();
      } catch {
        // ignore
      }
    },
    [apiUrl, user, fetchItems]
  );

  const handleDelete = async (id: string, filename: string) => {
    if (!confirm(`Delete ${filename}?`)) return;

    try {
      const res = await fetch(`${apiUrl}/api/library/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        await fetchItems();
      } else {
        const data = await res.json();
        alert(data.error || t('library.deleteFailed'));
      }
    } catch {
      alert(t('common.networkError'));
    }
  };

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (files.length === 1) {
      uploadFile(files[0]);
    } else {
      uploadFiles(Array.from(files));
    }
  };

  // Multi-select handlers
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(displayItems.map((item) => item.id)));
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const handleBatchDelete = async () => {
    const count = selectedIds.size;
    if (count === 0) return;
    if (!confirm(`Delete ${count} selected file${count > 1 ? 's' : ''}?`)) return;

    setBatchDeleting(true);
    try {
      const res = await fetch(`${apiUrl}/api/library/batch`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });

      if (res.ok) {
        const data = await res.json();
        setSelectedIds(new Set());
        await fetchItems();
        if (data.failed > 0) {
          alert(`${data.deleted} deleted, ${data.failed} failed (not owned by you)`);
        }
      } else {
        const data = await res.json();
        alert(data.error || t('library.deleteFailed'));
      }
    } catch {
      alert(t('common.networkError'));
    } finally {
      setBatchDeleting(false);
    }
  };

  const handleBatchDownload = async () => {
    if (selectedIds.size === 0) return;

    setBatchDownloading(true);
    try {
      const res = await fetch(`${apiUrl}/api/library/batch-download`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });

      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'qgif-library.zip';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        alert(t('library.downloadFailed'));
      }
    } catch {
      alert(t('common.networkError'));
    } finally {
      setBatchDownloading(false);
    }
  };

  useEffect(() => {
    if (compareIds.length === 0) return;
    let cancelled = false;
    for (const id of compareIds) {
      void fetch(`${apiUrl}/api/library/${id}/raw`)
        .then((r) => r.arrayBuffer())
        .then((buf) => {
          if (cancelled) return;
          const url = URL.createObjectURL(new Blob([buf], { type: 'application/octet-stream' }));
          setCompareBlobs((p) => {
            if (p[id]) {
              URL.revokeObjectURL(url);
              return p;
            }
            return { ...p, [id]: url };
          });
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [compareIds, apiUrl]);

  const toggleCompare = (id: string) => {
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  };

  // Count how many selected items are owned by current user
  const ownedSelectedCount = useMemo(() => {
    if (!user) return 0;
    return items.filter((i) => selectedIds.has(i.id) && i.uploaderPublicId === user.publicUserId).length;
  }, [items, selectedIds, user]);

  return (
    <div className="library-page">
      <div className="library-header">
        <div>
          <span className="library-title">
            {t('library.title')}
            {items.length > 0 && (
              <span className="library-count">{t('library.files', { n: items.length })}</span>
            )}
          </span>
        </div>
        {user && items.length > 0 && (
          <div className="library-header-actions">
            {selectMode ? (
              <button className="btn-lib-action" onClick={exitSelectMode}>
                {t('library.cancel')}
              </button>
            ) : (
              <button className="btn-lib-action" onClick={() => setSelectMode(true)}>
                {t('library.select')}
              </button>
            )}
          </div>
        )}
      </div>

      <GifConverterPanel
        apiUrl={apiUrl}
        canUpload={!!user}
        onUploaded={() => void fetchItems()}
      />

      {/* Toolbar: search + sort + tag */}
      <div className="library-toolbar">
        <input
          className="library-search"
          type="text"
          placeholder={t('library.search')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <input
          className="library-search"
          type="text"
          placeholder={t('library.filterTag')}
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
        />
        <select
          className="library-sort"
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value as SortMode)}
        >
          <option value="trending">{t('library.trending')}</option>
          <option value="stars">{t('library.mostStars')}</option>
          <option value="downloads">{t('library.mostDownloads')}</option>
          <option value="newest">{t('library.newest')}</option>
          <option value="oldest">{t('library.oldest')}</option>
          <option value="az">{t('library.nameAz')}</option>
          <option value="za">{t('library.nameZa')}</option>
        </select>
      </div>
      {(uploaderFilter || tagFilter) && (
        <div className="library-filter-banner">
          <span className="page-sub">
            {uploaderFilter ? t('library.uploaderFilter') : ''}
            {uploaderFilter && tagFilter ? ' · ' : ''}
            {tagFilter ? t('library.tagFilter', { tag: tagFilter }) : ''}
          </span>
          <button
            type="button"
            className="btn-text"
            onClick={() => {
              setUploaderFilter('');
              setTagFilter('');
              onClearFilters?.();
            }}
          >
            {t('library.clearFilters')}
          </button>
        </div>
      )}

      {compareIds.length > 0 && (
        <div className="library-compare">
          <div className="library-compare-head">
            <strong>{t('library.compare')}</strong>
            <button type="button" className="btn-text" onClick={() => setCompareIds([])}>
              {t('library.clear')}
            </button>
          </div>
          <div className="library-compare-grid">
            {compareIds.map((id) => {
              const item = items.find((i) => i.id === id);
              return (
                <div key={id} className="library-compare-pane">
                  <div className="page-sub">{item?.filename || id}</div>
                  {compareBlobs[id] ? <QgifPreview src={compareBlobs[id]} /> : <div>{t('library.loading')}</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Selection toolbar */}
      {selectMode && (
        <div className="library-selection-bar">
          <span className="library-selection-count">
            {t('library.selected', { n: selectedIds.size })}
          </span>
          <button className="btn-lib-action btn-sm" onClick={selectAll}>
            {t('library.all')}
          </button>
          <button className="btn-lib-action btn-sm" onClick={deselectAll}>
            {t('library.none')}
          </button>
          <div className="library-selection-spacer" />
          {selectedIds.size > 0 && (
            <>
              <button
                className="btn-lib-action btn-sm"
                onClick={handleBatchDownload}
                disabled={batchDownloading}
              >
                {batchDownloading ? t('library.zipping') : t('library.downloadN', { n: selectedIds.size })}
              </button>
              {ownedSelectedCount > 0 && (
                <button
                  className="btn-lib-action btn-sm btn-danger"
                  onClick={handleBatchDelete}
                  disabled={batchDeleting}
                >
                  {batchDeleting ? t('library.deleting') : t('library.deleteN', { n: ownedSelectedCount })}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {user ? (
        <div
          className={`library-upload${dragging ? ' drag' : ''}`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            handleFiles(e.dataTransfer.files);
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".qgif"
            multiple
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <span className="library-upload-icon">&#8682;</span>
          {uploading ? t('library.uploading') : t('library.dropUpload')}
          {uploadMsg && (
            <div className={`library-upload-msg ${uploadMsg.ok ? 'ok' : 'error'}`}>
              {uploadMsg.text}
            </div>
          )}
        </div>
      ) : (
        <div className="library-login-hint">
          {t('library.loginUpload')}
        </div>
      )}

      {loading ? (
        <div className="library-empty">{t('library.loading')}</div>
      ) : displayItems.length === 0 ? (
        <div className="library-empty">
          {searchQuery.trim() || tagFilter.trim()
            ? t('library.emptySearch')
            : t('library.empty')}
        </div>
      ) : (
        <div className="library-grid">
          {displayItems.map((item) => (
            <div
              className={`library-card${selectMode && selectedIds.has(item.id) ? ' selected' : ''}${
                compareIds.includes(item.id) ? ' compare-selected' : ''
              }`}
              key={item.id}
              onClick={
                selectMode
                  ? () => toggleSelect(item.id)
                  : () => onOpenItem?.(item.id)
              }
            >
              {selectMode && (
                <div className="library-card-checkbox">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(item.id)}
                    onChange={() => toggleSelect(item.id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
              )}
              <div className="library-card-preview">
                <LazyLibraryPreview apiUrl={apiUrl} id={item.id} />
              </div>
              {!selectMode && user && (
                <div className="library-card-star">
                  <button
                    type="button"
                    className={`btn-star-lib${item.starredByMe ? ' starred' : ''}`}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleToggleStar(item.id);
                    }}
                    title={item.starredByMe ? t('library.unstar') : t('library.star')}
                    aria-label={item.starredByMe ? t('library.unstar') : t('library.star')}
                  >
                    &#9733;
                  </button>
                </div>
              )}
              <div className="library-card-info">
                <div className="library-card-title-row">
                  <div className="library-card-name">{item.filename}</div>
                  <div className="library-card-stats">
                    {(item.starCount ?? 0) > 0 && (
                      <span className="library-card-stat" title={t('library.star')}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                          <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
                        </svg>
                        <span>{item.starCount}</span>
                      </span>
                    )}
                    {(item.downloadCount ?? 0) > 0 && (
                      <span className="library-card-stat" title={t('library.downloads')}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                          <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
                        </svg>
                        <span>{item.downloadCount}</span>
                      </span>
                    )}
                  </div>
                </div>
                <div className="library-card-meta">
                  {item.frameCount} frames &middot; {formatSize(item.size)}
                </div>
                <div className="library-card-meta">
                  by{' '}
                  <button
                    type="button"
                    className="btn-text"
                    onClick={(e) => {
                      e.stopPropagation();
                      setUploaderFilter(item.uploaderPublicId);
                    }}
                  >
                    {item.uploader}
                  </button>{' '}
                  &middot; {formatDate(item.uploadedAt)}
                </div>
                {(item.tags || []).length > 0 && (
                  <div className="chip-row library-card-tags">
                    {(item.tags || []).map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        className="chip"
                        onClick={(e) => {
                          e.stopPropagation();
                          setTagFilter(tag);
                        }}
                      >
                        #{tag}
                      </button>
                    ))}
                  </div>
                )}
                {!selectMode && (
                  <div className="library-card-actions">
                    <SetOnDeviceControl
                      apiUrl={apiUrl}
                      libraryId={item.id}
                      user={user}
                      onToast={showToast}
                      compact
                    />
                    <a
                      className="btn-download btn-download-secondary"
                      href={`${apiUrl}/api/library/${item.id}/download`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {t('library.download')}
                    </a>
                    <button
                      type="button"
                      className="btn-lib-action btn-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleCompare(item.id);
                      }}
                    >
                      {compareIds.includes(item.id) ? t('library.compared') : t('library.compare')}
                    </button>
                    {user && user.publicUserId === item.uploaderPublicId && (
                      <button
                        className="btn-delete-lib"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(item.id, item.filename);
                        }}
                      >
                        {t('library.delete')}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

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
