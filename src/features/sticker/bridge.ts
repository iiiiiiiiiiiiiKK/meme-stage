/**
 * Stage asset bridge.
 *
 * The single crossing point between the local sticker studio and the published
 * MEME STAGE canvas. A sticker only reaches R2 when the user clicks "加入作品":
 * that action uploads the chosen variant, then inserts one independent element
 * per sticker. Nothing here silently uploads originals or masks.
 */
import { api } from "../../lib/api";
import { createMedia } from "../../lib/defaults";
import { buildCharacterElement, placeSize } from "../../lib/characters";
import { layoutElements } from "../../lib/layout";
import { useEditor } from "../../store/editor";
import type { CanvasElement } from "../../lib/types";
import { getVariantBlob, markVariantCloud } from "./repository";
import type { StickerImportInput, StickerImportResult, StickerVariant } from "./types";

/**
 * Upload a sticker into the MEME STAGE asset library without touching the canvas.
 *
 * This is the "import the finished sticker" step of the STICKER flow: the bytes end
 * up in R2 as a normal asset, so it shows up in `/assets` and any project can pick
 * it later. Nothing is added to the current project implicitly.
 */
export async function pushVariantToAssets(
  variant: StickerVariant,
): Promise<{ variant: StickerVariant; assetId: string; url: string }> {
  return uploadVariant(variant);
}
async function uploadVariant(
  variant: StickerVariant,
): Promise<{ variant: StickerVariant; assetId: string; url: string }> {
  // Re-uploading an already published sticker would duplicate R2 objects.
  if (variant.cloudAssetId && variant.cloudUrl) {
    return { variant, assetId: variant.cloudAssetId, url: variant.cloudUrl };
  }
  const stored = await getVariantBlob(variant.id);
  if (!stored) throw new Error("本机找不到这个贴纸文件，可能在清理本地缓存时被删除了");
  const asset = await api.uploadAsset(stored.blob, {
    kind: "image",
    name: `${variant.name}.${variant.mime === "image/webp" ? "webp" : "png"}`,
    width: variant.width,
    height: variant.height,
  });
  const next = await markVariantCloud(variant.id, {
    cloudAssetId: asset.id,
    cloudUrl: asset.url,
  });
  return { variant: next ?? variant, assetId: asset.id, url: asset.url };
}

/**
 * Insert the chosen stickers into the current Stage project.
 *
 * Every sticker becomes its own element so it can be moved, scaled and layered
 * independently — never one flattened composite. When several stickers arrive at
 * once they are laid out on a grid inside the canvas instead of stacking.
 */
export async function importStickers(items: StickerImportInput[]): Promise<StickerImportResult> {
  const result: StickerImportResult = { ok: [], failed: [] };
  if (items.length === 0) return result;

  const uploaded: { item: StickerImportInput; url: string; assetId: string; variant: StickerVariant }[] = [];
  for (const item of items) {
    try {
      const up = await uploadVariant(item.variant);
      uploaded.push({ item, url: up.url, assetId: up.assetId, variant: up.variant });
      result.ok.push(up.variant);
    } catch (error) {
      result.failed.push({
        name: item.variant.name,
        message: error instanceof Error ? error.message : "上传失败",
      });
    }
  }
  if (uploaded.length === 0) return result;

  const state = useEditor.getState();
  const project = state.project;
  const names = uploaded.map((entry) => entry.item.name?.trim() || entry.variant.name);

  // Reserve the layout slots once so multi-import never stacks stickers.
  const desired = uploaded.map((entry) =>
    placeSize(project, entry.variant.width, entry.variant.height, uploaded.length > 3 ? 0.18 : 0.26),
  );
  const rects = layoutElements(
    desired,
    { width: project.width, height: project.height },
    {
      mode: uploaded.length > 6 ? "grid" : "scatter",
      baseHeight: Math.round(Math.min(project.height * 0.3, 320)),
      gap: 20,
      seed: Date.now() % 100000,
    },
  );

  const elements: CanvasElement[] = uploaded.map((entry, index) => {
    const rect = rects[index] ?? {
      x: project.width / 2 - desired[index].width / 2,
      y: project.height / 2 - desired[index].height / 2,
      ...desired[index],
    };
    const name = names[index];
    if (entry.item.asCharacter) {
      const el = buildCharacterElement({
        project,
        name,
        imageUrl: entry.url,
        assetId: entry.assetId,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        line: entry.item.line,
      });
      el.x = Math.round(rect.x);
      el.y = Math.round(rect.y);
      return el;
    }
    const el = createMedia({
      url: entry.url,
      name,
      animated: "gif", // placeholder replaced below; see note
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      x: Math.round(rect.x),
      y: Math.round(rect.y),
    });
    // A still sticker is a plain image layer, not an animated one. `createMedia`
    // exists mainly for GIF/MP4 elements, so strip the animated flag here.
    if (el.image) delete el.image.animated;
    el.image!.assetId = entry.assetId;
    return el;
  });

  state.addElements(elements);
  return result;
}

/** Where the bridge should send the user after a successful import. */
export function editorHref(projectId: string | null): string {
  return projectId ? `/editor/${projectId}` : "/editor";
}
