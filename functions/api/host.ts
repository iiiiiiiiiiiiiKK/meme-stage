/// <reference types="@cloudflare/workers-types" />
import type { FunctionContext } from "../_lib/http";
import { clientIp, fail, json, rateLimit } from "../_lib/http";

/**
 * Image hosting bridge.
 *
 * AI panels generate a PNG in the browser. Keeping every result in R2/D1 would cost
 * storage and memory for images that are only ever linked to; uploading to imgbb
 * gives back a stable URL instead. The host key stays server-side: the browser only
 * ever talks to this same-origin endpoint.
 *
 * Contract: POST /api/host  { image: "<base64, no data: prefix>", expiration?: seconds }
 * Response: { url, displayUrl, thumbUrl, deleteUrl, id, width, height }
 */

/** imgbb accepts up to 32MB, but this app never needs more than a 8MB sticker. */
const MAX_BASE64 = 12 * 1024 * 1024;

export async function onRequestPost(context: FunctionContext): Promise<Response> {
  const key = context.env.IMGBB_KEY;
  if (!key) return fail(503, "host_disabled", "图床未配置（缺少 IMGBB_KEY）");

  if (!rateLimit(`host:${clientIp(context.request)}`, 12, 60_000)) {
    return fail(429, "rate_limited", "上传太频繁，请稍后再试");
  }

  let body: { image?: unknown; expiration?: unknown };
  try {
    body = (await context.request.json()) as typeof body;
  } catch {
    return fail(400, "bad_json", "请求体不是合法 JSON");
  }

  const raw = typeof body.image === "string" ? body.image.trim() : "";
  const base64 = raw.startsWith("data:") ? raw.slice(raw.indexOf(",") + 1) : raw;
  if (!base64) return fail(400, "no_image", "缺少图片数据");
  if (base64.length > MAX_BASE64) return fail(413, "too_large", "图片超过 8MB，无法上传图床");
  if (!/^[A-Za-z0-9+/=]+$/.test(base64)) return fail(400, "bad_base64", "图片数据不是合法 base64");

  const form = new FormData();
  form.append("image", base64);
  const expiration = Number(body.expiration);
  if (Number.isFinite(expiration) && expiration >= 60 && expiration <= 15_552_000) {
    form.append("expiration", String(Math.round(expiration)));
  }

  let response: Response;
  try {
    response = await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(key)}`, {
      method: "POST",
      body: form,
    });
  } catch {
    return fail(502, "host_unreachable", "无法连接图床服务");
  }

  const payload = (await response.json().catch(() => null)) as {
    success?: boolean;
    status?: number;
    data?: {
      id?: string;
      url?: string;
      display_url?: string;
      url_viewer?: string;
      delete_url?: string;
      image?: { url?: string };
      thumb?: { url?: string };
    };
    error?: { message?: string };
  } | null;

  if (!response.ok || !payload?.success || !payload.data?.url) {
    /**
     * imgbb answers 400/code 103 when the key is disabled, over quota or restricted
     * to another domain. Say which one it is instead of a bare status code.
     */
    const code = (payload as { error?: { code?: number }; status_code?: number } | null)?.error?.code;
    if (code === 103) {
      return fail(
        502,
        "host_key_rejected",
        "图床密钥无效或被禁用（imgbb 103），请在 Pages 项目的 IMGBB_KEY 里换成有效密钥",
      );
    }
    return fail(502, "host_failed", payload?.error?.message ?? `图床返回 ${response.status}`);
  }

  return json({
    id: payload.data.id ?? "",
    url: payload.data.url,
    displayUrl: payload.data.display_url ?? payload.data.url,
    thumbUrl: payload.data.thumb?.url ?? payload.data.url,
    deleteUrl: payload.data.delete_url ?? "",
    viewerUrl: payload.data.url_viewer ?? "",
  });
}

/** GET is answered with the contract so the route is self-describing. */
export async function onRequestGet(): Promise<Response> {
  return json({ ok: true, usage: "POST { image: base64, expiration?: seconds }" });
}
