/** Render text to SSD1306 1bpp page-format bitmap (same as device poke path). */
export function renderTextToBitmap(
  text: string,
  fontSize: number = 14
): { bitmap: string; width: number; height: number } {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  ctx.font = `bold ${fontSize}px sans-serif`;
  const metrics = ctx.measureText(text);
  const textWidth = Math.ceil(metrics.width);
  const textHeight = fontSize + 4;
  const height = Math.ceil(textHeight / 8) * 8;
  const width = Math.max(textWidth + 2, 1);
  canvas.width = width;
  canvas.height = height;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#fff";
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textBaseline = "top";
  ctx.fillText(text, 1, 2);
  const imageData = ctx.getImageData(0, 0, width, height);
  const pages = height / 8;
  const bytes = new Uint8Array(width * pages);
  for (let x = 0; x < width; x++) {
    for (let page = 0; page < pages; page++) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit++) {
        const y = page * 8 + bit;
        if (y < height) {
          const idx = (y * width + x) * 4;
          if (imageData.data[idx] > 127) byte |= 1 << bit;
        }
      }
      bytes[page * width + x] = byte;
    }
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return { bitmap: btoa(binary), width, height };
}

export function drawOledPreview(
  canvas: HTMLCanvasElement,
  sender: string,
  text: string
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const W = 128;
  const H = 64;
  canvas.width = W;
  canvas.height = H;
  ctx.fillStyle = "#0a0a0a";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#c8facc";
  ctx.font = "bold 11px monospace";
  ctx.fillText(sender.slice(0, 18), 4, 14);
  ctx.font = "bold 13px monospace";
  ctx.fillText(text.slice(0, 16), 4, 36);
  ctx.strokeStyle = "#2a4a2a";
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
}
