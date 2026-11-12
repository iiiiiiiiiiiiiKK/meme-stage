/// <reference types="@cloudflare/workers-types" />
/**
 * Store a generated image as a first-class asset.
 *
 * Mirrors the asset upload path (D1 row + rollback on failure) so a generated image
 * is indistinguishable from an uploaded one everywhere else in the app — same
 * `/api/files/:id` URL, same delete behaviour, same quota.
 *
 * Where the *bytes* go depends on configuration:
 *  - `r2` (default): our own bucket. Same-origin, deletable, counted.
 *  - `imgbb`: an external image host, for operators who would rather not grow the
 *    R2 bucket with throwaway AI output.
 *
 * The normal upload handler enforces a per-file size and a per-owner count; those
 * checks live here too, otherwise AI output would be the one way to store a 20 MiB
 * image or exceed the asset budget.
 */
import type { Env } from "./http";
import { MAX_ASSETS_PER_OWNER, SIZE_LIMITS, imageSize } from "./files";
import { ImageHostError, externalKey, readImageHost, uploadToImgbb } from "./imageHost";
import type { AssetRecord } from "../../src/lib/types";

export interface GeneratedAssetInput {
  owner: string;
  bytes: Uint8Array;
  mime: string;
  ext: string;
  name: string;
}

export class GeneratedAssetError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Same ceiling as an uploaded image, so the library stays consistent. */
export const MAX_GENERATED_IMAGE_BYTES = SIZE_LIMITS.image;

export async function storeGeneratedImage(env: Env, input: GeneratedAssetInput): Promise<AssetRecord> {
  if (input.bytes.byteLength === 0) {
    throw new GeneratedAssetError(502, "result_empty", "生成的图片是空的");
  }
  if (input.bytes.byteLength > MAX_GENERATED_IMAGE_BYTES) {
    throw new GeneratedAssetError(
      413,
      "result_too_large",
      `生成的图片超过 ${Math.round(MAX_GENERATED_IMAGE_BYTES / 1024 / 1024)}MB 上限`,
    );
  }

  // Counting is a guard rail: a D1 hiccup must not block the user's paid result,
  // but a real over-quota answer has to be honoured.
  try {
    const countRow = await env.DB.prepare("SELECT COUNT(*) AS n FROM assets WHERE owner_hash = ?")
      .bind(input.owner)
      .first<{ n: number }>();
    if ((countRow?.n ?? 0) >= MAX_ASSETS_PER_OWNER) {
      throw new GeneratedAssetError(413, "quota", "素材数量已达上限，请先删除一些旧素材");
    }
  } catch (error) {
    if (error instanceof GeneratedAssetError) throw error;
  }

  const host = readImageHost(env);
  const id = crypto.randomUUID();
  const now = Date.now();

  // Read the real pixel size from the header so library cards and any aspect-ratio
  // layout get the truth instead of `null`.
  const measured = imageSize(input.bytes);

  let objectKey: string;
  let width: number | null = measured?.width ?? null;
  let height: number | null = measured?.height ?? null;
  // The stored size must describe the bytes that actually live at the URL. imgbb
  // re-encodes uploads (1.1 MB PNG came back as 0.49 MB), so prefer its number.
  let storedBytes = input.bytes.byteLength;

  if (host.kind === "imgbb") {
    try {
      const uploaded = await uploadToImgbb(host, input.bytes, input.name);
      // The URL lives in `object_key` so `/api/files/:id` can redirect to it and
      // delete can still remove the row.
      objectKey = externalKey(uploaded.url);
      width = uploaded.width ?? width;
      height = uploaded.height ?? height;
      storedBytes = uploaded.size ?? storedBytes;
    } catch (error) {
      if (error instanceof ImageHostError) {
        throw new GeneratedAssetError(error.status, error.code, error.message);
      }
      throw error;
    }
  } else {
    objectKey = `meme-stage/image/${id}.${input.ext}`;
    await env.BUCKET.put(objectKey, input.bytes, {
      httpMetadata: {
        contentType: input.mime,
        cacheControl: "public, max-age=31536000, immutable",
      },
    });
  }

  try {
    await env.DB.prepare(
      `INSERT INTO assets (id, owner_hash, kind, object_key, mime, size, name, width, height, duration, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        input.owner,
        "image",
        objectKey,
        input.mime,
        storedBytes,
        input.name,
        width,
        height,
        null,
        now,
      )
      .run();
  } catch (error) {
    // D1 and the object store are not transactional: drop the orphan object instead
    // of leaking it. An external upload cannot be removed (imgbb has no delete API
    // for a plain key), so the row simply never exists and the URL becomes unused.
    if (host.kind === "r2") await env.BUCKET.delete(objectKey).catch(() => undefined);
    throw error;
  }

  return {
    id,
    kind: "image",
    url: `/api/files/${id}`,
    mime: input.mime,
    size: storedBytes,
    name: input.name,
    width,
    height,
    duration: null,
    createdAt: now,
  } as AssetRecord;
}
