import { useEffect, useMemo, useRef, useState } from "react";
import { useEditor } from "../../store/editor";
import { useAssets, uploadImagePair } from "../../store/assets";
import { Button, Field, Modal, Slider, cn, toast } from "../ui";
import { Icon } from "../Icon";
import { prepareImage, formatBytes } from "../../lib/image";
import { LAYOUT_LABELS, layoutElements, type LayoutMode } from "../../lib/layout";
import { createCharacter, makeBubble } from "../../lib/defaults";
import type { CanvasElement } from "../../lib/types";

interface Item {
  key: string;
  file: File;
  previewUrl: string;
  width: number;
  height: number;
  size: number;
  selected: boolean;
  status: "ready" | "preparing" | "uploading" | "done" | "error";
  error?: string;
  blob?: Blob;
  thumb?: Blob;
}

const ACCENTS = ["#b6ff3c", "#4d7cff", "#ff4d9d", "#ffd93d", "#9b5cff", "#ff8a3d", "#2fbf71"];

export function ImportDialog({ onClose }: { onClose: () => void }) {
  const project = useEditor((s) => s.project);
  const addElements = useEditor((s) => s.addElements);
  const addAsset = useAssets((s) => s.add);
  const [items, setItems] = useState<Item[]>([]);
  const [mode, setMode] = useState<LayoutMode>("grid");
  const [baseHeight, setBaseHeight] = useState(Math.round(Math.min(project.height * 0.32, 380)));
  const [gap, setGap] = useState(24);
  const [columns, setColumns] = useState(4);
  const [overlap, setOverlap] = useState(0.35);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dragRef = useRef(false);
  const urlsRef = useRef<string[]>([]);

  useEffect(() => {
    return () => {
      for (const url of urlsRef.current) URL.revokeObjectURL(url);
    };
  }, []);

  const selectedItems = items.filter((item) => item.selected && item.status !== "done");
  const readyItems = items.filter((item) => item.status === "ready" || item.status === "error");
  const preparing = items.some((item) => item.selected && item.status === "preparing");

  const layoutPreviewSizes = useMemo(
    () => items.filter((i) => i.status !== "done").slice(0, 60).map((i) => ({ width: i.width, height: i.height })),
    [items],
  );

  const previewLayout = useMemo(() => {
    return layoutElements(layoutPreviewSizes, { width: project.width, height: project.height }, {
      mode,
      baseHeight,
      gap,
      columns,
      overlap,
      seed: 7,
    });
  }, [layoutPreviewSizes, project.width, project.height, mode, baseHeight, gap, columns, overlap]);

  const addFiles = async (files: FileList | File[]) => {
    const incoming = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (incoming.length === 0) {
      toast("请选择 JPG / PNG / WebP 图片", "error");
      return;
    }
    const room = Math.max(0, 300 - project.elements.length - items.filter((i) => i.status !== "error").length);
    const accepted = incoming.slice(0, Math.max(0, room));
    if (accepted.length < incoming.length) {
      toast(`画布最多 300 个元素，本次只接收 ${accepted.length} 张`, "info");
    }

    const created: Item[] = accepted.map((file) => ({
      key: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 6)}`,
      file,
      previewUrl: "",
      width: 600,
      height: 800,
      size: file.size,
      selected: true,
      status: "preparing",
    }));
    setItems((prev) => [...prev, ...created]);

    for (let index = 0; index < created.length; index++) {
      const item = created[index];
      try {
        if (item.file.size > 24 * 1024 * 1024) throw new Error("单张图片超过 24MB");
        const prepared = await prepareImage(item.file);
        urlsRef.current.push(prepared.fullUrl, prepared.thumbUrl);
        setItems((prev) =>
          prev.map((entry) =>
            entry.key === item.key
              ? {
                  ...entry,
                  previewUrl: prepared.thumbUrl,
                  width: prepared.width,
                  height: prepared.height,
                  blob: prepared.full,
                  thumb: prepared.thumb,
                  status: "ready",
                }
              : entry,
          ),
        );
      } catch (error) {
        setItems((prev) =>
          prev.map((entry) =>
            entry.key === item.key
              ? {
                  ...entry,
                  status: "error",
                  error: error instanceof Error ? error.message : "无法读取图片",
                }
              : entry,
          ),
        );
      }
    }
  };

  const importSelected = async () => {
    if (preparing) {
      toast("还有图片正在读取，请稍等一下", "info");
      return;
    }
    const targets = items.filter((item) => item.selected && item.status !== "done" && item.blob && item.thumb);
    if (targets.length === 0) {
      toast("先选择要导入的人物", "info");
      return;
    }
    setBusy(true);
    setProgress({ done: 0, total: targets.length });

    const rects = layoutElements(
      targets.map((item) => ({ width: item.width, height: item.height })),
      { width: project.width, height: project.height },
      { mode, baseHeight, gap, columns, overlap, seed: 7 },
    );

    const created: CanvasElement[] = [];
    let failed = 0;

    for (let index = 0; index < targets.length; index++) {
      const item = targets[index];
      setItems((prev) =>
        prev.map((entry) => (entry.key === item.key ? { ...entry, status: "uploading" } : entry)),
      );
      try {
        const uploaded = await uploadImagePair(
          item.blob!,
          item.thumb!,
          item.file.name,
          item.width,
          item.height,
        );
        const rect = rects[index];
        const element = createCharacter({
          name: item.file.name.replace(/\.[^.]+$/, "").slice(0, 18) || `人物 ${index + 1}`,
          imageUrl: uploaded.url,
          thumbUrl: uploaded.thumbUrl,
          assetId: uploaded.assetId,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          x: Math.round(rect.x),
          y: Math.round(rect.y),
        });
        if (element.character) {
          element.character.bubble = { ...makeBubble("comic"), bg: ACCENTS[index % ACCENTS.length] };
        }
        created.push(element);
        addAsset({
          id: uploaded.assetId,
          kind: "image",
          url: uploaded.url,
          mime: "image/webp",
          size: item.file.size,
          name: item.file.name,
          width: item.width,
          height: item.height,
          duration: null,
        });
        setItems((prev) =>
          prev.map((entry) => (entry.key === item.key ? { ...entry, status: "done" } : entry)),
        );
      } catch (error) {
        failed += 1;
        setItems((prev) =>
          prev.map((entry) =>
            entry.key === item.key
              ? {
                  ...entry,
                  status: "error",
                  error: error instanceof Error ? error.message : "上传失败",
                }
              : entry,
          ),
        );
      }
      setProgress({ done: index + 1, total: targets.length });
    }

    setBusy(false);
    if (created.length > 0) {
      addElements(created);
      const state = useEditor.getState();
      if (state.project.title === "未命名作品" || !state.project.title.trim()) {
        state.mutate((draft) => {
          const firstName = created[0].character?.name?.trim();
          draft.title = firstName ? `${firstName} 等 ${created.length} 人` : `${created.length} 个人开始说话`;
        }, false);
      }
      toast(
        failed > 0
          ? `已导入 ${created.length} 个人物，${failed} 张失败`
          : `已导入 ${created.length} 个人物`,
        failed > 0 ? "info" : "success",
      );
      if (failed === 0) onClose();
    } else {
      toast("全部上传失败，请检查网络后重试", "error");
    }
  };

  return (
    <Modal
      title="批量导入人物"
      subtitle="一次选择多张图片，自动排开，不会全部叠在一起"
      onClose={busy ? () => undefined : onClose}
      wide
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-[11px] text-mute">
            {items.length === 0
              ? "支持 JPG / PNG / WebP / GIF，单张 ≤ 24MB"
              : `共 ${items.length} 张 · 已选 ${selectedItems.length} · 完成 ${items.filter((i) => i.status === "done").length}`}
          </div>
          {busy ? (
            <div className="flex items-center gap-2 text-[11px] text-neon">
              <span className="h-1.5 w-24 overflow-hidden rounded-full bg-ink">
                <span
                  className="block h-full bg-neon transition-all"
                  style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }}
                />
              </span>
              {progress.done}/{progress.total}
            </div>
          ) : null}
          <div className="ml-auto flex gap-1.5">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon="upload"
              onClick={() => void importSelected()}
              disabled={busy || preparing || selectedItems.length === 0}
            >
              {busy ? "正在上传…" : preparing ? "正在读取图片…" : `导入 ${selectedItems.length} 个人物`}
            </Button>
          </div>
        </div>
      }
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) void addFiles(e.target.files);
          e.currentTarget.value = "";
        }}
      />

      {items.length === 0 ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            dragRef.current = true;
          }}
          onDragLeave={() => {
            dragRef.current = false;
          }}
          onDrop={(e) => {
            e.preventDefault();
            dragRef.current = false;
            if (e.dataTransfer.files) void addFiles(e.dataTransfer.files);
          }}
          className={cn(
            "grid w-full place-items-center gap-2 rounded-xl border-2 border-dashed border-line bg-ink/60 py-14 text-center transition-colors",
            "hover:border-neon/50 hover:bg-neon/5",
          )}
        >
          <span className="grid h-12 w-12 place-items-center rounded-xl border border-line bg-ink-3 text-neon">
            <Icon name="upload" size={22} />
          </span>
          <span className="font-display text-lg">把 20 张人物拖进来</span>
          <span className="max-w-sm text-[11px] leading-relaxed text-mute">
            或者点击选择文件。每张图会压缩成 WebP，原图不变形；导入后每个人物都能单独拖动、缩放、旋转、配音。
          </span>
        </button>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {items.map((item) => (
              <div
                key={item.key}
                className={cn(
                  "group relative overflow-hidden rounded-lg border bg-ink",
                  item.selected ? "border-neon/60" : "border-line",
                )}
              >
                <button
                  type="button"
                  onClick={() =>
                    setItems((prev) =>
                      prev.map((entry) =>
                        entry.key === item.key ? { ...entry, selected: !entry.selected } : entry,
                      ),
                    )
                  }
                  className="block aspect-square w-full bg-ink-3"
                  aria-label={`${item.selected ? "取消选择" : "选择"} ${item.file.name}`}
                >
                  {item.previewUrl ? (
                    <img src={item.previewUrl} alt="" className="h-full w-full object-contain" />
                  ) : (
                    <span className="grid h-full w-full place-items-center text-[10px] text-mute">
                      {item.status === "error" ? "失败" : "处理中…"}
                    </span>
                  )}
                  <span
                    className={cn(
                      "absolute left-1 top-1 grid h-4 w-4 place-items-center rounded border",
                      item.selected ? "border-neon bg-neon text-ink" : "border-paper/50 bg-ink/70",
                    )}
                  >
                    {item.selected ? <Icon name="check" size={10} /> : null}
                  </span>
                </button>
                <div className="flex items-center justify-between gap-1 px-1 py-1 text-[9px] text-mute">
                  <span className="truncate">{item.file.name}</span>
                  <span className="shrink-0">{formatBytes(item.size)}</span>
                </div>
                {item.status === "uploading" ? (
                  <div className="absolute inset-x-0 bottom-0 h-0.5 bg-line">
                    <div className="h-full w-1/2 animate-pulse bg-neon" />
                  </div>
                ) : null}
                {item.error ? (
                  <div className="absolute inset-x-0 bottom-5 bg-hot/90 px-1 py-0.5 text-[8px] text-ink">
                    {item.error}
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    URL.revokeObjectURL(item.previewUrl);
                    setItems((prev) => prev.filter((entry) => entry.key !== item.key));
                  }}
                  className="absolute right-1 top-1 grid h-4 w-4 place-items-center rounded bg-ink/80 text-mute opacity-0 transition-opacity hover:text-hot group-hover:opacity-100"
                  aria-label="移除"
                >
                  <Icon name="close" size={10} />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="grid aspect-square place-items-center rounded-lg border border-dashed border-line text-mute transition-colors hover:border-neon/50 hover:text-neon"
            >
              <Icon name="plus" size={18} />
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
            <div className="space-y-3 rounded-lg border border-line bg-ink p-3">
              <div className="flex flex-wrap gap-1">
                {LAYOUT_LABELS.map((item) => (
                  <button
                    key={item.mode}
                    type="button"
                    onClick={() => setMode(item.mode)}
                    title={item.hint}
                    className={cn(
                      "rounded-md border px-2 py-1 text-[10.5px] font-semibold transition-colors",
                      mode === item.mode
                        ? "border-neon/60 bg-neon/15 text-neon"
                        : "border-line text-mute hover:text-paper",
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <Field label="人物高度" hint={`${baseHeight}px`}>
                <Slider
                  value={baseHeight}
                  min={90}
                  max={Math.round(project.height * 0.6)}
                  step={10}
                  label={`${baseHeight}`}
                  onChange={setBaseHeight}
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="间距" hint={`${gap}px`}>
                  <Slider value={gap} min={0} max={100} step={2} label={`${gap}`} onChange={setGap} />
                </Field>
                <Field label="列数" hint={mode === "custom" ? `${columns}` : "自动"}>
                  <Slider
                    value={columns}
                    min={1}
                    max={10}
                    step={1}
                    label={`${columns}`}
                    onChange={setColumns}
                  />
                </Field>
              </div>

              {mode === "custom" || mode === "random" ? (
                <Field label="重叠程度" hint={`${Math.round(overlap * 100)}%`}>
                  <Slider value={overlap} min={0} max={1} step={0.05} label={`${Math.round(overlap * 100)}`} onChange={setOverlap} />
                </Field>
              ) : null}

              <div className="flex items-center gap-2 text-[10px] text-mute">
                <button
                  type="button"
                  className="rounded border border-line px-1.5 py-0.5 hover:text-paper"
                  onClick={() => setItems((prev) => prev.map((i) => ({ ...i, selected: true })))}
                >
                  全选
                </button>
                <button
                  type="button"
                  className="rounded border border-line px-1.5 py-0.5 hover:text-paper"
                  onClick={() => setItems((prev) => prev.map((i) => ({ ...i, selected: false })))}
                >
                  取消全选
                </button>
                <span>第一个选中的人会拿最高图层</span>
              </div>
            </div>

            <div className="rounded-lg border border-line bg-ink p-2">
              <div className="mb-1 flex items-center justify-between text-[9px] text-mute">
                <span>布局预览</span>
                <span>
                  {project.width}×{project.height}
                </span>
              </div>
              <div
                className="relative w-full overflow-hidden rounded border border-line/60 bg-ink-3"
                style={{ aspectRatio: `${project.width} / ${project.height}` }}
              >
                {items
                  .filter((i) => i.status !== "done")
                  .slice(0, 60)
                  .map((item, index) => {
                    const rect = previewLayout[index];
                    if (!rect) return null;
                    return (
                      <span
                        key={item.key}
                        className={cn(
                          "absolute rounded-[2px] border",
                          item.selected ? "border-neon/70 bg-neon/20" : "border-mute/40 bg-mute/10",
                        )}
                        style={{
                          left: `${(rect.x / project.width) * 100}%`,
                          top: `${(rect.y / project.height) * 100}%`,
                          width: `${(rect.width / project.width) * 100}%`,
                          height: `${(rect.height / project.height) * 100}%`,
                        }}
                      />
                    );
                  })}
              </div>
              <p className="mt-1.5 text-[9px] leading-relaxed text-mute">
                导入后仍可单独拖动 / 缩放 / 旋转，不会被锁死。
              </p>
            </div>
          </div>

          {readyItems.length === 0 && items.length > 0 ? (
            <div className="rounded-md border border-line px-3 py-2 text-[11px] text-mute">
              所有图片都处理完了。关闭窗口后，已上传的人物会留在画布上。
            </div>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
