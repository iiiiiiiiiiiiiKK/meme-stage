/**
 * Local sticker storage.
 *
 * Everything a user has not explicitly published lives here, in IndexedDB:
 * the untouched source image, the alpha matte, rendered variants and the batch
 * queue. Nothing in this module talks to the network — uploading happens in the
 * Stage asset bridge, and only for the variant the user chose to publish.
 */
import { openDB, type IDBPDatabase } from "idb";
import type {
  BatchJob,
  MaskRecord,
  StickerSource,
  StickerVariant,
  StickerVariantKind,
} from "./types";

const DB_NAME = "meme-stage-stickers";
const DB_VERSION = 1;

interface SourceRow extends StickerSource {
  blob: Blob;
}

interface MaskRow extends MaskRecord {
  sourceId: string;
  alpha: Blob;
}

interface VariantRow extends StickerVariant {
  blob: Blob;
  thumb: Blob;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains("sources")) {
          const store = database.createObjectStore("sources", { keyPath: "id" });
          store.createIndex("createdAt", "createdAt");
        }
        if (!database.objectStoreNames.contains("masks")) {
          const store = database.createObjectStore("masks", { keyPath: "id" });
          store.createIndex("sourceId", "sourceId");
        }
        if (!database.objectStoreNames.contains("variants")) {
          const store = database.createObjectStore("variants", { keyPath: "id" });
          store.createIndex("sourceId", "sourceId");
          store.createIndex("createdAt", "createdAt");
        }
        if (!database.objectStoreNames.contains("batches")) {
          database.createObjectStore("batches", { keyPath: "id" });
        }
      },
    });
  }
  return dbPromise;
}

/** Local ids are namespaced so they can never be mistaken for cloud asset ids. */
export function localId(prefix: "src" | "msk" | "stk" | "job" | "itm"): string {
  const random = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${random}`;
}

export function storageAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

/* ------------------------------------------------------------------ sources */

export async function putSource(input: {
  name: string;
  mime: string;
  width: number;
  height: number;
  blob: Blob;
}): Promise<StickerSource> {
  const database = await db();
  const id = localId("src");
  const row: SourceRow = {
    id,
    name: input.name,
    mime: input.mime,
    byteSize: input.blob.size,
    width: input.width,
    height: input.height,
    createdAt: Date.now(),
    hasOriginal: true,
    blob: input.blob,
  };
  await database.put("sources", row);
  return stripBlob(row);
}

function stripBlob(row: SourceRow): StickerSource {
  const { blob: _blob, ...meta } = row;
  return meta;
}

export async function listSources(): Promise<StickerSource[]> {
  const database = await db();
  const rows = (await database.getAll("sources")) as SourceRow[];
  return rows.sort((a, b) => b.createdAt - a.createdAt).map(stripBlob);
}

export async function getSourceBlob(id: string): Promise<Blob | null> {
  const database = await db();
  const row = (await database.get("sources", id)) as SourceRow | undefined;
  return row?.blob ?? null;
}

export async function deleteSource(id: string): Promise<void> {
  const database = await db();
  const masks = (await database.getAllFromIndex("masks", "sourceId", id)) as MaskRow[];
  const variants = (await database.getAllFromIndex("variants", "sourceId", id)) as VariantRow[];
  const tx = database.transaction(["sources", "masks", "variants"], "readwrite");
  await Promise.all([
    tx.objectStore("sources").delete(id),
    ...masks.map((mask) => tx.objectStore("masks").delete(mask.id)),
    ...variants.map((variant) => tx.objectStore("variants").delete(variant.id)),
  ]);
  await tx.done;
}

/* -------------------------------------------------------------------- masks */

export async function putMask(input: {
  sourceId: string;
  width: number;
  height: number;
  algorithm: MaskRecord["algorithm"];
  alpha: Uint8ClampedArray;
  coverage: number;
}): Promise<MaskRecord> {
  const database = await db();
  const id = localId("msk");
  // Store the alpha plane compressed as PNG (single channel expanded to RGBA is
  // still far smaller than raw 4-byte pixels in IndexedDB).
  const canvas = document.createElement("canvas");
  canvas.width = input.width;
  canvas.height = input.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("浏览器不支持 Canvas");
  const image = ctx.createImageData(input.width, input.height);
  for (let i = 0, p = 0; i < input.alpha.length; i++, p += 4) {
    image.data[p] = image.data[p + 1] = image.data[p + 2] = 255;
    image.data[p + 3] = input.alpha[i];
  }
  ctx.putImageData(image, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("蒙版编码失败");
  const row: MaskRow = {
    id,
    sourceId: input.sourceId,
    width: input.width,
    height: input.height,
    algorithm: input.algorithm,
    coverage: input.coverage,
    createdAt: Date.now(),
    alpha: blob,
  };
  await database.put("masks", row);
  const { alpha: _alpha, ...meta } = row;
  return meta;
}

export async function getMaskAlpha(id: string): Promise<Uint8ClampedArray | null> {
  const database = await db();
  const row = (await database.get("masks", id)) as MaskRow | undefined;
  if (!row) return null;
  const bitmap = await createImageBitmap(row.alpha);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = row.width;
    canvas.height = row.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, row.width, row.height).data;
    const alpha = new Uint8ClampedArray(row.width * row.height);
    for (let i = 0, p = 3; i < alpha.length; i++, p += 4) alpha[i] = data[p];
    return alpha;
  } finally {
    bitmap.close();
  }
}

export async function listMasks(sourceId: string): Promise<MaskRecord[]> {
  const database = await db();
  const rows = (await database.getAllFromIndex("masks", "sourceId", sourceId)) as MaskRow[];
  return rows
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(({ alpha: _alpha, ...meta }) => meta);
}

/* ----------------------------------------------------------------- variants */

export async function putVariant(input: {
  sourceId: string;
  maskId: string;
  parentVariantId?: string;
  kind: StickerVariantKind;
  name: string;
  width: number;
  height: number;
  mime: "image/png" | "image/webp";
  outline: StickerVariant["outline"];
  mode: StickerVariant["mode"];
  warnings: string[];
  blob: Blob;
  thumb: Blob;
}): Promise<StickerVariant> {
  const database = await db();
  const row: VariantRow = {
    id: localId("stk"),
    sourceId: input.sourceId,
    maskId: input.maskId,
    parentVariantId: input.parentVariantId,
    kind: input.kind,
    name: input.name,
    width: input.width,
    height: input.height,
    mime: input.mime,
    byteSize: input.blob.size,
    outline: input.outline,
    mode: input.mode,
    warnings: input.warnings,
    createdAt: Date.now(),
    blob: input.blob,
    thumb: input.thumb,
  };
  await database.put("variants", row);
  const { blob: _blob, thumb: _thumb, ...meta } = row;
  return meta;
}

export async function listVariants(): Promise<StickerVariant[]> {
  const database = await db();
  const rows = (await database.getAll("variants")) as VariantRow[];
  return rows.sort((a, b) => b.createdAt - a.createdAt).map(stripVariant);
}

export async function variantsForSource(sourceId: string): Promise<StickerVariant[]> {
  const database = await db();
  const rows = (await database.getAllFromIndex("variants", "sourceId", sourceId)) as VariantRow[];
  return rows.sort((a, b) => b.createdAt - a.createdAt).map(stripVariant);
}

export async function getVariantBlob(id: string): Promise<{ blob: Blob; thumb: Blob } | null> {
  const database = await db();
  const row = (await database.get("variants", id)) as VariantRow | undefined;
  return row ? { blob: row.blob, thumb: row.thumb } : null;
}

export async function markVariantCloud(
  id: string,
  cloud: { cloudAssetId: string; cloudUrl: string },
): Promise<StickerVariant | null> {
  const database = await db();
  const row = (await database.get("variants", id)) as VariantRow | undefined;
  if (!row) return null;
  const next: VariantRow = { ...row, ...cloud };
  await database.put("variants", next);
  return stripVariant(next);
}

export async function deleteVariant(id: string): Promise<void> {
  const database = await db();
  await database.delete("variants", id);
}

function stripVariant(row: VariantRow): StickerVariant {
  const { blob: _blob, thumb: _thumb, ...meta } = row;
  return meta;
}

/* ------------------------------------------------------------------ batches */

export async function putBatch(job: BatchJob): Promise<void> {
  const database = await db();
  await database.put("batches", { ...job, updatedAt: Date.now() });
}

export async function listBatches(): Promise<BatchJob[]> {
  const database = await db();
  const rows = (await database.getAll("batches")) as BatchJob[];
  return rows.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteBatch(id: string): Promise<void> {
  const database = await db();
  await database.delete("batches", id);
}

/* ------------------------------------------------------------------- limits */

export async function storageUsage(): Promise<{ usage: number; quota: number }> {
  if (navigator.storage?.estimate) {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return { usage, quota };
  }
  return { usage: 0, quota: 0 };
}

/** Browsers may silently evict IndexedDB; ask once and record the answer. */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

export async function clearStickerData(): Promise<void> {
  const database = await db();
  const tx = database.transaction(["sources", "masks", "variants", "batches"], "readwrite");
  await Promise.all([
    tx.objectStore("sources").clear(),
    tx.objectStore("masks").clear(),
    tx.objectStore("variants").clear(),
    tx.objectStore("batches").clear(),
  ]);
  await tx.done;
}
