import { useEffect, useRef, useState } from 'react';
import type { NetworkDeviceNode } from '../types';
import { useI18n } from '../i18n';

const API_URL = import.meta.env.VITE_API_URL || '';
const W = 128;
const H = 64;
const FRAME_INTERVAL_MS = 100;

interface LibraryItem {
  id: string;
  filename: string;
}

export interface DeviceSocket {
  emit: (ev: string, data?: unknown) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on: (ev: string, fn: (...args: any[]) => void) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  off: (ev: string, fn: (...args: any[]) => void) => void;
}

interface Props {
  device: NetworkDeviceNode;
  socket: DeviceSocket | null;
  onError: (msg: string | null) => void;
}

function packThreshold(luma: Uint8Array, cutoff: number): Uint8Array {
  const out = new Uint8Array((W * H) >> 3);
  for (let i = 0; i < W * H; i++) {
    if (luma[i] < cutoff) out[i >> 3] |= 1 << (7 - (i & 7));
  }
  return out;
}

export default function DeviceCloudPanel({ device, socket, onError }: Props) {
  const { t } = useI18n();
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [libraryId, setLibraryId] = useState('');
  const [settingAnim, setSettingAnim] = useState(false);
  const [camMsg, setCamMsg] = useState('');
  const [camRunning, setCamRunning] = useState(false);
  const [cutoff, setCutoff] = useState(128);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const runningRef = useRef(false);
  const sessionReadyRef = useRef(false);
  const frameLogRef = useRef(0);
  const cutoffRef = useRef(cutoff);
  cutoffRef.current = cutoff;

  useEffect(() => {
    fetch(`${API_URL}/api/library?sort=newest`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : []))
      .then((items: LibraryItem[]) => {
        const list = Array.isArray(items) ? items : [];
        setLibrary(list);
        if (list.length) setLibraryId((prev) => prev || list[0].id);
      })
      .catch(() => setLibrary([]));
  }, []);

  useEffect(() => {
    if (!socket) return;
    const onCamErr = (data: unknown) => {
      const d = data as { deviceId?: string; error?: string };
      if (d?.deviceId && d.deviceId !== device.deviceId) return;
      onError(d?.error || 'Camera relay failed');
      stopCamInternal(false);
    };
    const onCamStopped = (data: unknown) => {
      const d = data as { deviceId?: string; reason?: string; message?: string };
      if (d?.deviceId && d.deviceId !== device.deviceId) return;
      console.info('[cam] device:cam:stopped', d);
      sessionReadyRef.current = false;
      if (d?.reason === 'busy') {
        onError(d.message || 'Device busy (game/menu or camera in use)');
      } else if (d?.reason === 'user_exit') {
        setCamMsg('Stopped on device (tap).');
      } else {
        setCamMsg(`Stream ended (${d?.reason || 'stopped'}).`);
      }
      stopCamInternal(false);
    };
    const onCamStarted = (data: unknown) => {
      const d = data as { deviceId?: string };
      if (d?.deviceId && d.deviceId !== device.deviceId) return;
      console.info('[cam] device:cam:started', d);
      sessionReadyRef.current = true;
      setCamMsg('Streaming to device — tap the OLED to exit.');
      if (runningRef.current && timerRef.current == null) sendFrame();
    };
    socket.on('device:cam:error', onCamErr);
    socket.on('device:cam:stopped', onCamStopped);
    socket.on('device:cam:started', onCamStarted);
    return () => {
      socket.off('device:cam:error', onCamErr);
      socket.off('device:cam:stopped', onCamStopped);
      socket.off('device:cam:started', onCamStarted);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, device.deviceId]);

  useEffect(() => {
    return () => {
      stopCamInternal(true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device.deviceId]);

  function stopCamInternal(notifyDevice: boolean) {
    runningRef.current = false;
    sessionReadyRef.current = false;
    setCamRunning(false);
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (notifyDevice && socket && device.online) {
      try {
        socket.emit('device:cam:stop', { deviceId: device.deviceId });
      } catch {
        /* ignore */
      }
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    videoRef.current = null;
  }

  const setAnimation = async () => {
    if (!libraryId) {
      onError('Pick a library animation first');
      return;
    }
    if (!device.online) {
      onError('Device must be online');
      return;
    }
    setSettingAnim(true);
    onError(null);
    try {
      const res = await fetch(
        `${API_URL}/api/devices/${encodeURIComponent(device.deviceId)}/animation`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ libraryId }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to set animation');
      setCamMsg('Animation sent — device is downloading and playing.');
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setSettingAnim(false);
    }
  };

  const sendFrame = () => {
    timerRef.current = null;
    if (!runningRef.current || !socket || !videoRef.current || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(videoRef.current, 0, 0, W, H);
    const pixels = ctx.getImageData(0, 0, W, H).data;
    const luma = new Uint8Array(W * H);
    for (let i = 0, p = 0; i < W * H; i++, p += 4) {
      luma[i] = (0.299 * pixels[p] + 0.587 * pixels[p + 1] + 0.114 * pixels[p + 2] + 0.5) | 0;
    }
    const frame = packThreshold(luma, cutoffRef.current);
    if (previewRef.current) {
      const pctx = previewRef.current.getContext('2d');
      if (pctx) {
        const img = pctx.createImageData(W, H);
        for (let i = 0; i < W * H; i++) {
          const dark = (frame[i >> 3] >> (7 - (i & 7))) & 1;
          const v = dark ? 0 : 255;
          const o = i * 4;
          img.data[o] = img.data[o + 1] = img.data[o + 2] = v;
          img.data[o + 3] = 255;
        }
        pctx.putImageData(img, 0, 0);
      }
    }
    // Send raw ArrayBuffer so Socket.io transports binary (not a JSON object).
    const ab = frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength);
    frameLogRef.current += 1;
    if (frameLogRef.current <= 5 || frameLogRef.current % 50 === 0) {
      console.info('[cam] device:cam:frame', {
        deviceId: device.deviceId,
        frameLen: frame.length,
        seq: frameLogRef.current,
      });
    }
    socket.emit('device:cam:frame', { deviceId: device.deviceId, frame: ab });
    timerRef.current = window.setTimeout(sendFrame, FRAME_INTERVAL_MS);
  };

  const startCam = async () => {
    onError(null);
    setCamMsg('');
    if (!socket) {
      onError('Not connected to server');
      return;
    }
    if (!device.online) {
      onError('Device must be online');
      return;
    }
    if (!window.isSecureContext) {
      onError('Camera needs HTTPS or localhost');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      onError('Camera API not available');
      return;
    }
    try {
      setCamMsg(t('device.requestingCam'));
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 128 }, height: { ideal: 64 }, facingMode: 'user' },
        audio: false,
      });
      streamRef.current = stream;
      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await video.play();
      videoRef.current = video;

      const cvs = document.createElement('canvas');
      cvs.width = W;
      cvs.height = H;
      const ctx = cvs.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.translate(W, 0);
        ctx.scale(-1, 1);
      }
      canvasRef.current = cvs;

      console.info('[cam] device:cam:start', { deviceId: device.deviceId });
      socket.emit('device:cam:start', { deviceId: device.deviceId });
      runningRef.current = true;
      sessionReadyRef.current = false;
      frameLogRef.current = 0;
      setCamRunning(true);
      setCamMsg('Starting stream (waiting for device accept)…');
      sendFrame();
    } catch (e) {
      stopCamInternal(true);
      onError(e instanceof Error ? e.message : 'Camera failed');
      setCamMsg('');
    }
  };

  return (
    <div className="device-cloud-panel">
      <div className="dash-form-row">
        <select
          value={libraryId}
          onChange={(e) => setLibraryId(e.target.value)}
          disabled={!device.online || library.length === 0}
          aria-label={t('device.libraryAnim')}
        >
          {library.length === 0 ? (
            <option value="">{t('profile.noLibrary')}</option>
          ) : (
            library.map((item) => (
              <option key={item.id} value={item.id}>
                {item.filename}
              </option>
            ))
          )}
        </select>
        <button
          type="button"
          className="btn-primary"
          disabled={!device.online || !libraryId || settingAnim}
          onClick={() => void setAnimation()}
        >
          {settingAnim ? t('poke.sending') : t('device.setGif')}
        </button>
      </div>

      <div className="device-cam-row">
        <canvas ref={previewRef} className="device-cam-preview" width={W} height={H} />
        <div className="dash-form-row">
          <label className="device-cam-cutoff">
            Cutoff
            <input
              type="range"
              min={0}
              max={255}
              value={cutoff}
              onChange={(e) => setCutoff(Number(e.target.value))}
              disabled={!camRunning}
            />
          </label>
          {!camRunning ? (
            <button
              type="button"
              className="btn-primary"
              disabled={!device.online || !socket}
              onClick={() => void startCam()}
            >
              {t('device.cam')}
            </button>
          ) : (
            <button type="button" className="btn-text" onClick={() => stopCamInternal(true)}>
              {t('device.stopCam')}
            </button>
          )}
        </div>
      </div>
      {camMsg && <p className="page-sub">{camMsg}</p>}
    </div>
  );
}
