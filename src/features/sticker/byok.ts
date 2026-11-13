/**
 * Bring-your-own-key image client.
 *
 * The API key belongs to whoever is using the site: it lives only in this browser's
 * localStorage and is sent straight from the page to the gateway. Nothing goes
 * through our Worker, so a visitor with their own key never spends the owner's
 * credit, and the owner's key is not shipped anywhere.
 *
 * Verified against the live gateway before implementing:
 *  - preflight allows `authorization` + `content-type`, `access-control-allow-origin: *`
 *  - `POST /v1/images/generations` and `/v1/images/edits` both work cross-origin
 *  - `/v1/images/uploads` accepts raw body and is also CORS-open
 *  - `/v1/images/edits` accepts an inline `data:` URL, so no upload round-trip is needed
 *  - the returned CDN image is CORS-open too (`*`), so it can be read into a Blob
 */

/**
 * Any OpenAI-compatible endpoint works: paste `https://api.openai.com/v1` and your
 * own key, or point at the hosted gateway below. The base lives in localStorage next
 * to the key, so switching providers never requires a redeploy.
 */
export const AI_BASE_URL = "https://agent3.shyfai.cn";

export const BASE_STORAGE = "ms.ai.base";

/** Strip trailing slashes and a trailing `/v1` so paths can be appended safely. */
export function normalizeBase(input: string): string | null {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  const clean = trimmed.replace(/\/v1$/i, "");
  return clean;
}

export function readStoredBase(): string {
  try {
    const raw = localStorage.getItem(BASE_STORAGE);
    return (raw && normalizeBase(raw)) || AI_BASE_URL;
  } catch {
    return AI_BASE_URL;
  }
}

export function saveStoredBase(value: string): string | null {
  const clean = normalizeBase(value);
  if (!clean) return null;
  try {
    localStorage.setItem(BASE_STORAGE, clean);
  } catch {
    return null;
  }
  return clean;
}

export function clearStoredBase(): void {
  try {
    localStorage.removeItem(BASE_STORAGE);
  } catch {
    /* ignore */
  }
}

/** Root without a trailing `/v1`; call sites append `/v1/...` themselves. */
function apiRoot(): string {
  return readStoredBase();
}

/** Models the gateway advertises; the list is refreshed from `/v1/models` when set. */
export const KNOWN_MODELS = ["gpt-image-2.5", "gpt-image-2.6"] as const;

export const ALLOWED_SIZES = ["1024x1024", "1536x1024", "1024x1536", "auto"] as const;

const KEY_STORAGE = "ms.ai.key";
const MODEL_STORAGE = "ms.ai.model";

/** A pasted key is a bearer token; keep the shape permissive but never log it. */
const KEY_RE = /^[A-Za-z0-9_-]{16,200}$/;

export function readStoredKey(): string | null {
  try {
    const raw = localStorage.getItem(KEY_STORAGE);
    return raw && KEY_RE.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function saveStoredKey(key: string): boolean {
  const trimmed = key.trim();
  if (!KEY_RE.test(trimmed)) return false;
  try {
    localStorage.setItem(KEY_STORAGE, trimmed);
    return true;
  } catch {
    return false;
  }
}

export function clearStoredKey(): void {
  try {
    localStorage.removeItem(KEY_STORAGE);
  } catch {
    /* ignore */
  }
}

export function readStoredModel(): string | null {
  try {
    return localStorage.getItem(MODEL_STORAGE);
  } catch {
    return null;
  }
}

export function saveStoredModel(model: string): void {
  try {
    localStorage.setItem(MODEL_STORAGE, model);
  } catch {
    /* ignore */
  }
}

export class AiKeyError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface AiUsage {
  total_tokens?: number;
  [key: string]: unknown;
}

export interface GeneratedAsset {
  id: string;
  url: string;
  kind: string;
  mime: string;
  size: number;
  name: string;
  width: number | null;
  height: number | null;
  duration: number | null;
}

function authHeaders(key: string): Record<string, string> {
  return { authorization: `Bearer ${key}`, "content-type": "application/json" };
}

/** Verify a key by listing models. Never throws away the reason. */
export async function probeKey(key: string): Promise<{ models: string[] }> {
  let response: Response;
  try {
    response = await fetch(`${apiRoot()}/v1/models`, {
      headers: { authorization: `Bearer ${key}` },
    });
  } catch {
    throw new AiKeyError(0, "network", "无法连接图像服务，请检查网络或代理");
  }
  if (response.status === 401 || response.status === 403) {
    throw new AiKeyError(401, "unauthorized", "密钥无效或已失效");
  }
  if (response.status === 429) {
    throw new AiKeyError(429, "rate_limited", "密钥被限流，请稍后再试");
  }
  if (!response.ok) {
    throw new AiKeyError(502, "provider_error", `图像服务返回 ${response.status}`);
  }
  const payload = (await response.json().catch(() => null)) as { data?: Array<{ id?: string }> } | null;
  const models = (payload?.data ?? [])
    .map((item) => item.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  return { models };
}

interface ProviderPayload {
  request_id?: string;
  size?: string;
  usage?: AiUsage;
  data?: Array<{ url?: string; b64_json?: string }>;
  error?: { code?: string; message?: string };
}

async function postJson(path: string, key: string, body: unknown, idempotencyKey: string): Promise<{
  requestId: string | null;
  size: string | null;
  usage: AiUsage | null;
  sourceUrl: string;
}> {
  let response: Response;
  try {
    response = await fetch(`${apiRoot()}${path}`, {
      method: "POST",
      headers: { ...authHeaders(key), "idempotency-key": idempotencyKey },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AiKeyError(0, "network", "请求图像服务失败，可能是网络或跨域被拦截");
  }
  const text = await response.text();
  let payload: ProviderPayload = {};
  try {
    payload = text ? (JSON.parse(text) as ProviderPayload) : {};
  } catch {
    throw new AiKeyError(502, "bad_json", "图像服务返回了无法解析的内容");
  }
  if (!response.ok) {
    const code = payload.error?.code ?? "provider_error";
    const message = payload.error?.message ?? `图像服务返回 ${response.status}`;
    // 401 here also means the key is wrong/expired, not a server fault.
    throw new AiKeyError(response.status === 401 ? 401 : 502, code, message);
  }
  /**
   * OpenAI's official image endpoints answer with `b64_json` (and only add a URL for
   * some models), so accept both shapes instead of assuming a CDN link.
   */
  const first = payload.data?.[0];
  const remote = typeof first?.url === "string" ? first.url : null;
  const inline = typeof first?.b64_json === "string" && first.b64_json.length > 0 ? first.b64_json : null;
  const url = remote ?? (inline ? `data:image/png;base64,${inline}` : null);
  if (!url) throw new AiKeyError(502, "no_image", "图像服务没有返回图片");
  return {
    requestId: payload.request_id ?? null,
    size: payload.size ?? null,
    usage: payload.usage ?? null,
    sourceUrl: url,
  };
}

/** Text to image. Throws `AiKeyError`; never returns a placeholder. */
export async function generateImage(input: {
  key: string;
  prompt: string;
  model?: string;
  size?: string;
  background?: "transparent" | "opaque" | "auto";
  onProgress?: (message: string) => void;
}): Promise<{ requestId: string | null; usage: AiUsage | null; sourceUrl: string }> {
  const prompt = input.prompt.trim();
  if (!prompt) throw new AiKeyError(400, "empty_prompt", "提示词不能为空");
  const model = input.model || KNOWN_MODELS[0];
  const size = ALLOWED_SIZES.includes((input.size ?? "") as (typeof ALLOWED_SIZES)[number])
    ? input.size
    : "1024x1024";
  const key = `ms-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const base = { model, prompt: prompt.slice(0, 1000), n: 1, size };

  input.onProgress?.("正在生成，通常 15–40 秒…");
  if (input.background) {
    try {
      const result = await postJson(
        "/v1/images/generations",
        input.key,
        { ...base, background: input.background },
        key,
      );
      return { requestId: result.requestId, usage: result.usage, sourceUrl: result.sourceUrl };
    } catch (error) {
      /**
       * The transparent path is the one this gateway reliably chokes on. Retrying
       * without the flag still produces a usable image (the user can cut it out
       * locally), and generation has no reference image, so nothing is lost — unlike
       * a restyle request, where dropping the reference would return an unrelated
       * picture. Same idempotency key either way: one logical generation, one charge.
       */
      const transient =
        error instanceof AiKeyError &&
        (error.code === "upstream_total_timeout" ||
          error.code === "upstream_text_reply" ||
          error.code === "no_image" ||
          error.code === "bad_json");
      if (!transient) throw error;
      input.onProgress?.("透明背景超时，改用普通背景重试…");
    }
    const retried = await postJson("/v1/images/generations", input.key, base, key);
    return { requestId: retried.requestId, usage: retried.usage, sourceUrl: retried.sourceUrl };
  }

  const result = await postJson("/v1/images/generations", input.key, base, key);
  return { requestId: result.requestId, usage: result.usage, sourceUrl: result.sourceUrl };
}

/** Restyle an existing sticker using it as an inline reference. */
export async function restyleImage(input: {
  key: string;
  file: Blob;
  prompt: string;
  model?: string;
  size?: string;
  background?: "transparent" | "opaque" | "auto";
  onProgress?: (message: string) => void;
}): Promise<{ requestId: string | null; usage: AiUsage | null; sourceUrl: string }> {
  const prompt = input.prompt.trim();
  if (!prompt) throw new AiKeyError(400, "empty_prompt", "提示词不能为空");
  input.onProgress?.("正在上传参考图…");
  const dataUrl = await blobToDataUrl(input.file);
  const model = input.model || KNOWN_MODELS[0];
  const size: string = ALLOWED_SIZES.includes((input.size ?? "") as (typeof ALLOWED_SIZES)[number])
    ? (input.size ?? "1024x1024")
    : "1024x1024";
  input.onProgress?.("正在重绘，通常 20–40 秒…");
  const idempotencyKey = `ms-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  /**
   * OpenAI's official `/v1/images/edits` takes multipart form data, while the
   * gateway takes JSON with an inline data URL. Pick the shape from the configured
   * host so both providers work without a rebuild.
   */
  const openAiShaped = !/shyfai/i.test(apiRoot());

  if (openAiShaped) {
    const form = new FormData();
    const filename = input.file instanceof File ? input.file.name : "reference.png";
    form.append("image", input.file, filename);
    form.append("prompt", prompt.slice(0, 1000));
    form.append("model", model);
    form.append("n", "1");
    form.append("size", size ?? "1024x1024");
    if (input.background) form.append("background", input.background);
    const multipart = await postMultipart("/v1/images/edits", input.key, form, idempotencyKey);
    return { requestId: multipart.requestId, usage: multipart.usage, sourceUrl: multipart.sourceUrl };
  }

  const result = await postJson(
    "/v1/images/edits",
    input.key,
    {
      model,
      prompt: prompt.slice(0, 1000),
      images: [{ image_url: dataUrl }],
      n: 1,
      size,
      ...(input.background ? { background: input.background } : {}),
    },
    idempotencyKey,
  );
  return { requestId: result.requestId, usage: result.usage, sourceUrl: result.sourceUrl };
}

/** Multipart variant used by OpenAI-shaped edit endpoints. */
async function postMultipart(
  path: string,
  key: string,
  form: FormData,
  idempotencyKey: string,
): Promise<{ requestId: string | null; usage: AiUsage | null; sourceUrl: string }> {
  let response: Response;
  try {
    response = await fetch(`${apiRoot()}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "idempotency-key": idempotencyKey },
      body: form,
    });
  } catch {
    throw new AiKeyError(0, "network", "请求图像服务失败，可能是网络或跨域被拦截");
  }
  const text = await response.text();
  let payload: ProviderPayload = {};
  try {
    payload = text ? (JSON.parse(text) as ProviderPayload) : {};
  } catch {
    throw new AiKeyError(502, "bad_json", "图像服务返回了无法解析的内容");
  }
  if (!response.ok) {
    throw new AiKeyError(
      response.status === 401 ? 401 : 502,
      payload.error?.code ?? "provider_error",
      payload.error?.message ?? `图像服务返回 ${response.status}`,
    );
  }
  const first = payload.data?.[0];
  const sourceUrl =
    (typeof first?.url === "string" ? first.url : null) ??
    (typeof first?.b64_json === "string" ? `data:image/png;base64,${first.b64_json}` : null);
  if (!sourceUrl) throw new AiKeyError(502, "no_image", "图像服务没有返回图片");
  return { requestId: payload.request_id ?? null, usage: payload.usage ?? null, sourceUrl };
}

/**
 * Upload a finished image to the imgbb host and get a permanent link back.
 *
 * Goes through our own Pages Function so the host key stays server-side and the
 * browser never needs imgbb's CORS-friendly credentials.
 */
export async function hostImage(blob: Blob): Promise<{
  url: string;
  displayUrl: string;
  thumbUrl: string;
  deleteUrl: string;
  id: string;
}> {
  const dataUrl = await blobToDataUrl(blob);
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  let response: Response;
  try {
    response = await fetch("/api/host", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ image: base64 }),
    });
  } catch {
    throw new AiKeyError(0, "network", "无法连接图床服务");
  }
  const payload = (await response.json().catch(() => null)) as
    | { url?: string; displayUrl?: string; thumbUrl?: string; deleteUrl?: string; id?: string; error?: string; message?: string }
    | null;
  if (!response.ok || !payload?.url) {
    throw new AiKeyError(502, payload?.error ?? "host_failed", payload?.message ?? "图床返回失败");
  }
  return {
    url: payload.url,
    displayUrl: payload.displayUrl ?? payload.url,
    thumbUrl: payload.thumbUrl ?? payload.url,
    deleteUrl: payload.deleteUrl ?? "",
    id: payload.id ?? "",
  };
}

/** Read the CORS-open result URL into bytes. */
export async function downloadGenerated(url: string): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new AiKeyError(0, "network", "无法下载生成的图片（可能是跨域限制或被拦截）");
  }
  if (!response.ok) throw new AiKeyError(502, "download_failed", "无法下载生成的图片");
  const blob = await response.blob();
  if (blob.size === 0) throw new AiKeyError(502, "empty_result", "生成的图片是空的");
  if (blob.size > 8 * 1024 * 1024) {
    throw new AiKeyError(413, "too_large", "生成的图片超过 8MB，无法保存");
  }
  return blob;
}

/**
 * Encode a blob as a data URL.
 *
 * `FileReader` is the fast path in a browser but is absent in a bare JS runtime, so
 * fall back to reading bytes and base64-encoding them. Chunked `String.fromCharCode`
 * keeps large stickers from blowing the argument limit.
 */
async function blobToDataUrl(blob: Blob): Promise<string> {
  if (typeof FileReader !== "undefined") {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new AiKeyError(400, "read_failed", "无法读取本地图片"));
      reader.readAsDataURL(blob);
    });
  }
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    const chunk = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunk) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
    }
    const mime = blob.type || "image/png";
    return `data:${mime};base64,${btoa(binary)}`;
  } catch {
    throw new AiKeyError(400, "read_failed", "无法读取本地图片");
  }
}

export function usageSummary(usage: AiUsage | null): string {
  const total = typeof usage?.total_tokens === "number" ? usage.total_tokens : null;
  if (total === null) return "用量未返回";
  return `${total.toLocaleString("en-US")} tokens（费用由你的账号承担）`;
}
