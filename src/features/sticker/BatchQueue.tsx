/**
 * Batch queue.
 *
 * One shared implementation with the single-sticker workbench (same processor,
 * same store). The queue itself is the only new thing: durable per-item state in
 * IndexedDB, bounded concurrency, and a real cancel/pause semantic that never
 * interrupts a running tensor operation mid-flight.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, EmptyState, Field, IconButton, Select, Slider, Spinner, Switch, cn, toast } from "../../components/ui";
import { Icon } from "../../components/Icon";
import {
  analyze as analyzeImage,
  compose,
  encode,
  limitSize,
  thumbnail,
  type ProcessProgress,
} from "./processor";
import { decodeToCanvas, downloadBlob, formatBytes } from "./engine/image";
import {
  getSourceBlob,
  getVariantBlob,
  listAllVariants,
  listBatches,
  putBatch,
  putMask,
  putSource,
  putVariant,
} from "./repository";
import { importStickers } from "./bridge";
import {
  CUT_MODES,
  PERSON_COLORS,
  DEFAULT_OUTLINE,
  type BatchItem,
  type BatchJob,
  type CutMode,
  type OutlineSettings,
  type PersonColor,
  type StickerVariant,
} from "./types";

const MAX_WORKERS = 4;
const DEFAULT_CONCURRENCY = 1;
/**
 * Per-image ceiling. Local inference is a few seconds per photo on a GPU and
 * noticeably slower on the software renderer, so this is generous — it exists to
 * stop one hung item from wedging the whole queue, not to enforce a speed goal.
 */
const ITEM_TIMEOUT_MS = 120_000;
/**
 * Batch decode box. A head/bust sticker is downscaled to 1200 px on output anyway,
 * so decoding at the studio full size would burn 2.5x the model compute for pixels
 * that are thrown away. Kept the same for the item thumbnail and the queue preview.
 */
const BATCH_DECODE_MAX_SIDE = 1280;

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2, 10)}`;
}

function emptyJob(settings: BatchJob["settings"]): BatchJob {
  const now = Date.now();
  return {
    id: newId("job"),
    createdAt: now,
    updatedAt: now,
    settings,
    concurrency: DEFAULT_CONCURRENCY,
    items: [],
  };
}

export function BatchQueue() {
  const navigate = useNavigate();
  const [job, setJob] = useState<BatchJob | null>(null);
  const [history, setHistory] = useState<BatchJob[]>([]);
  const [mode, setMode] = useState<CutMode>("head");
  const [outline, setOutline] = useState<OutlineSettings>({ ...DEFAULT_OUTLINE, thickness: 12 });
  const [maxSide, setMaxSide] = useState(1200);
  const [concurrency, setConcurrency] = useState(DEFAULT_CONCURRENCY);
  const [autoSave, setAutoSave] = useState(true);
  const [personColor, setPersonColor] = useState<PersonColor>("original");
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<string>("");
  const [importing, setImporting] = useState(false);

  const pauseRef = useRef(false);
  const cancelRef = useRef(false);
  /**
   * Authoritative job state.
   *
   * `job` (React state) only updates on the next render, so two stage updates in
   * the same tick would both read the previous snapshot and the second would
   * overwrite the first — which is how an item could finish while another stayed
   * stuck on "saving". Every write goes through `persist`, which updates this ref
   * synchronously; the JSX reads `job`, which follows one render later.
   */
  const jobRef = useRef<BatchJob | null>(null);

  const persist = useCallback(async (next: BatchJob) => {
    jobRef.current = next;
    setJob(next);
    await putBatch(next);
  }, []);

  const refreshHistory = useCallback(async () => {
    const list = await listBatches();
    setHistory(list);
  }, []);

  // Restore the most recent job on mount. Without this a reload silently threw
  // away a half-finished fifty-image queue, which is exactly what the plan says
  // must not happen. Items that were mid-flight are marked interrupted.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const list = await listBatches();
      if (!alive) return;
      setHistory(list);
      const latest = list[0];
      if (!latest) return;
      const recovered: BatchJob = {
        ...latest,
        items: latest.items.map((item) =>
          ["decoding", "detecting", "matting", "composing", "saving"].includes(item.stage)
            ? { ...item, stage: "interrupted" as const, error: { code: "unknown" as const, message: "上次处理时页面被关闭，可以重试", retryable: true } }
            : item,
        ),
      };
      setJob(recovered);
      setMode(recovered.settings.mode);
      setOutline(recovered.settings.outline);
      setMaxSide(recovered.settings.maxSide);
      setConcurrency(recovered.concurrency);
      setPersonColor(recovered.settings.personColor ?? "original");
    })();
    return () => {
      alive = false;
    };
  }, []);

  /* --------------------------------------------------------------- enqueue */

  const addFiles = useCallback(
    async (files: FileList | File[] | null) => {
      if (!files) return;
      const images = [...files].filter((file) => file.type.startsWith("image/"));
      if (images.length === 0) {
        toast("没有可处理的图片", "info");
        return;
      }
      const settings: BatchJob["settings"] = { mode, outline, maxSide, format: "png", personColor };
      const base = jobRef.current ?? emptyJob(settings);
      const items: BatchItem[] = [];
      for (const file of images) {
        try {
          const canvas = await decodeToCanvas(file, BATCH_DECODE_MAX_SIDE);
          const source = await putSource({
            name: file.name,
            mime: file.type || "image/png",
            width: canvas.width,
            height: canvas.height,
            blob: file,
          });
          items.push({
            id: newId("itm"),
            sourceId: source.id,
            name: file.name,
            stage: "queued",
            progress: 0,
            attempt: 0,
            variantIds: [],
          });
        } catch (error) {
          items.push({
            id: newId("itm"),
            sourceId: "",
            name: file.name,
            stage: "failed",
            progress: 0,
            attempt: 0,
            variantIds: [],
            error: {
              code: "input-invalid",
              message: error instanceof Error ? error.message : "无法读取图片",
              retryable: false,
            },
          });
        }
      }
      await persist({ ...base, settings, items: [...base.items, ...items] });
      toast(`已加入 ${items.length} 张`, "success");
    },
    [maxSide, mode, outline, persist, personColor],
  );

  /* ------------------------------------------------------------- processing */

  const processItem = useCallback(
    async (item: BatchItem, index: number): Promise<void> => {
      const current = jobRef.current;
      if (!current) return;
      const update = (patch: Partial<BatchItem>) => {
        const base = jobRef.current;
        if (!base) return;
        const items = base.items.map((entry, i) => (i === index ? { ...entry, ...patch } : entry));
        void persist({ ...base, items });
      };
      update({ stage: "decoding", progress: 8, startedAt: Date.now(), error: undefined });

      /**
       * A hung inference (software WebGL, a stuck tensor op, a driver reset) must
       * not freeze the whole queue. The watchdog marks only this item as failed
       * and lets the worker pick up the next one; a genuine result that arrives
       * later finds the item already failed and its `update` is simply ignored.
       */
      let timedOut = false;
      const watchdog = setTimeout(() => {
        timedOut = true;
        update({
          stage: "failed",
          progress: 100,
          finishedAt: Date.now(),
          error: {
            code: "model-load",
            message: "这一张处理超时（可能是浏览器 GPU 太慢），可以重试或换一张",
            retryable: true,
          },
        });
      }, ITEM_TIMEOUT_MS);

      try {
        const blob = await getSourceBlob(item.sourceId);
        if (!blob) throw new Error("原图已不在本机");
        const canvas = await decodeToCanvas(blob, BATCH_DECODE_MAX_SIDE);
        update({ stage: "detecting", progress: 20 });

        const outcome = await analyzeImage(canvas, (event: ProcessProgress) => {
          update({ stage: event.stage === "matting" ? "matting" : "detecting", progress: event.percent });
        });

        const mask = await putMask({
          sourceId: item.sourceId,
          width: canvas.width,
          height: canvas.height,
          algorithm: outcome.matteSource,
          alpha: outcome.alpha,
          coverage: outcome.matteCoverage,
        });

        update({ stage: "composing", progress: 72 });
        const result = compose({
          source: canvas,
          personAlpha: outcome.alpha,
          faces: outcome.faces,
          mode: current.settings.mode,
          faceIndex: 0,
          outline: current.settings.outline,
          feather: 0.6,
          expand: 0,
          edgeSmooth: 0.4,
          personColor: current.settings.personColor,
          colorTint: current.settings.colorTint,
        });

        update({ stage: "saving", progress: 88 });
        const finalCanvas = limitSize(result.canvas, current.settings.maxSide);
        const { blob: encoded, mime } = await encode(finalCanvas, "png");
        const thumb = await thumbnail(finalCanvas, 320);

        // The bytes must exist either way: ZIP export and canvas import both read
        // them. `ephemeral` is what makes the "保存到本机素材" switch real — a
        // temporary render is kept on disk but hidden from the library.
        const variant = await putVariant({
          sourceId: item.sourceId,
          maskId: mask.id,
          kind: "local-cutout",
          name: `${item.name.replace(/\.[^.]+$/, "")} · ${current.settings.mode}`,
          width: finalCanvas.width,
          height: finalCanvas.height,
          mime,
          outline: current.settings.outline,
          mode: current.settings.mode,
          warnings: result.warnings,
          ephemeral: !autoSave,
          blob: encoded,
          thumb,
        });
        const variantId = variant.id;
        if (timedOut) return;
        update({
          stage: "done",
          progress: 100,
          variantIds: variantId ? [variantId] : [],
          finishedAt: Date.now(),
        });
      } catch (error) {
        if (timedOut) return;
        const message = error instanceof Error ? error.message : "处理失败";
        update({
          stage: "failed",
          progress: 100,
          finishedAt: Date.now(),
          error: {
            code: /model|tfjs|tensor/i.test(message) ? "model-load" : "matte-failed",
            message,
            retryable: true,
          },
        });
      } finally {
        clearTimeout(watchdog);
      }
    },
    [autoSave, persist],
  );

  const runQueue = useCallback(async () => {
    const current = jobRef.current;
    if (!current || running) return;
    const queue = current.items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.stage === "queued" || (item.stage === "failed" && item.error?.retryable));
    if (queue.length === 0) {
      toast("没有待处理的任务", "info");
      return;
    }
    cancelRef.current = false;
    pauseRef.current = false;
    setRunning(true);
    setPhase("处理中…");
    const workers = Math.max(1, Math.min(MAX_WORKERS, concurrency));
    let cursor = 0;
    const next = async (): Promise<void> => {
      for (;;) {
        if (cancelRef.current) return;
        // Pausing stops handing out new items; a running tensor op cannot be
        // interrupted, so the UI says "当前项完成后再暂停".
        while (pauseRef.current) {
          setPhase("当前项完成后再暂停…");
          await new Promise((resolve) => setTimeout(resolve, 200));
          if (cancelRef.current) return;
        }
        const index = cursor;
        if (index >= queue.length) return;
        cursor += 1;
        setPhase(`处理中 ${cursor}/${queue.length}`);
        await processItem(queue[index].item, queue[index].index);
      }
    };
    await Promise.all(Array.from({ length: Math.min(workers, queue.length) }, () => next()));
    setRunning(false);
    setPhase(cancelRef.current ? "已取消剩余任务" : "处理完成");
    await refreshHistory();
  }, [concurrency, processItem, refreshHistory, running]);

  /* ------------------------------------------------------------------ stats */

  const stats = useMemo(() => {
    const items = job?.items ?? [];
    return {
      total: items.length,
      queued: items.filter((i) => i.stage === "queued").length,
      working: items.filter((i) => ["decoding", "detecting", "matting", "composing", "saving"].includes(i.stage)).length,
      done: items.filter((i) => i.stage === "done").length,
      failed: items.filter((i) => i.stage === "failed").length,
    };
  }, [job]);

  const doneItems = (job?.items ?? []).filter((item) => item.stage === "done" && item.variantIds.length > 0);

  /* ------------------------------------------------------------------ export */

  const downloadZip = useCallback(async () => {
    if (doneItems.length === 0) return;
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    const folder = zip.folder("stickers") ?? zip;
    const manifest: Record<string, unknown>[] = [];
    const used = new Set<string>();
    for (const item of doneItems) {
      for (const variantId of item.variantIds) {
        const stored = await getVariantBlob(variantId);
        if (!stored) continue;
        const base = item.name.replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 60) || "sticker";
        let name = `${base}.png`;
        let suffix = 2;
        while (used.has(name)) name = `${base}-${suffix++}.png`;
        used.add(name);
        folder.file(name, stored.blob);
        manifest.push({
          source: item.name,
          output: name,
          bytes: stored.blob.size,
          mode: job?.settings.mode,
          outline: job?.settings.outline,
          status: item.stage,
          finishedAt: item.finishedAt,
        });
      }
    }
    const failed = (job?.items ?? []).filter((item) => item.stage === "failed");
    if (failed.length > 0) {
      folder.file(
        "failed.json",
        JSON.stringify(
          failed.map((item) => ({ name: item.name, error: item.error })),
          null,
          2,
        ),
      );
    }
    folder.file("manifest.json", JSON.stringify({ exportedAt: Date.now(), items: manifest }, null, 2));
    const blob = await zip.generateAsync({ type: "blob" });
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    downloadBlob(blob, `meme-stickers-${stamp}.zip`);
    toast(`已导出 ${manifest.length} 张（${formatBytes(blob.size)}）`, "success");
  }, [doneItems, job]);

  const addResultsToStage = useCallback(async () => {
    if (doneItems.length === 0) return;
    setImporting(true);
    try {
      const variants: StickerVariant[] = [];
      const all = await listAllVariants();
      const byId = new Map(all.map((variant) => [variant.id, variant]));
      for (const item of doneItems) {
        for (const id of item.variantIds) {
          const variant = byId.get(id);
          if (variant) variants.push(variant);
        }
      }
      const outcome = await importStickers(variants.map((variant) => ({ variant, asCharacter: false })));
      toast(
        outcome.failed.length > 0
          ? `${outcome.ok.length} 张已加入，${outcome.failed.length} 张失败`
          : `已把 ${outcome.ok.length} 张贴纸加入画布`,
        outcome.failed.length > 0 ? "error" : "success",
      );
      if (outcome.ok.length > 0) navigate("/editor");
    } finally {
      setImporting(false);
    }
  }, [doneItems, navigate]);

  /* -------------------------------------------------------------------- view */

  const sources = useMemo(() => job?.items ?? [], [job]);

  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 py-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl">批量工坊</h1>
          <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-mute">
            一次丢进几十张图，全部在本机抠图。队列状态会写进本机数据库，刷新页面不会从头再来；一张失败不影响其它张。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
          <span className="chip rounded border border-line px-1.5 py-0.5">共 {stats.total}</span>
          {stats.working > 0 ? <span className="chip rounded border border-neon/60 px-1.5 py-0.5 text-neon">{stats.working} 处理中</span> : null}
          <span className="chip rounded border border-line px-1.5 py-0.5 text-mute">{stats.done} 完成</span>
          {stats.failed > 0 ? <span className="chip rounded border border-hot/50 px-1.5 py-0.5 text-hot">{stats.failed} 失败</span> : null}
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-3">
          <label
            className="block cursor-pointer rounded-xl border border-dashed border-line bg-ink-2 px-4 py-5 text-center"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void addFiles(e.dataTransfer.files);
            }}
          >
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = e.target.files;
                e.currentTarget.value = "";
                void addFiles(files);
              }}
            />
            <div className="text-[13px] font-bold text-paper">拖入图片，或点击选择</div>
            <div className="mt-1 text-[10.5px] text-mute">支持多选 · 一次几十张也按队列逐个处理</div>
          </label>

          <div className="flex flex-wrap items-center gap-1.5">
            {running ? (
              <>
                <Button size="sm" variant="secondary" onClick={() => (pauseRef.current = true)}>
                  暂停
                </Button>
                <Button size="sm" variant="ghost" onClick={() => (pauseRef.current = false)}>
                  继续
                </Button>
                <Button size="sm" variant="danger" onClick={() => (cancelRef.current = true)}>
                  取消剩余
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="primary"
                icon="play"
                disabled={stats.queued === 0 && stats.failed === 0}
                onClick={() => void runQueue()}
              >
                开始处理
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              icon="download"
              disabled={doneItems.length === 0}
              onClick={() => void downloadZip()}
            >
              导出 ZIP
            </Button>
            <Button
              size="sm"
              variant="outline"
              icon="image"
              disabled={doneItems.length === 0 || importing}
              onClick={() => void addResultsToStage()}
            >
              加入画布
            </Button>
            {phase ? <span className="text-[10px] text-mute">{phase}</span> : null}
          </div>

          {sources.length === 0 ? (
            <EmptyState
              icon="grid"
              title="队列是空的"
              description="把一批图片拖进上面的框里，选择参数后开始处理。"
            />
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {sources.map((item) => (
                <div key={item.id} className="overflow-hidden rounded-lg border border-line bg-ink-2">
                  <div className="flex aspect-square items-center justify-center bg-ink-3">
                    {item.variantIds.length > 0 ? (
                      <VariantThumb variantId={item.variantIds[0]} name={item.name} />
                    ) : (
                      <span className="text-[10px] text-mute">
                        {item.stage === "failed" ? (
                          <Icon name="close" size={16} className="text-hot" />
                        ) : ["decoding", "detecting", "matting", "composing", "saving"].includes(item.stage) ? (
                          <Spinner size={16} />
                        ) : (
                          "等待"
                        )}
                      </span>
                    )}
                  </div>
                  <div className="p-1.5">
                    <p className="truncate text-[10px]" title={item.name}>
                      {item.name}
                    </p>
                    <p className="text-[9px] text-mute">
                      {item.stage} · {item.progress}%
                    </p>
                    {item.error ? (
                      <p className="mt-0.5 line-clamp-2 text-[9px] text-hot" title={item.error.message}>
                        {item.error.message}
                      </p>
                    ) : null}
                    <div className="mt-1 flex items-center gap-1">
                      {item.stage === "failed" ? (
                        <button
                          type="button"
                          className="flex-1 rounded border border-line px-1 py-0.5 text-[9px] text-mute hover:text-paper"
                          onClick={() => {
                            const current = jobRef.current;
                            if (!current) return;
                            const items = current.items.map((entry) =>
                              entry.id === item.id ? { ...entry, stage: "queued" as const, error: undefined, progress: 0 } : entry,
                            );
                            void persist({ ...current, items });
                          }}
                        >
                          重试
                        </button>
                      ) : null}
                      <IconButton
                        icon="trash"
                        label="移除"
                        size={10}
                        className="ml-auto h-5 w-5 hover:text-hot"
                        onClick={() => {
                          const current = jobRef.current;
                          if (!current) return;
                          void persist({ ...current, items: current.items.filter((entry) => entry.id !== item.id) });
                        }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {history.length > 1 ? (
            <div className="rounded-lg border border-line bg-ink-2 p-2">
              <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-mute">历史任务</div>
              <div className="flex flex-wrap gap-1">
                {history.slice(0, 6).map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setJob(entry)}
                    className="rounded border border-line px-1.5 py-0.5 text-[9.5px] text-mute hover:text-paper"
                  >
                    {new Date(entry.createdAt).toLocaleString("zh-CN")} · {entry.items.length} 张
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <aside className="space-y-2">
          <div className="rounded-xl border border-line bg-ink-2 p-2.5">
            <Field label="裁切模式">
              <Select
                value={mode}
                aria-label="批量裁切模式"
                className="h-7 text-[11px]"
                onChange={(e) => setMode(e.target.value as CutMode)}
              >
                {CUT_MODES.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="描边粗细" hint={`${outline.thickness}px`}>
              <Slider
                value={outline.thickness}
                min={0}
                max={40}
                step={1}
                label={String(outline.thickness)}
                onChange={(thickness) => setOutline((o) => ({ ...o, thickness }))}
              />
            </Field>
            <Field label="人物颜色">
              <div className="grid grid-cols-3 gap-1">
                {PERSON_COLORS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    title={item.hint}
                    onClick={() => setPersonColor(item.id)}
                    className={cn(
                      "rounded border px-1 py-1 text-[9px]",
                      personColor === item.id
                        ? "border-neon/60 bg-neon/15 text-neon"
                        : "border-line text-mute hover:text-paper",
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="输出长边" hint={`${maxSide}px`}>
              <Slider value={maxSide} min={400} max={2000} step={100} label={String(maxSide)} onChange={setMaxSide} />
            </Field>
            <Field label="并发数" hint={`${concurrency}`}>
              <Slider
                value={concurrency}
                min={1}
                max={MAX_WORKERS}
                step={1}
                label={String(concurrency)}
                onChange={setConcurrency}
              />
            </Field>
            <Switch checked={autoSave} onChange={setAutoSave} label="完成后保存到本机素材" />
            <p className="mt-1 text-[9px] leading-relaxed text-mute">
              参数会作为快照写进这一批任务；之后改这里不会影响已经提交的项。
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function VariantThumb({ variantId, name }: { variantId: string; name: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    void getVariantBlob(variantId).then((stored) => {
      if (!alive || !stored) return;
      objectUrl = URL.createObjectURL(stored.thumb);
      setUrl(objectUrl);
    });
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [variantId]);
  return url ? <img src={url} alt={name} className="h-full w-full object-contain" /> : <Spinner size={14} />;
}
