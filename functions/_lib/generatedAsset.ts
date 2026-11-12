/// <reference types="@cloudflare/workers-types" />
/**
 * Store a generated image as a first-class asset.
 *
 * Mirrors the asset upload path (R2 object + D1 row + rollback on failure) so a
 * generated image is indistinguishable from an uploaded one everywhere else in
 * the app — same `/api/files/:id` URL, same delete behaviour, same quota.
 */
import type { Env } from "./http";
import type { AssetRecord } from "../../src/lib/types";

export interface GeneratedAssetInput {
  owner: string;
  bytes: Uint8Array;
  mime: string;
  ext: string;
  name: string;
}

export async function storeGeneratedImage(env: Env, input: GeneratedAssetInput): Promise<AssetRecord> {
  const id = crypto.randomUUID();
  const key = `meme-stage/image/${id}.${input.ext}`;
  const now = Date.now();

  await env.BUCKET.put(key, input.bytes, {
    httpMetadata: {
      contentType: input.mime,
      cacheControl: "public, max-age=31536000, immutable",
    },
  });

  try {
    await env.DB.prepare(
      `INSERT INTO assets (id, owner_hash, kind, object_key, mime, size, name, width, height, duration, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, input.owner, "image", key, input.mime, input.bytes.byteLength, input.name, null, null, null, now)
      .run();
  } catch (error) {
    // D1 and R2 are not transactional: drop the orphan object instead of leaking it.
    await env.BUCKET.delete(key).catch(() => undefined);
    throw error;
  }

  return {
    id,
    kind: "image",
    url: `/api/files/${id}`,
    mime: input.mime,
    size: input.bytes.byteLength,
    name: input.name,
    width: null,
    height: null,
    duration: null,
    createdAt: now,
  } as AssetRecord;
}
