/**
 * Pick an image that already lives in the MEME STAGE asset library.
 *
 * Downloads the bytes into this browser and hands back a `File`, so the workshop
 * treats a library image exactly like a dropped one — no separate code path, and the
 * original stays in the library untouched.
 */
import { useEffect, useMemo, useState } from "react";
import { Button, EmptyState, Modal, Spinner, cn, toast } from "../../components/ui";
import { useAssets } from "../../store/assets";

export function AssetPicker({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (file: File) => void;
}) {
  const items = useAssets((s) => s.items);
  const load = useAssets((s) => s.load);
  const loading = useAssets((s) => s.loading);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (open) void load();
  }, [load, open]);

  const images = useMemo(
    () => items.filter((asset) => asset.kind === "image" && asset.mime.startsWith("image/")),
    [items],
  );

  const pick = async (id: string, url: string, name: string, mime: string) => {
    setBusyId(id);
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error("读取素材失败");
      const blob = await response.blob();
      const extension = mime.split("/")[1]?.replace("jpeg", "jpg") ?? "png";
      const filename = name.includes(".") ? name : `${name || "asset"}.${extension}`;
      onPick(new File([blob], filename, { type: blob.type || mime }));
      onClose();
    } catch (error) {
      toast(error instanceof Error ? error.message : "读取素材失败", "error");
    } finally {
      setBusyId(null);
    }
  };

  if (!open) return null;
  return (
    <Modal onClose={onClose} title="从素材库选择" wide>
      {loading && images.length === 0 ? (
        <div className="flex items-center gap-2 py-8 text-[11px] text-mute">
          <Spinner size={13} /> 正在读取素材库…
        </div>
      ) : images.length === 0 ? (
        <EmptyState
          icon="image"
          title="素材库里还没有图片"
          description="先把贴纸「存入素材库」，或者直接从本机导入一张新图。"
          action={
            <Button size="sm" variant="secondary" onClick={onClose}>
              关闭
            </Button>
          }
        />
      ) : (
        <div className="grid max-h-[60vh] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
          {images.map((asset) => (
            <button
              key={asset.id}
              type="button"
              disabled={busyId !== null}
              onClick={() => void pick(asset.id, asset.url, asset.name, asset.mime)}
              className={cn(
                "overflow-hidden rounded border border-line bg-ink-2 text-left transition-colors",
                busyId === asset.id ? "border-neon/60" : "hover:border-paper/40",
              )}
            >
              <div className="checker flex aspect-square items-center justify-center bg-ink-3">
                {busyId === asset.id ? (
                  <Spinner size={14} />
                ) : (
                  <img src={asset.url} alt="" loading="lazy" className="h-full w-full object-contain" />
                )}
              </div>
              <div className="p-1">
                <p className="truncate text-[9.5px]" title={asset.name}>
                  {asset.name}
                </p>
                <p className="text-[8.5px] text-mute">
                  {asset.width && asset.height ? `${asset.width}×${asset.height}` : asset.mime}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
