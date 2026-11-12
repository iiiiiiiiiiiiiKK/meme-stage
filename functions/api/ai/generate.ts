/// <reference types="@cloudflare/workers-types" />
/**
 * Text-to-image generation.
 *
 * The provider takes 10–35s and hands back an expiring CDN URL, so the handler
 * downloads the bytes and stores its own copy in R2 + D1 before returning. The
 * UI then gets a stable `/api/files/:id` URL that behaves exactly like an
 * uploaded asset — no hot-linking to a gateway that will 404 tomorrow.
 */
import type { FunctionContext } from "../../_lib/http";
import { editorHash, fail, json, rateLimit } from "../../_lib/http";
import { ProviderError, fetchGenerated, generateImage, readConfig } from "../../_lib/imageProvider";
import { sniff } from "../../_lib/files";
import { GeneratedAssetError, storeGeneratedImage } from "../../_lib/generatedAsset";

const MAX_PROMPT = 800;

export async function onRequestPost(context: FunctionContext): Promise<Response> {
  const owner = await editorHash(context.request);
  if (!owner) return fail(401, "unauthorized", "缺少有效的编辑器身份");
  if (!rateLimit(`ai-gen:${owner}`, 12, 60_000)) {
    return fail(429, "rate_limited", "生成太频繁了，请等一分钟再试");
  }

  const config = readConfig(context.env);
  if (!config) return fail(503, "not_configured", "服务器还没有配置图像生成服务");

  let body: {
    prompt?: unknown;
    model?: unknown;
    size?: unknown;
    background?: unknown;
    idempotencyKey?: unknown;
    name?: unknown;
  };
  try {
    body = (await context.request.json()) as typeof body;
  } catch {
    return fail(400, "bad_json", "请求格式不正确");
  }

  const prompt = String(body.prompt ?? "").trim();
  if (!prompt) return fail(400, "empty_prompt", "提示词不能为空");
  if (prompt.length > MAX_PROMPT) return fail(400, "prompt_too_long", `提示词最多 ${MAX_PROMPT} 个字`);

  const backgroundRaw = String(body.background ?? "");
  const background =
    backgroundRaw === "transparent" || backgroundRaw === "opaque" || backgroundRaw === "auto"
      ? backgroundRaw
      : undefined;
  const idempotencyKey = String(body.idempotencyKey ?? "").trim() || `${owner.slice(0, 16)}:${Date.now()}`;
  const name = String(body.name ?? "").trim().slice(0, 40) || "AI 生成";

  try {
    const result = await generateImage(
      config,
      {
        prompt,
        model: typeof body.model === "string" ? body.model : undefined,
        size: typeof body.size === "string" ? body.size : undefined,
        background,
      },
      idempotencyKey,
    );
    const image = await fetchGenerated(result.urls[0]);
    const sniffed = sniff(image.bytes);
    if (!sniffed || sniffed.kind !== "image") {
      return fail(502, "bad_result", "生成的图片格式无法识别");
    }
    const asset = await storeGeneratedImage(context.env, {
      owner,
      bytes: image.bytes,
      mime: sniffed.mime,
      ext: sniffed.ext,
      name,
    });
    return json({
      requestId: result.requestId,
      size: result.size,
      usage: result.usage,
      asset,
    });
  } catch (error) {
    if (error instanceof ProviderError) return fail(error.status, error.code, error.message);
    if (error instanceof GeneratedAssetError) return fail(error.status, error.code, error.message);
    console.error("ai generate failed", error);
    return fail(500, "internal", "生成失败，请稍后重试");
  }
}

export async function onRequestGet(): Promise<Response> {
  return fail(405, "method_not_allowed", "请用 POST");
}
