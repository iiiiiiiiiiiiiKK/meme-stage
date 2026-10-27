/// <reference types="@cloudflare/workers-types" />
import type { FunctionContext } from "../../_lib/http";
import { clientIp, editorHash, fail, json, rateLimit } from "../../_lib/http";
import { sniff, SIZE_LIMITS } from "../../_lib/files";
import { assetRecord, type AssetRow } from "../../_lib/projects";

const MAX_ASSETS_PER_OWNER = 600;

export async function onRequestGet(context: FunctionContext): Promise<Response> {
  const owner = await editorHash(context.request);
  if (!owner) return fail(401, "unauthorized", "缺少有效的编辑器身份");
  try {
    const result = await context.env.DB.prepare(
      "SELECT * FROM assets WHERE owner_hash = ? AND kind != 'cover' ORDER BY created_at DESC LIMIT 120",
    )
      .bind(owner)
      .all<AssetRow>();
    return json({ assets: (result.results ?? []).map(assetRecord) });
  } catch (error) {
    console.error("list assets failed", error);
    return fail(500, "internal", "读取素材失败");
  }
}

export async function onRequestPost(context: FunctionContext): Promise<Response> {
  const owner = await editorHash(context.request);
  if (!owner) return fail(401, "unauthorized", "缺少有效的编辑器身份");
  if (!rateLimit(`upload:${clientIp(context.request)}`, 160, 5 * 60_000)) {
    return fail(429, "rate_limited", "上传太频繁了，请稍后再试");
  }

  const declaredLength = Number(context.request.headers.get("content-length") ?? 0);
  if (declaredLength > SIZE_LIMITS.audio + 1024 * 1024) {
    return fail(413, "too_large", "文件太大了");
  }

  let form: FormData;
  try {
    form = await context.request.formData();
  } catch {
    return fail(400, "bad_form", "上传数据格式不正确");
  }

  const file = form.get("file");
  if (!(file instanceof File)) return fail(400, "missing_file", "没有收到文件");

  const kindRaw = String(form.get("kind") ?? "image");
  const kind = kindRaw === "audio" ? "audio" : kindRaw === "cover" ? "cover" : "image";
  const limit = SIZE_LIMITS[kind === "cover" ? "cover" : kind];
  if (file.size <= 0) return fail(400, "empty_file", "文件是空的");
  if (file.size > limit) {
    return fail(413, "too_large", `文件超过 ${Math.round(limit / 1024 / 1024)}MB 限制`);
  }

  const buffer = new Uint8Array(await file.arrayBuffer());
  const sniffed = sniff(buffer);
  if (!sniffed) return fail(415, "unsupported_type", "只支持 JPG / PNG / WEBP / GIF / MP3 / WAV / OGG / M4A");
  if (kind !== "audio" && sniffed.kind !== "image") {
    return fail(415, "wrong_kind", "这个文件不是图片");
  }
  if (kind === "audio" && sniffed.kind !== "audio") {
    return fail(415, "wrong_kind", "这个文件不是音频");
  }

  try {
    const countRow = await context.env.DB.prepare("SELECT COUNT(*) AS n FROM assets WHERE owner_hash = ?")
      .bind(owner)
      .first<{ n: number }>();
    if ((countRow?.n ?? 0) >= MAX_ASSETS_PER_OWNER) {
      return fail(413, "quota", "素材数量已达上限，请删除一些旧素材");
    }
  } catch {
    // counting is a guard rail, not a blocker
  }

  const id = crypto.randomUUID();
  const key = `meme-stage/${kind}/${id}.${sniffed.ext}`;
  const now = Date.now();
  const width = kind === "audio" ? null : Math.max(0, Math.min(20000, Number(form.get("width") ?? 0) || 0)) || null;
  const height = kind === "audio" ? null : Math.max(0, Math.min(20000, Number(form.get("height") ?? 0) || 0)) || null;
  const duration = kind === "audio" ? Math.max(0, Math.min(3600, Number(form.get("duration") ?? 0) || 0)) || null : null;
  const name = String(form.get("name") ?? file.name ?? "素材")
    .replace(/[<>\u0000-\u001f]/g, "")
    .trim()
    .slice(0, 80) || "素材";

  try {
    await context.env.BUCKET.put(key, buffer, {
      httpMetadata: {
        contentType: sniffed.mime,
        cacheControl: "public, max-age=31536000, immutable",
      },
    });
    await context.env.DB.prepare(
      `INSERT INTO assets (id, owner_hash, kind, object_key, mime, size, name, width, height, duration, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, owner, kind, key, sniffed.mime, buffer.byteLength, name, width, height, duration, now)
      .run();
    return json(
      {
        asset: {
          id,
          kind,
          url: `/api/files/${id}`,
          mime: sniffed.mime,
          size: buffer.byteLength,
          name,
          width,
          height,
          duration,
        },
      },
      201,
    );
  } catch (error) {
    console.error("upload failed", error);
    return fail(500, "internal", "上传失败，请稍后重试");
  }
}
