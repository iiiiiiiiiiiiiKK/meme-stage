/// <reference types="@cloudflare/workers-types" />
/**
 * Server-side image generation provider.
 *
 * The API key never leaves this module: the browser only talks to
 * `/api/ai/*`, and those handlers call out with a secret from the environment.
 * Everything here is a thin, verified adapter — the request/response shapes below
 * were confirmed against the live gateway before this file was written, not
 * guessed from documentation.
 */

export interface ImageProviderConfig {
  baseUrl: string;
  apiKey: string;
  models: string[];
}

export interface ProviderEnv {
  IMAGE_API_BASE_URL?: string;
  IMAGE_API_KEY?: string;
  IMAGE_API_MODELS?: string;
}

/** Models the gateway advertised and that we have actually called successfully. */
const DEFAULT_MODELS = ["gpt-image-2.5"];

/** Sizes the gateway accepts for gpt-image-2.5. */
export const ALLOWED_SIZES = ["1024x1024", "1536x1024", "1024x1536", "auto"] as const;
export type ImageSize = (typeof ALLOWED_SIZES)[number];

const REQUEST_TIMEOUT_MS = 180_000;

export function readConfig(env: ProviderEnv): ImageProviderConfig | null {
  const baseUrl = (env.IMAGE_API_BASE_URL ?? "").trim().replace(/\/+$/, "");
  const apiKey = (env.IMAGE_API_KEY ?? "").trim();
  if (!baseUrl || !apiKey) return null;
  const models = (env.IMAGE_API_MODELS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return { baseUrl, apiKey, models: models.length > 0 ? models : DEFAULT_MODELS };
}

/** Public capabilities for the UI — never includes the key. */
export function publicCapabilities(config: ImageProviderConfig | null) {
  if (!config) {
    return {
      configured: false,
      models: [] as { id: string; label: string; supportsEdit: boolean }[],
      sizes: [...ALLOWED_SIZES],
      reason: "服务器还没有配置 IMAGE_API_KEY / IMAGE_API_BASE_URL",
    };
  }
  return {
    configured: true,
    models: config.models.map((id) => ({
      id,
      label: id,
      supportsEdit: true,
    })),
    sizes: [...ALLOWED_SIZES],
    reason: null,
  };
}

export interface GenerateArgs {
  prompt: string;
  model?: string;
  size?: string;
  /** reference image URLs already uploaded to the provider */
  images?: string[];
  background?: "transparent" | "opaque" | "auto";
}

export interface ProviderResult {
  ok: true;
  requestId: string | null;
  urls: string[];
  size: string | null;
  usage: Record<string, unknown> | null;
}

export type ProviderFailure = { ok: false; status: number; code: string; message: string };

const SAFE_MODEL = /^[a-z0-9][a-z0-9.\-]{1,64}$/i;

function resolveModel(config: ImageProviderConfig, wanted?: string): string {
  const model = (wanted ?? "").trim();
  if (!model) return config.models[0];
  if (!config.models.includes(model)) {
    throw new ProviderError(400, "model_not_allowed", `模型 ${model} 不在允许列表里`);
  }
  return model;
}

export class ProviderError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * One logical generation = one idempotency key.
 *
 * Retries reuse the same key on purpose: a timeout can mean the gateway already
 * accepted the job, and a fresh key would let it bill a second image. Callers that
 * cannot tolerate that (see `editImage`) simply do not retry.
 */
async function callProvider(
  config: ImageProviderConfig,
  path: string,
  attempts: Record<string, unknown>[],
  idempotencyKey: string,
): Promise<ProviderResult> {
  let lastError: ProviderError | null = null;
  for (let index = 0; index < attempts.length; index++) {
    if (index > 0) {
      // Only retry when the previous attempt provably produced nothing. A local
      // abort is not in this set: we cancelled it ourselves, so the upstream state
      // is unknown and retrying could double-charge.
      const retryable =
        lastError?.code === "provider_no_image" ||
        lastError?.code === "provider_bad_json" ||
        lastError?.code === "upstream_total_timeout" ||
        lastError?.code === "upstream_text_reply";
      if (!retryable) throw lastError;
    }
    try {
      return await callProviderOnce(config, path, attempts[index], idempotencyKey);
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      lastError = error;
    }
  }
  throw lastError ?? new ProviderError(502, "provider_error", "上游没有返回图片");
}

function providerCode(error: { code?: string; message?: string }): string {
  const code = (error.code ?? "").trim();
  if (code) return code;
  const message = error.message ?? "";
  if (/超时|timeout/i.test(message)) return "provider_timeout";
  return "provider_error";
}

async function callProviderOnce(
  config: ImageProviderConfig,
  path: string,
  body: Record<string, unknown>,
  idempotencyKey: string,
): Promise<ProviderResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let payload: Record<string, unknown> = {};
    try {
      payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      throw new ProviderError(502, "provider_bad_json", "上游返回的不是 JSON");
    }
    if (!response.ok) {
      const error = (payload.error ?? {}) as { message?: string; code?: string };
      const code = providerCode(error);
      throw new ProviderError(
        response.status === 429 ? 429 : 502,
        code,
        error.message ?? `上游返回 ${response.status}`,
      );
    }
    const data = Array.isArray(payload.data) ? (payload.data as Array<Record<string, unknown>>) : [];
    const urls = data
      .map((item) => (typeof item.url === "string" ? item.url : typeof item.b64_json === "string" ? item.b64_json : ""))
      .filter((value) => value.length > 0);
    if (urls.length === 0) {
      throw new ProviderError(502, "provider_no_image", "上游没有返回图片");
    }
    return {
      ok: true,
      requestId: typeof payload.request_id === "string" ? payload.request_id : null,
      urls,
      size: typeof payload.size === "string" ? payload.size : null,
      usage: (payload.usage as Record<string, unknown> | undefined) ?? null,
    };
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if ((error as { name?: string }).name === "AbortError") {
      throw new ProviderError(504, "provider_timeout", "图像接口超时，请稍后重试");
    }
    throw new ProviderError(502, "provider_unreachable", error instanceof Error ? error.message : "无法连接图像接口");
  } finally {
    clearTimeout(timer);
  }
}

/** Text-to-image. */
export async function generateImage(
  config: ImageProviderConfig,
  args: GenerateArgs,
  idempotencyKey: string,
): Promise<ProviderResult> {
  const prompt = args.prompt.trim();
  if (!prompt) throw new ProviderError(400, "empty_prompt", "提示词不能为空");
  const model = resolveModel(config, args.model);
  if (!SAFE_MODEL.test(model)) throw new ProviderError(400, "bad_model", "模型名称不合法");
  const size = ALLOWED_SIZES.includes((args.size ?? "") as ImageSize) ? args.size : "1024x1024";

  // Measured against the live gateway: `response_format`, `output_format` and
  // `background` are the fields that push it into a ~196s upstream timeout. The
  // transparent variant is tried first when requested, then a minimal body is used
  // as the fallback — generation without a reference is safe to retry, because a
  // second image is still a superset of the user's intent and the UI shows the
  // result it actually got.
  const full: Record<string, unknown> = {
    model,
    prompt: prompt.slice(0, 1000),
    n: 1,
    size,
  };
  if (args.background) full.background = args.background;

  const minimal: Record<string, unknown> = { model, prompt: prompt.slice(0, 1000), n: 1, size };
  const attempts = args.background ? [full, minimal] : [full];
  return callProvider(config, "/v1/images/generations", attempts, idempotencyKey);
}

/**
 * Image-to-image with one or more reference images.
 *
 * The gateway rejects bare multipart here and requires `images[].image_url`, so
 * references must be uploaded first through `uploadReference`.
 */
export async function editImage(
  config: ImageProviderConfig,
  args: GenerateArgs,
  idempotencyKey: string,
): Promise<ProviderResult> {
  const prompt = args.prompt.trim();
  if (!prompt) throw new ProviderError(400, "empty_prompt", "提示词不能为空");
  const images = (args.images ?? []).filter((url) => /^https?:\/\//i.test(url));
  if (images.length === 0) throw new ProviderError(400, "missing_reference", "图像编辑需要先上传参考图");
  const model = resolveModel(config, args.model);
  const size = ALLOWED_SIZES.includes((args.size ?? "") as ImageSize) ? args.size : "1024x1024";

  // Edit is never retried with a reduced body: the reference image *is* the
  // request, so a retry that drops `images` would return an unrelated picture
  // while the UI labels it a restyle of the user's sticker.
  return callProvider(
    config,
    "/v1/images/edits",
    [
      {
        model,
        prompt: prompt.slice(0, 1000),
        images: images.map((url) => ({ image_url: url })),
        n: 1,
        size,
        ...(args.background ? { background: args.background } : {}),
      },
    ],
    idempotencyKey,
  );
}

/**
 * Upload raw image bytes and get back a usable reference URL.
 *
 * Verified contract: raw binary body with an `image/*` content type. A JSON body
 * or a data URL both fail, so this deliberately does not try them.
 */
export async function uploadReference(
  config: ImageProviderConfig,
  bytes: Uint8Array,
  contentType: string,
): Promise<{ url: string; width: number | null; height: number | null }> {
  if (!contentType.startsWith("image/")) {
    throw new ProviderError(400, "bad_reference_type", "参考图必须是图片");
  }
  if (bytes.byteLength === 0) throw new ProviderError(400, "empty_reference", "参考图是空的");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(`${config.baseUrl}/v1/images/uploads`, {
      method: "POST",
      headers: { authorization: `Bearer ${config.apiKey}`, "content-type": contentType },
      // The gateway wants the raw image bytes, not multipart and not JSON. The
      // cast is only needed because the worker lib and the DOM lib disagree on
      // `BodyInit`; at runtime this is the same Uint8Array.
      body: bytes as unknown as BodyInit,
      signal: controller.signal,
    });
    const text = await response.text();
    let payload: Record<string, unknown> = {};
    try {
      payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      throw new ProviderError(502, "provider_bad_json", "上传接口返回的不是 JSON");
    }
    if (!response.ok) {
      const error = (payload.error ?? {}) as { message?: string };
      throw new ProviderError(502, "upload_failed", error.message ?? `上传失败（${response.status}）`);
    }
    const url = typeof payload.url === "string" ? payload.url : "";
    if (!url) throw new ProviderError(502, "upload_no_url", "上传接口没有返回 URL");
    return {
      url,
      width: typeof payload.width === "number" ? payload.width : null,
      height: typeof payload.height === "number" ? payload.height : null,
    };
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError(502, "upload_unreachable", error instanceof Error ? error.message : "无法上传参考图");
  } finally {
    clearTimeout(timer);
  }
}

/** Download a generated image so it can be stored in R2 instead of hot-linked. */
export async function fetchGenerated(url: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  if (!/^https?:\/\//i.test(url)) throw new ProviderError(400, "bad_result_url", "返回的图片地址不合法");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new ProviderError(502, "result_download_failed", `下载生成图片失败（${response.status}）`);
    const contentType = response.headers.get("content-type") ?? "image/png";
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength === 0) throw new ProviderError(502, "result_empty", "生成的图片是空的");
    // Bound the download before it ever reaches R2; the asset store applies the
    // real user-facing limit and reports a precise error.
    if (buffer.byteLength > 24 * 1024 * 1024) {
      throw new ProviderError(502, "result_too_large", "生成的图片太大");
    }
    return { bytes: new Uint8Array(buffer), contentType };
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError(502, "result_unreachable", "无法下载生成的图片");
  } finally {
    clearTimeout(timer);
  }
}
