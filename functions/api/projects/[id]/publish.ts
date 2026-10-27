/// <reference types="@cloudflare/workers-types" />
import type { FunctionContext } from "../../../_lib/http";
import { editorHash, fail, json } from "../../../_lib/http";
import { normalizeForStorage, ValidationError } from "../../../../src/lib/schema";
import { findProjectById, slugTaken } from "../../../_lib/projects";
import { shortSlug } from "../../../../src/lib/ids";
import { sniff } from "../../../_lib/files";

function idOf(context: FunctionContext): string {
  const value = context.params.id;
  return Array.isArray(value) ? value[0] : (value ?? "");
}

async function uniqueSlug(env: FunctionContext["env"], title: string): Promise<string> {
  const base = shortSlug(title);
  for (let attempt = 0; attempt < 6; attempt++) {
    const suffix = Math.random().toString(36).slice(2, 6);
    const candidate = `${base}-${suffix}`;
    if (!(await slugTaken(env, candidate))) return candidate;
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

const DATA_URL_RE = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/;

export async function onRequestPost(context: FunctionContext): Promise<Response> {
  const owner = await editorHash(context.request);
  if (!owner) return fail(401, "unauthorized", "缺少有效的编辑器身份");
  const id = idOf(context);
  const row = await findProjectById(context.env, id);
  if (!row || row.owner_hash !== owner) return fail(404, "not_found", "作品不存在或无权发布");

  let body: { data?: unknown; coverDataUrl?: string; slug?: string };
  try {
    body = (await context.request.json()) as typeof body;
  } catch {
    return fail(400, "bad_json", "请求格式不正确");
  }

  let jsonData: string;
  let title: string;
  let description: string;
  try {
    const normalized = normalizeForStorage(body.data);
    jsonData = normalized.json;
    title = normalized.project.title;
    description = normalized.project.description;
  } catch (error) {
    if (error instanceof ValidationError) return fail(400, "invalid_project", error.message);
    return fail(400, "invalid_project", "作品数据不合法");
  }

  let coverUrl: string | null = row.cover_url;
  if (typeof body.coverDataUrl === "string" && body.coverDataUrl.length < 3_000_000) {
    const match = body.coverDataUrl.match(DATA_URL_RE);
    if (match) {
      const binary = Uint8Array.from(atob(match[2]), (ch) => ch.charCodeAt(0));
      if (binary.byteLength <= 2 * 1024 * 1024) {
        const sniffed = sniff(binary);
        if (sniffed && sniffed.kind === "image") {
          const assetId = crypto.randomUUID();
          const key = `meme-stage/cover/${assetId}.${sniffed.ext}`;
          await context.env.BUCKET.put(key, binary, {
            httpMetadata: {
              contentType: sniffed.mime,
              cacheControl: "public, max-age=31536000, immutable",
            },
          });
          const now = Date.now();
          await context.env.DB.prepare(
            `INSERT INTO assets (id, owner_hash, kind, object_key, mime, size, name, width, height, duration, created_at)
             VALUES (?, ?, 'cover', ?, ?, ?, ?, 1200, 630, NULL, ?)`,
          )
            .bind(assetId, owner, key, sniffed.mime, binary.byteLength, "作品封面", now)
            .run();
          coverUrl = `/api/files/${assetId}`;
        }
      }
    }
  }

  let slug = row.slug;
  if (!slug) {
    const requested = typeof body.slug === "string" ? body.slug.trim().toLowerCase() : "";
    if (/^[a-z0-9][a-z0-9-]{2,39}$/.test(requested) && !(await slugTaken(context.env, requested))) {
      slug = requested;
    } else {
      slug = await uniqueSlug(context.env, title);
    }
  }
  const now = Date.now();
  try {
    await context.env.DB.prepare(
      `UPDATE projects SET data = ?, title = ?, description = ?, cover_url = ?, slug = ?, visibility = 'public', published = 1, rev = rev + 1, updated_at = ?
       WHERE id = ? AND owner_hash = ?`,
    )
      .bind(jsonData, title, description, coverUrl, slug, now, id, owner)
      .run();
    const url = new URL(`/p/${slug}`, context.request.url).toString();
    return json({ slug, url, rev: row.rev + 1, coverUrl });
  } catch (error) {
    console.error("publish failed", error);
    return fail(500, "internal", "发布失败，请稍后重试");
  }
}

export async function onRequestDelete(context: FunctionContext): Promise<Response> {
  const owner = await editorHash(context.request);
  if (!owner) return fail(401, "unauthorized", "缺少有效的编辑器身份");
  const id = idOf(context);
  const row = await findProjectById(context.env, id);
  if (!row || row.owner_hash !== owner) return fail(404, "not_found", "作品不存在或无权操作");
  try {
    await context.env.DB.prepare(
      "UPDATE projects SET published = 0, visibility = 'private', rev = rev + 1, updated_at = ? WHERE id = ? AND owner_hash = ?",
    )
      .bind(Date.now(), id, owner)
      .run();
    return json({ ok: true });
  } catch (error) {
    console.error("unpublish failed", error);
    return fail(500, "internal", "取消发布失败");
  }
}
