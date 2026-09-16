import { useState } from 'react';
import { gifFileToQgif, supportsGifDecode, type ScaleMode } from '../lib/gifToQgif';
import QgifPreview from './QgifPreview';
import { useI18n } from '../i18n';

interface Props {
  apiUrl: string;
  canUpload: boolean;
  onUploaded: () => void;
}

function toBlobPart(bytes: Uint8Array): BlobPart {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

export default function GifConverterPanel({ apiUrl, canUpload, onUploaded }: Props) {
  const { t } = useI18n();
  const [threshold, setThreshold] = useState(128);
  const [invert, setInvert] = useState(false);
  const [scale, setScale] = useState<ScaleMode>('fit');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [qgif, setQgif] = useState<{ buffer: Uint8Array; filename: string; frameCount: number } | null>(
    null
  );

  const supported = supportsGifDecode();

  const convert = async (file: File) => {
    setBusy(true);
    setMsg(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setQgif(null);
    try {
      const result = await gifFileToQgif(file, { threshold, invert, scale });
      const part = toBlobPart(result.buffer);
      const blob = new Blob([part], { type: 'application/octet-stream' });
      setPreviewUrl(URL.createObjectURL(blob));
      setQgif({ ...result, buffer: part as Uint8Array });
      setMsg(`Ready: ${result.filename} (${result.frameCount} frames)`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Convert failed');
    } finally {
      setBusy(false);
    }
  };

  const download = () => {
    if (!qgif || !previewUrl) return;
    const a = document.createElement('a');
    a.href = previewUrl;
    a.download = qgif.filename;
    a.click();
  };

  const upload = async () => {
    if (!qgif || !canUpload) return;
    setBusy(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append('file', new File([toBlobPart(qgif.buffer)], qgif.filename));
      const res = await fetch(`${apiUrl}/api/library/upload`, {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setMsg(`Uploaded ${qgif.filename} to library`);
      onUploaded();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="gif-converter">
      <h2 className="gif-converter-title">{t('gif.title')}</h2>
      <p className="page-sub">
        Convert a standard GIF to QBIT .qgif (128x64 mono), then download or upload to the library.
      </p>
      {!supported && (
        <p className="page-error">
          This browser cannot decode animated GIFs here. Use Chrome/Edge, or run{' '}
          <code>python tools/gif2qbit.py input.gif</code> locally.
        </p>
      )}
      <div className="dash-form-row">
        <label>
          Threshold
          <input
            type="range"
            min={0}
            max={255}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
          />
          <span>{threshold}</span>
        </label>
        <label className="dash-toggle compact">
          <input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} />
          <span>{t('gif.invert')}</span>
        </label>
        <label>
          Scale
          <select value={scale} onChange={(e) => setScale(e.target.value as ScaleMode)}>
            <option value="fit">fit</option>
            <option value="stretch">stretch</option>
            <option value="fit_width">fit_width</option>
            <option value="fit_height">fit_height</option>
          </select>
        </label>
        <label className="btn-primary gif-converter-file">
          {busy ? 'Working...' : 'Choose GIF'}
          <input
            type="file"
            accept="image/gif,.gif"
            hidden
            disabled={!supported || busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void convert(f);
              e.target.value = '';
            }}
          />
        </label>
      </div>
      {previewUrl && (
        <div className="gif-converter-preview">
          <QgifPreview src={previewUrl} />
          <div className="dash-form-row">
            <button type="button" className="btn-primary" onClick={download} disabled={busy}>
              Download .qgif
            </button>
            {canUpload && (
              <button type="button" className="btn-primary" onClick={() => void upload()} disabled={busy}>
                Upload to library
              </button>
            )}
          </div>
        </div>
      )}
      {msg && <p className="page-sub">{msg}</p>}
    </section>
  );
}