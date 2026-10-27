/** Browser-side image helpers: decoding, compression and a small image cache. */

export interface PreparedImage {
  full: Blob;
  thumb: Blob;
  width: number;
  height: number;
  fullUrl: string;
  thumbUrl: string;
}

const MAX_FULL = 1500;
const MAX_THUMB = 420;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function decode(file: Blob): Promise<{ width: number; height: number; source: CanvasImageSource; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    return {
      width: bitmap.width,
      height: bitmap.height,
      source: bitmap,
      close: () => bitmap.close(),
    };
  }
  const url = URL.createObjectURL(file);
  const img = await loadImage(url);
  return {
    width: img.naturalWidth,
    height: img.naturalHeight,
    source: img,
    close: () => URL.revokeObjectURL(url),
  };
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("图片编码失败"))),
      type,
      quality,
    );
  });
}

async function resizeTo(
  source: CanvasImageSource,
  width: number,
  height: number,
  type: string,
  quality: number,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("浏览器不支持 Canvas");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const blob = await canvasToBlob(canvas, type, quality);
  // webp may be unsupported on ancient browsers -> fall back to jpeg
  if (blob.type !== type) return canvasToBlob(canvas, "image/jpeg", quality);
  return blob;
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  const decoded = await decode(file);
  try {
    const scale = Math.min(1, MAX_FULL / Math.max(decoded.width, decoded.height));
    const fullW = Math.max(1, Math.round(decoded.width * scale));
    const fullH = Math.max(1, Math.round(decoded.height * scale));
    const full = await resizeTo(decoded.source, fullW, fullH, "image/webp", 0.9);

    const thumbScale = Math.min(1, MAX_THUMB / Math.max(decoded.width, decoded.height));
    const thumb = await resizeTo(
      decoded.source,
      Math.max(1, Math.round(decoded.width * thumbScale)),
      Math.max(1, Math.round(decoded.height * thumbScale)),
      "image/webp",
      0.78,
    );

    return {
      full,
      thumb,
      width: decoded.width,
      height: decoded.height,
      fullUrl: URL.createObjectURL(full),
      thumbUrl: URL.createObjectURL(thumb),
    };
  } finally {
    decoded.close();
  }
}

export async function probeImage(file: Blob): Promise<{ width: number; height: number }> {
  const decoded = await decode(file);
  try {
    return { width: decoded.width, height: decoded.height };
  } finally {
    decoded.close();
  }
}

const cache = new Map<string, HTMLImageElement>();
const pending = new Map<string, Promise<HTMLImageElement>>();

export function loadImage(url: string): Promise<HTMLImageElement> {
  const cached = cache.get(url);
  if (cached?.complete && cached.naturalWidth > 0) return Promise.resolve(cached);
  const inFlight = pending.get(url);
  if (inFlight) return inFlight;
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => {
      cache.set(url, img);
      pending.delete(url);
      resolve(img);
    };
    img.onerror = () => {
      pending.delete(url);
      reject(new Error(`图片加载失败：${url}`));
    };
    img.src = url;
  });
  pending.set(url, promise);
  return promise;
}

export function cachedImage(url: string | undefined): HTMLImageElement | null {
  if (!url) return null;
  const img = cache.get(url);
  return img && img.complete && img.naturalWidth > 0 ? img : null;
}

export async function audioDuration(file: Blob): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    const done = (value: number) => {
      audio.src = "";
      URL.revokeObjectURL(url);
      resolve(value);
    };
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      const d = Number.isFinite(audio.duration) ? audio.duration : 0;
      done(d);
    };
    audio.onerror = () => done(0);
    setTimeout(() => done(0), 4000);
    audio.src = url;
  });
}
