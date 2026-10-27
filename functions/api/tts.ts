/// <reference types="@cloudflare/workers-types" />
import type { FunctionContext } from "../_lib/http";
import { clientIp, editorHash, fail, json, rateLimit } from "../_lib/http";
import { BUCKET_PREFIX } from "../_lib/files";

const LANGS = ["zh", "en", "jp", "kr", "fr", "es"] as const;
type Lang = (typeof LANGS)[number];

const MAX_CHARS = 300;

/** duration of a PCM WAV file, in seconds (0 when the header is unreadable) */
export function wavDuration(bytes: Uint8Array): number {
  if (bytes.length < 44) return 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) =>
    String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return 0;

  let offset = 12;
  let channels = 1;
  let sampleRate = 16000;
  let bits = 16;
  while (offset + 8 <= bytes.length) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt ") {
      if (body + 16 > bytes.length) return 0;
      channels = view.getUint16(body + 2, true) || 1;
      sampleRate = view.getUint32(body + 4, true) || 16000;
      bits = view.getUint16(body + 14, true) || 16;
    } else if (id === "data") {
      const dataSize = Math.min(size, bytes.length - body);
      const byteRate = sampleRate * channels * (bits / 8);
      return byteRate > 0 ? dataSize / byteRate : 0;
    }
    offset = body + size + (size % 2);
    if (size <= 0) break;
  }
  return 0;
}

export async function onRequestPost(context: FunctionContext): Promise<Response> {
  const owner = await editorHash(context.request);
  if (!owner) return fail(401, "unauthorized", "缺少有效的编辑器身份");
  if (!rateLimit(`tts:${clientIp(context.request)}`, 24, 60_000)) {
    return fail(429, "rate_limited", "生成语音太频繁了，请稍后再试");
  }
  if (!context.env.AI) {
    return fail(503, "tts_unavailable", "当前环境未启用文字转语音（缺少 Workers AI 绑定）");
  }

  let body: { text?: unknown; lang?: unknown; speed?: unknown };
  try {
    body = (await context.request.json()) as typeof body;
  } catch {
    return fail(400, "bad_json", "请求格式不正确");
  }

  const text = String(body.text ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length < 1) return fail(400, "empty_text", "请输入要朗读的文字");
  if (text.length > MAX_CHARS) return fail(413, "too_long", `一次最多 ${MAX_CHARS} 个字`);
  if (/[\u0000-\u001f]/.test(text)) return fail(400, "bad_text", "文字包含非法字符");

  const rawLang = String(body.lang ?? "zh").toLowerCase();
  if (!LANGS.includes(rawLang as Lang)) {
    return fail(400, "bad_lang", `不支持的语言，可选：${LANGS.join(", ")}`);
  }
  const lang = rawLang as Lang;

  let audioBase64 = "";
  try {
    const result = (await context.env.AI.run("@cf/myshell-ai/melotts", {
      prompt: text,
      lang,
    })) as { audio?: string };
    audioBase64 = result?.audio ?? "";
  } catch (error) {
    console.error("tts failed", error);
    return fail(502, "tts_failed", "语音生成失败，请稍后重试");
  }

  if (!audioBase64) return fail(502, "tts_empty", "语音生成失败（模型没有返回音频）");

  let bytes: Uint8Array;
  try {
    const binary = atob(audioBase64);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  } catch {
    return fail(502, "tts_decode", "语音生成失败（音频数据损坏）");
  }

  if (bytes.length > 6 * 1024 * 1024) return fail(413, "too_large", "生成的音频过大，请缩短文字");
  const duration = wavDuration(bytes);
  if (duration <= 0) return fail(502, "tts_format", "语音生成失败（音频格式异常）");

  const id = crypto.randomUUID();
  const key = `${BUCKET_PREFIX}tts/${id}.wav`;
  const now = Date.now();
  const name = `文字语音 · ${text.slice(0, 18)}${text.length > 18 ? "…" : ""}`;
  const speed = Math.min(2, Math.max(0.5, Number(body.speed) || 1));

  try {
    await context.env.BUCKET.put(key, bytes, {
      httpMetadata: {
        contentType: "audio/wav",
        cacheControl: "public, max-age=31536000, immutable",
      },
    });
    await context.env.DB.prepare(
      `INSERT INTO assets (id, owner_hash, kind, object_key, mime, size, name, width, height, duration, created_at)
       VALUES (?, ?, 'audio', ?, 'audio/wav', ?, ?, NULL, NULL, ?, ?)`,
    )
      .bind(id, owner, key, bytes.byteLength, name, Number(duration.toFixed(2)), now)
      .run();
  } catch (error) {
    console.error("tts store failed", error);
    return fail(500, "internal", "语音保存失败，请稍后重试");
  }

  return json(
    {
      asset: {
        id,
        kind: "audio",
        url: `/api/files/${id}`,
        mime: "audio/wav",
        size: bytes.byteLength,
        name,
        width: null,
        height: null,
        duration: Number(duration.toFixed(2)),
      },
      text,
      lang,
      speed,
    },
    201,
  );
}
