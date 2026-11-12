/// <reference types="@cloudflare/workers-types" />
/**
 * Image-to-image / style transfer.
 *
 * Two upstream calls because the gateway needs a hosted reference URL: upload the
 * sticker bytes, then ask `/v1/images/edits` to restyle them. The reference is
 * always bytes the user just picked, never a URL they typed, so this cannot be
 * abused as an SSRF probe. The result is downloaded and stored as a normal asset.
 */
import type { FunctionContext } from "../../_lib/http";
import { editorHash, fail, json, rateLimit } from "../../_lib/http";
import {
  ProviderError,
  editImage,
  fetchGenerated,
  readConfig,
  uploadReference,
} from "../../_lib/imageProvider";
import { sniff } from "../../_lib/files";
import { storeGeneratedImage } from "../../_lib/generatedAsset";

const MAX_REFERENCE_BYTES = 12 * 1024 * 1024;

export async function onRequestPost(context: FunctionContext): Promise<Response> {
  const owner = await editorHash(context.request);
  if (!owner) return fail(401, "unauthorized", "缺少有效的编辑器身份");
  if (!rateLimit(`ai-edit:${owner}`, 10, 60_000)) {
    return fail(429, "rate_limited", "转换太频繁了，请等一分钟再试");
  }

  const config = readConfig(context.env);
  if (!config) return fail(503, "not_configured", "服务器还没有配置图像生成服务");

  let form: FormData;
  try {
    form = await context.request.formData();
  } catch {
    return fail(400, "bad_form", "请求格式不正确");
  }

  const file = form.get("file");
  if (!(file instanceof File)) return fail(400, "missing_file", "没有收到参考图");
  if (file.size <= 0) return fail(400, "empty_file", "参考图是空的");
  if (file.size > MAX_REFERENCE_BYTES) return fail(413, "too_large", "参考图太大了");

  const prompt = String(form.get("prompt") ?? "").trim();
  if (!prompt) return fail(400, "empty_prompt", "提示词不能为空");

  const bytes = new Uint8Array(await file.arrayBuffer());
  // Trust the bytes, not the browser-declared MIME type.
  const sniffed = sniff(bytes);
  if (!sniffed || sniffed.kind !== "image") return fail(415, "wrong_type", "参考图必须是图片");

  const model = String(form.get("model") ?? "").trim() || undefined;
  const size = String(form.get("size") ?? "").trim() || undefined;
  const backgroundRaw = String(form.get("background") ?? "");
  const background =
    backgroundRaw === "transparent" || backgroundRaw === "opaque" || backgroundRaw === "auto"
      ? backgroundRaw
      : undefined;
  const idempotencyKey = String(form.get("idempotencyKey") ?? "").trim() || `${owner.slice(0, 16)}:${Date.now()}`;
  const name = String(form.get("name") ?? "").trim().slice(0, 40) || "AI 风格";

  try {
    const reference = await uploadReference(config, bytes, sniffed.mime);
    const result = await editImage(
      config,
      { prompt, model, size, background, images: [reference.url] },
      idempotencyKey,
    );
    const image = await fetchGenerated(result.urls[0]);
    const outType = sniff(image.bytes);
    if (!outType || outType.kind !== "image") {
      return fail(502, "bad_result", "生成的图片格式无法识别");
    }
    const asset = await storeGeneratedImage(context.env, {
      owner,
      bytes: image.bytes,
      mime: outType.mime,
      ext: outType.ext,
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
    console.error("ai edit failed", error);
    return fail(500, "internal", "转换失败，请稍后重试");
  }
}

export async function onRequestGet(): Promise<Response> {
  return fail(405, "method_not_allowed", "请用 POST");
}
