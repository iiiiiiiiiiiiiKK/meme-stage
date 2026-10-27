/// <reference types="@cloudflare/workers-types" />

export interface SniffResult {
  mime: string;
  ext: string;
  kind: "image" | "audio";
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
  if (ascii(bytes, 4, 4) === "ftyp") {
    const brand = ascii(bytes, 8, 4);
    if (["M4A ", "M4B ", "mp42", "isom", "dash"].includes(brand)) {
      return { mime: "audio/mp4", ext: "m4a", kind: "audio" };
    }
  }
  return null;
}

export const BUCKET_PREFIX = "meme-stage/";

export const SIZE_LIMITS = {
  image: 8 * 1024 * 1024,
  audio: 12 * 1024 * 1024,
  cover: 2 * 1024 * 1024,
} as const;
