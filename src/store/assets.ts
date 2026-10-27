import { create } from "zustand";
import type { AssetRecord } from "../lib/types";
import { api } from "../lib/api";
import { getEditorKey } from "../lib/ids";

interface AssetState {
  items: AssetRecord[];
  loading: boolean;
  loaded: boolean;
  load: () => Promise<void>;
  add: (asset: AssetRecord) => void;
  remove: (id: string) => Promise<void>;
}

export const useAssets = create<AssetState>((set, get) => ({
  items: [],
  loading: false,
  loaded: false,
  load: async () => {
    if (get().loading) return;
    set({ loading: true });
    try {
      const res = await fetch("/api/assets", {
        headers: { "X-Editor-Key": getEditorKey() },
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { assets: AssetRecord[] };
      set({ items: data.assets, loaded: true });
    } catch {
      set({ loaded: true });
    } finally {
      set({ loading: false });
    }
  },
  add: (asset) => set((s) => ({ items: [asset, ...s.items.filter((a) => a.id !== asset.id)] })),
  remove: async (id) => {
    const res = await fetch(`/api/assets/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { "X-Editor-Key": getEditorKey() },
    });
    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as { message?: string } | null;
      throw new Error(payload?.message ?? "删除失败");
    }
    set((s) => ({ items: s.items.filter((a) => a.id !== id) }));
  },
}));

export async function uploadImagePair(
  full: Blob,
  thumb: Blob,
  name: string,
  width: number,
  height: number,
): Promise<{ url: string; thumbUrl: string; assetId: string; width: number; height: number }> {
  const [fullAsset, thumbAsset] = await Promise.all([
    api.uploadAsset(full, { kind: "image", name, width, height }),
    api.uploadAsset(thumb, { kind: "image", name: `${name} · 缩略图`, width, height }),
  ]);
  return {
    url: fullAsset.url,
    thumbUrl: thumbAsset.url,
    assetId: fullAsset.id,
    width: fullAsset.width ?? width,
    height: fullAsset.height ?? height,
  };
}
