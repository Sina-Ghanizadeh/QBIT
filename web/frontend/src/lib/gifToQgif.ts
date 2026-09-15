/** Client-side GIF → .qgif converter (Chrome/Edge ImageDecoder). */

export type ScaleMode = 'fit' | 'stretch' | 'fit_width' | 'fit_height';

export interface GifToQgifOptions {
  threshold?: number;
  invert?: boolean;
  scale?: ScaleMode;
  maxFrames?: number;
}

const W = 128;
const H = 64;
const FRAME_SIZE = (W / 8) * H; // 1024

function resizeGray(
  src: Uint8ClampedArray,
  sw: number,
  sh: number,
  scale: ScaleMode
): Uint8Array {
  const out = new Uint8Array(W * H); // filled with 0 (black)

  let dw = W;
  let dh = H;
  if (scale === 'stretch') {
    dw = W;
    dh = H;
  } else if (scale === 'fit_width') {
    dw = W;
    dh = Math.max(1, Math.round((sh * W) / sw));
  } else if (scale === 'fit_height') {
    dh = H;
    dw = Math.max(1, Math.round((sw * H) / sh));
  } else {
    const ratio = Math.min(W / sw, H / sh);
    dw = Math.max(1, Math.round(sw * ratio));
    dh = Math.max(1, Math.round(sh * ratio));
  }

  const xOff = Math.floor((W - Math.min(dw, W)) / 2);
  const yOff = Math.floor((H - Math.min(dh, H)) / 2);
  const drawW = Math.min(dw, W);
  const drawH = Math.min(dh, H);

  for (let y = 0; y < drawH; y++) {
    const sy = Math.min(sh - 1, Math.floor((y * sh) / dh));
    for (let x = 0; x < drawW; x++) {
      const sx = Math.min(sw - 1, Math.floor((x * sw) / dw));
      const si = (sy * sw + sx) * 4;
      const r = src[si];
      const g = src[si + 1];
      const b = src[si + 2];
      const a = src[si + 3];
      // Composite on black
      const lum =
        a === 0
          ? 0
          : (((0.299 * r + 0.587 * g + 0.114 * b) * a) / 255 + 0.5) | 0;
      out[(yOff + y) * W + (xOff + x)] = lum;
    }
  }
  return out;
}

function packBitmap(luma: Uint8Array, threshold: number, invert: boolean): Uint8Array {
  const bitmap = new Uint8Array(FRAME_SIZE);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let bitOn = luma[y * W + x] < threshold;
      if (invert) bitOn = !bitOn;
      if (bitOn) {
        const byteIdx = y * (W / 8) + (x >> 3);
        const bitIdx = 7 - (x & 7);
        bitmap[byteIdx] |= 1 << bitIdx;
      }
    }
  }
  return bitmap;
}

export function supportsGifDecode(): boolean {
  return typeof (globalThis as { ImageDecoder?: unknown }).ImageDecoder === 'function';
}

export async function gifFileToQgif(
  file: Blob,
  opts: GifToQgifOptions = {}
): Promise<{ buffer: Uint8Array; frameCount: number; filename: string }> {
  if (!supportsGifDecode()) {
    throw new Error('GIF decode needs Chrome or Edge (ImageDecoder)');
  }

  const threshold = opts.threshold ?? 128;
  const invert = !!opts.invert;
  const scale = opts.scale ?? 'fit';
  const maxFrames = opts.maxFrames ?? 255;

  const data = await file.arrayBuffer();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ImageDecoderCtor = (globalThis as any).ImageDecoder;
  const decoder = new ImageDecoderCtor({ data, type: 'image/gif' });
  await decoder.tracks.ready;
  const track = decoder.tracks.selectedTrack;
  if (!track) throw new Error('No GIF track');

  const frameCount = Math.min(track.frameCount || 1, maxFrames);
  const delays: number[] = [];
  const frames: Uint8Array[] = [];

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  // Use a large offscreen for source
  const srcCanvas = document.createElement('canvas');
  const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
  if (!srcCtx) throw new Error('Canvas unavailable');

  for (let i = 0; i < frameCount; i++) {
    const result = await decoder.decode({ frameIndex: i });
    const vf = result.image as VideoFrame;
    const delayUs = typeof result.image.duration === 'number' ? result.image.duration : 100_000;
    let delayMs = Math.round(delayUs / 1000);
    if (!delayMs || delayMs < 1) delayMs = 100;
    delays.push(Math.min(delayMs, 65535));

    srcCanvas.width = vf.displayWidth || vf.codedWidth;
    srcCanvas.height = vf.displayHeight || vf.codedHeight;
    srcCtx.clearRect(0, 0, srcCanvas.width, srcCanvas.height);
    srcCtx.drawImage(vf, 0, 0);
    vf.close();

    const img = srcCtx.getImageData(0, 0, srcCanvas.width, srcCanvas.height);
    const gray = resizeGray(img.data, srcCanvas.width, srcCanvas.height, scale);
    frames.push(packBitmap(gray, threshold, invert));
  }

  try {
    decoder.close();
  } catch {
    /* ignore */
  }

  const header = new Uint8Array(5 + frameCount * 2 + frameCount * FRAME_SIZE);
  const view = new DataView(header.buffer);
  header[0] = frameCount;
  view.setUint16(1, W, true);
  view.setUint16(3, H, true);
  let off = 5;
  for (let i = 0; i < frameCount; i++) {
    view.setUint16(off, delays[i], true);
    off += 2;
  }
  for (let i = 0; i < frameCount; i++) {
    header.set(frames[i], off);
    off += FRAME_SIZE;
  }

  const base =
    (file instanceof File && file.name ? file.name.replace(/\.[^.]+$/, '') : 'animation') ||
    'animation';
  return { buffer: header, frameCount, filename: `${base}.qgif` };
}
