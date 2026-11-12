export function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

export function ctx2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available in this browser.');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return ctx;
}

export async function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    return await urlToImage(url);
  } finally {
    // the image keeps its decoded bitmap; revoking is safe after load
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export function urlToImage(url: string, crossOrigin = false): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode that image.'));
    img.src = url;
  });
}

export async function fileToImage(file: File): Promise<HTMLImageElement> {
  if (!file.type.startsWith('image/')) {
    throw new Error('That file is not an image.');
  }
  return blobToImage(file);
}

export function bitmapToCanvas(bitmap: ImageBitmap | HTMLImageElement, maxSide = 2048): HTMLCanvasElement {
  const w = 'width' in bitmap ? bitmap.width : 0;
  const h = 'height' in bitmap ? bitmap.height : 0;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const canvas = createCanvas(w * scale, h * scale);
  const ctx = ctx2d(canvas);
  ctx.drawImage(bitmap as CanvasImageSource, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Refuse inputs whose full-resolution decode would likely exhaust browser memory. */
export const MAX_INPUT_BYTES = 40 * 1024 * 1024;
/** Upper bound on decoded pixels before downscaling. */
export const MAX_INPUT_PIXELS = 60_000_000;

export class ImageTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageTooLargeError';
  }
}

function assertDecodableSize(width: number, height: number): void {
  if (width * height > MAX_INPUT_PIXELS) {
    throw new ImageTooLargeError(
      `That image is ${width}×${height} (${Math.round((width * height) / 1e6)} MP). The limit is ${MAX_INPUT_PIXELS / 1e6} MP.`,
    );
  }
}

export async function decodeToCanvas(file: Blob, maxSide = 2048): Promise<HTMLCanvasElement> {
  if (file.size > MAX_INPUT_BYTES) {
    throw new ImageTooLargeError(
      `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${MAX_INPUT_BYTES / 1024 / 1024} MB.`,
    );
  }
  if ('createImageBitmap' in window) {
    try {
      const bitmap = await createImageBitmap(file);
      try {
        assertDecodableSize(bitmap.width, bitmap.height);
        return bitmapToCanvas(bitmap, maxSide);
      } finally {
        bitmap.close();
      }
    } catch (error) {
      if (error instanceof ImageTooLargeError) throw error;
      // fall through to <img> decoding (Safari quirks)
    }
  }
  const img = await blobToImage(file);
  assertDecodableSize(img.naturalWidth, img.naturalHeight);
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = createCanvas(img.naturalWidth * scale, img.naturalHeight * scale);
  ctx2d(canvas).drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png', quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the image.'))),
      type,
      quality,
    );
  });
}

export function canvasToDataURL(canvas: HTMLCanvasElement, type = 'image/png'): string {
  return canvas.toDataURL(type);
}

export async function makeThumbnail(source: HTMLCanvasElement | Blob, size = 360): Promise<Blob> {
  let canvas: HTMLCanvasElement;
  if (source instanceof Blob) {
    canvas = await decodeToCanvas(source, 1024);
  } else {
    canvas = source;
  }
  const scale = Math.min(1, size / Math.max(canvas.width, canvas.height));
  const thumb = createCanvas(Math.max(1, canvas.width * scale), Math.max(1, canvas.height * scale));
  const ctx = ctx2d(thumb);
  ctx.drawImage(canvas, 0, 0, thumb.width, thumb.height);
  // WebP keeps alpha and is compact; fall back to PNG where unsupported.
  const blob = await canvasToBlob(thumb, 'image/webp', 0.82).catch(() => canvasToBlob(thumb, 'image/png'));
  return blob;
}

export function isTransparent(canvas: HTMLCanvasElement, step = 3): boolean {
  const ctx = ctx2d(canvas);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let i = 3; i < data.length; i += 4 * step) {
    if (data[i] < 250) return true;
  }
  return false;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

export function timestampSlug(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(
    date.getMinutes(),
  )}${pad(date.getSeconds())}`;
}

export function sanitizeFilename(name: string, fallback = 'image'): string {
  const cleaned = name
    .replace(/\.[^.]+$/, '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
  return cleaned || fallback;
}

/** Draw a transparency checkerboard with fixed cell size in CSS pixels. */
export function drawCheckerboard(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  cell = 12,
  dark = false,
): void {
  const a = dark ? '#171b24' : '#e8ebf0';
  const b = dark ? '#20252f' : '#f7f8fb';
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();
  ctx.fillStyle = a;
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = b;
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if ((row + col) % 2 === 0) {
        ctx.fillRect(x + col * cell, y + row * cell, cell, cell);
      }
    }
  }
  ctx.restore();
}
