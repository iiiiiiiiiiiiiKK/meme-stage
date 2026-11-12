/// <reference types="@cloudflare/workers-types" />

export interface SniffResult {
  mime: string;
  ext: string;
  kind: "image" | "audio" | "video";
}

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) =>
  signature.every((value, index) => bytes[offset + index] === value);

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.subarray(start, start + length));

/** server-side magic byte sniffing — never trust the client's MIME type */
export function sniff(bytes: Uint8Array): SniffResult | null {
  if (bytes.length < 12) return null;
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { mime: "image/png", ext: "png", kind: "image" };
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { mime: "image/jpeg", ext: "jpg", kind: "image" };
  if (ascii(bytes, 0, 4) === "GIF8") return { mime: "image/gif", ext: "gif", kind: "image" };
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    return { mime: "image/webp", ext: "webp", kind: "image" };
  }
  if (ascii(bytes, 4, 4) === "ftyp" && /avi[fs]/.test(ascii(bytes, 8, 4))) {
    return { mime: "image/avif", ext: "avif", kind: "image" };
  }
  if (ascii(bytes, 0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) {
    return { mime: "audio/mpeg", ext: "mp3", kind: "audio" };
  }
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WAVE") {
    return { mime: "audio/wav", ext: "wav", kind: "audio" };
  }
  if (ascii(bytes, 0, 4) === "OggS") return { mime: "audio/ogg", ext: "ogg", kind: "audio" };
  // WebM / Matroska container: EBML magic, used for short silent effect clips
  if (
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  ) {
    return { mime: "video/webm", ext: "webm", kind: "video" };
  }
  if (ascii(bytes, 4, 4) === "ftyp") {
    const brand = ascii(bytes, 8, 4);
    if (["M4A ", "M4B "].includes(brand)) {
      return { mime: "audio/mp4", ext: "m4a", kind: "audio" };
    }
    if (["mp41", "mp42", "isom", "dash", "avc1", "iso2"].includes(brand)) {
      // isom/mp42 also carry audio-only files, so look for a video sample
      // entry in the first chunk before calling it a video.
      const head = ascii(bytes, 0, Math.min(bytes.length, 65_536));
      const hasVideoTrack =
        head.includes("avc1") || head.includes("hvc1") || head.includes("hev1") || head.includes("vp09");
      return hasVideoTrack
        ? { mime: "video/mp4", ext: "mp4", kind: "video" }
        : { mime: "audio/mp4", ext: "m4a", kind: "audio" };
    }
  }
  return null;
}

export const BUCKET_PREFIX = "meme-stage/";

export const SIZE_LIMITS = {
  image: 8 * 1024 * 1024,
  audio: 12 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  cover: 2 * 1024 * 1024,
} as const;

/**
 * Per-owner asset ceiling.
 *
 * Shared so that every path that writes an asset row — upload, TTS, generated
 * image — counts against the same budget. Having this only in the upload handler
 * meant AI output silently bypassed the quota.
 */
export const MAX_ASSETS_PER_OWNER = 600;

/**
 * Read the intrinsic pixel size straight from the header.
 *
 * Generated images were stored with `width/height = null`, so the library card
 * showed no dimensions and anything laying out by aspect ratio had to guess. This
 * is a header read only — no decode, no library.
 */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  // PNG: IHDR width/height are big-endian at offset 16 and 20.
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) && bytes.length >= 24) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16, false);
    const height = view.getUint32(20, false);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  // GIF: little-endian at offset 6.
  if (ascii(bytes, 0, 4) === "GIF8" && bytes.length >= 10) {
    const width = bytes[6] | (bytes[7] << 8);
    const height = bytes[8] | (bytes[9] << 8);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  // WEBP (VP8/VP8L/VP8X).
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP" && bytes.length >= 30) {
    const chunk = ascii(bytes, 12, 4);
    if (chunk === "VP8X") {
      const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
      const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
      return { width, height };
    }
    if (chunk === "VP8 ") {
      const width = (bytes[26] | (bytes[27] << 8)) & 0x3fff;
      const height = (bytes[28] | (bytes[29] << 8)) & 0x3fff;
      return width > 0 && height > 0 ? { width, height } : null;
    }
  }
  // JPEG: walk the segment chain looking for a start-of-frame marker.
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1];
      const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
        const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
        return width > 0 && height > 0 ? { width, height } : null;
      }
      if (length <= 0) return null;
      offset += 2 + length;
    }
  }
  return null;
}
