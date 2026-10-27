/// <reference types="@cloudflare/workers-types" />
import type { FunctionContext } from "../_lib/http";
import { clientIp, editorHash, fail, json, rateLimit } from "../_lib/http";
import { BUCKET_PREFIX, sniff } from "../_lib/files";
import { AZURE_VOICES, buildAzureSsml, findAzureVoice } from "../../src/lib/azureVoices";

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

export async function onRequestGet(context: FunctionContext): Promise<Response> {
  return json({
    melotts: true,
    azure: Boolean(context.env.AZURE_SPEECH_KEY && context.env.AZURE_SPEECH_REGION),
    azureVoices: AZURE_VOICES.map((voice) => ({
      id: voice.id,
      label: voice.label,
      locale: voice.locale,
      styles: voice.styles,
    })),
  });
}

export async function onRequestPost(context: FunctionContext): Promise<Response> {
  const owner = await editorHash(context.request);
  if (!owner) return fail(401, "unauthorized", "缺少有效的编辑器身份");
  if (!rateLimit(`tts:${clientIp(context.request)}`, 24, 60_000)) {
    return fail(429, "rate_limited", "生成语音太频繁了，请稍后再试");
  }

  let body: {
    provider?: unknown;
    text?: unknown;
    lang?: unknown;
    voice?: unknown;
    style?: unknown;
    speed?: unknown;
  };
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

  const provider = String(body.provider ?? "melotts") === "azure" ? "azure" : "melotts";
  const speed = Math.min(2, Math.max(0.5, Number(body.speed) || 1));

  if (provider === "azure") {
    const key = context.env.AZURE_SPEECH_KEY;
    const region = context.env.AZURE_SPEECH_REGION;
    if (!key || !region) {
      return fail(
        503,
        "azure_not_configured",
        "微软语音尚未配置（需要 AZURE_SPEECH_KEY / AZURE_SPEECH_REGION）",
      );
    }
    if (!/^[a-z0-9]{2,20}$/.test(region)) {
      return fail(500, "azure_region", "微软语音区域配置不正确");
    }

    const voiceId = String(body.voice ?? "zh-CN-XiaoxiaoNeural");
    const voice = findAzureVoice(voiceId);
    if (!voice) return fail(400, "bad_voice", "不支持的微软音色");
    const style = voice.styles.includes(String(body.style ?? "general"))
      ? String(body.style ?? "general")
      : "general";

    let ssml: string;
    try {
      ssml = buildAzureSsml({ text, voiceId, style, rate: speed });
    } catch {
      return fail(400, "bad_ssml", "语音参数不正确");
    }

    let audio: Uint8Array;
    try {
      const res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": key,
          "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
          "User-Agent": "meme-stage",
        },
        body: ssml,
      });
      if (!res.ok) {
        console.error("azure tts failed", res.status, (await res.text()).slice(0, 300));
        return fail(
          res.status === 401 || res.status === 403 ? 502 : 502,
          "azure_failed",
          res.status === 401 || res.status === 403
            ? "微软语音鉴权失败，请检查 Azure key / region"
            : `微软语音生成失败（${res.status}）`,
        );
      }
      const buffer = await res.arrayBuffer();
      audio = new Uint8Array(buffer);
    } catch (error) {
      console.error("azure tts request failed", error);
      return fail(502, "azure_failed", "无法连接微软语音服务");
    }

    if (audio.byteLength > 6 * 1024 * 1024) {
      return fail(413, "too_large", "生成的音频过大，请缩短文字");
    }
    const sniffed = sniff(audio);
    if (!sniffed || sniffed.kind !== "audio") {
      return fail(502, "azure_format", "微软语音返回了无法识别的音频");
    }
    // CBR output is 48 kbps → bytes * 8 / 48000 seconds
    const duration = Math.max(0.2, (audio.byteLength * 8) / 48000);

    const id = crypto.randomUUID();
    const ext = sniffed.mime === "audio/mpeg" ? "mp3" : sniffed.ext;
    const objectKey = `${BUCKET_PREFIX}tts/${id}.${ext}`;
    const name = `微软语音 · ${text.slice(0, 18)}${text.length > 18 ? "…" : ""}`;
    try {
      await context.env.BUCKET.put(objectKey, audio, {
        httpMetadata: { contentType: sniffed.mime, cacheControl: "public, max-age=31536000, immutable" },
      });
      await context.env.DB.prepare(
        `INSERT INTO assets (id, owner_hash, kind, object_key, mime, size, name, width, height, duration, created_at)
         VALUES (?, ?, 'audio', ?, ?, ?, ?, NULL, NULL, ?, ?)`,
      )
        .bind(id, owner, objectKey, sniffed.mime, audio.byteLength, name, Number(duration.toFixed(2)), Date.now())
        .run();
    } catch (error) {
      console.error("azure tts store failed", error);
      return fail(500, "internal", "语音保存失败，请稍后重试");
    }

    return json(
      {
        asset: {
          id,
          kind: "audio",
          url: `/api/files/${id}`,
          mime: sniffed.mime,
          size: audio.byteLength,
          name,
          width: null,
          height: null,
          duration: Number(duration.toFixed(2)),
        },
        text,
        provider,
        voice: voiceId,
        style,
        speed,
      },
      201,
    );
  }

  // ------------------------------------------------------------ MeloTTS path
  if (!context.env.AI) {
    return fail(503, "tts_unavailable", "当前环境未启用文字转语音（缺少 Workers AI 绑定）");
  }

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
  const objectKey = `${BUCKET_PREFIX}tts/${id}.wav`;
  const name = `文字语音 · ${text.slice(0, 18)}${text.length > 18 ? "…" : ""}`;
  try {
    await context.env.BUCKET.put(objectKey, bytes, {
      httpMetadata: {
        contentType: "audio/wav",
        cacheControl: "public, max-age=31536000, immutable",
      },
    });
    await context.env.DB.prepare(
      `INSERT INTO assets (id, owner_hash, kind, object_key, mime, size, name, width, height, duration, created_at)
       VALUES (?, ?, 'audio', ?, 'audio/wav', ?, ?, NULL, NULL, ?, ?)`,
    )
      .bind(id, owner, objectKey, bytes.byteLength, name, Number(duration.toFixed(2)), Date.now())
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
      provider,
      lang,
      speed,
    },
    201,
  );
}
