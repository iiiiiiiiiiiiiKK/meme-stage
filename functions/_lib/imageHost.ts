/// <reference types="@cloudflare/workers-types" />
/**
 * Where a generated image's bytes live.
 *
 * R2 is object storage, not Worker memory, so it does not consume the isolate that
 * served the request — but it does count against the bucket. When an image-host key
 * is configured the bytes can go to imgbb instead and the asset row simply records
 * the external URL, so `/api/files/:id` keeps working for every existing consumer.
 *
 * The provider is a pure adapter: it either returns a verified https URL or throws.
 * Nothing here trusts the remote response shape beyond the fields it validates.
 */

export interface ImageHostEnv {
  IMAGE_HOST?: string;
  IMGBB_API_KEY?: string;
}

export type ImageHostConfig =
  | { kind: "r2" }
  | { kind: "imgbb"; apiKey: string };

/** Sentinel prefix in `assets.object_key` meaning "bytes live off-platform". */
export const EXTERNAL_KEY_PREFIX = "ext::";

export function externalKey(url: string): string {
  return `${EXTERNAL_KEY_PREFIX}${url}`;
}

export function externalUrlOf(objectKey: string): string | null {
  if (!objectKey.startsWith(EXTERNAL_KEY_PREFIX)) return null;
  const url = objectKey.slice(EXTERNAL_KEY_PREFIX.length);
  return /^https:\/\//i.test(url) ? url : null;
}

/**
 * Default is R2 because it is the same-origin, delete-capable, quota-counted store
 * the rest of the app already uses. imgbb is opt-in: it cannot be deleted through
 * our API and its URLs are public and permanent.
 */
export function readImageHost(env: ImageHostEnv): ImageHostConfig {
  const wantsImgbb = (env.IMAGE_HOST ?? "").trim().toLowerCase() === "imgbb";
  const apiKey = (env.IMGBB_API_KEY ?? "").trim();
  if (wantsImgbb && apiKey) return { kind: "imgbb", apiKey };
  return { kind: "r2" };
}

export class ImageHostError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Read `content-length` of the hosted file.
 *
 * Best effort: a HEAD that fails returns null and the caller falls back to a less
 * precise number. Never throws — a successful upload must not be reported as a
 * failure over a metadata nicety.
 */
async function measureHostedSize(url: string): Promise<number | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(url, { method: "HEAD", signal: controller.signal });
      if (!response.ok) return null;
      const length = Number(response.headers.get("content-length") ?? 0);
      return Number.isFinite(length) && length > 0 ? length : null;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

interface ImgbbResponse {  success?: boolean;
  status?: number;
  data?: {
    url?: string;
    display_url?: string;
    width?: string;
    height?: string;
    size?: string;
  };
  error?: { message?: string };
}

/**
 * Upload raw bytes to imgbb and return the direct image URL.
 *
 * Contract verified against the documented v1 API: `POST /1/upload` with `key` in
 * the query string and the image as base64 in a form field (the docs also accept
 * a bare `image` file; base64 avoids a multipart body in a Worker).
 */
export async function uploadToImgbb(
  config: { apiKey: string },
  bytes: Uint8Array,
  name: string,
  timeoutMs = 60_000,
): Promise<{ url: string; width: number | null; height: number | null; size: number | null }> {
  if (bytes.byteLength === 0) {
    throw new ImageHostError(502, "host_empty", "要上传的图片是空的");
  }
  // base64 without Buffer (Workers provide btoa over a binary string).
  let base64 = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    base64 += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  const encoded = btoa(base64);

  const form = new URLSearchParams();
  form.set("image", encoded);
  form.set("name", name.slice(0, 60));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(
      `https://api.imgbb.com/1/upload?key=${encodeURIComponent(config.apiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form.toString(),
        signal: controller.signal,
      },
    );
    const text = await response.text();
    let payload: ImgbbResponse = {};
    try {
      payload = text ? (JSON.parse(text) as ImgbbResponse) : {};
    } catch {
      throw new ImageHostError(502, "host_bad_json", "图床返回的不是 JSON");
    }
    if (!response.ok || payload.success === false) {
      throw new ImageHostError(
        502,
        "host_failed",
        payload.error?.message ?? `图床上传失败（${response.status}）`,
      );
    }
    const url = payload.data?.display_url ?? payload.data?.url ?? "";
    if (!/^https:\/\//i.test(url)) {
      throw new ImageHostError(502, "host_no_url", "图床没有返回可用的图片地址");
    }
    const width = Number(payload.data?.width ?? 0) || null;
    const height = Number(payload.data?.height ?? 0) || null;
    /**
     * imgbb re-encodes uploads, and its `size` field does not match what the CDN
     * actually serves (measured: reported 746546, served 336354). Ask the hosting
     * URL itself so the asset row, the library card and the quota all describe the
     * file that really exists there.
     */
    const measured = await measureHostedSize(url);
    const reported = Number(payload.data?.size ?? 0) || null;
    return { url, width, height, size: measured ?? reported };
  } catch (error) {
    if (error instanceof ImageHostError) throw error;
    if ((error as { name?: string }).name === "AbortError") {
      throw new ImageHostError(504, "host_timeout", "图床上传超时");
    }
    throw new ImageHostError(
      502,
      "host_unreachable",
      error instanceof Error ? error.message : "无法连接图床",
    );
  } finally {
    clearTimeout(timer);
  }
}
