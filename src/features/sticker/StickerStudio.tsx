/**
 * Single sticker workbench.
 *
 * A three-column layout: sources on the left, the preview in the middle and the
 * cutout controls on the right. The important property is that changing an
 * outline or feather re-runs only the compositor — the local models are only
 * touched when the source image or the chosen subject changes.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useEditor } from "../../store/editor";
import { Button, ColorInput, EmptyState, Field, IconButton, Select, Slider, Spinner, Switch, cn, toast } from "../../components/ui";
import { Icon } from "../../components/Icon";
import {
  DEFAULT_CUT_OPTIONS,
  analyze as analyzeImage,
  alphaCoverage,
  compose,
  encode,
  limitSize,
  paintMask,
  smoothMask,
  thumbnail,
  type ProcessProgress,
} from "./processor";
import { createCanvas, ctx2d, decodeToCanvas, downloadBlob, formatBytes, makeThumbnail } from "./engine/image";
import type { AssetRecord } from "../../lib/types";
import {
  clearStickerData,
  deleteVariant,
  getMaskAlpha,
  getSourceBlob,
  getVariantBlob,
  listMasks,
  listSources,
  listVariants,
  putMask,
  putSource,
  putVariant,
  storageUsage,
} from "./repository";
import { importStickers } from "./bridge";
import { AiStylePanel } from "./AiStylePanel";
import { AiGeneratePanel } from "./AiGeneratePanel";
import {
  CUT_MODES,
  DEFAULT_OUTLINE,
  MODE_LABEL,
  type CutMode,
  type FaceDetection,
  type MaskRecord,
  type OutlineSettings,
  type StickerSource,
  type StickerVariant,
} from "./types";

type PreviewTab = "result" | "source" | "mask";
type BrushMode = "erase" | "restore";

interface AnalyzeState {
  status: "idle" | "running" | "ready" | "error";
  message: string;
  percent: number;
  faces: FaceDetection[];
  alpha: Uint8ClampedArray | null;
  maskId: string | null;
  matteCoverage: number;
  matteSource: "selfie" | "rvm" | "fallback" | null;
  warnings: string[];
}

const EMPTY_ANALYZE: AnalyzeState = {
  status: "idle",
  message: "先导入一张图片开始",
  percent: 0,
  faces: [],
  alpha: null,
  maskId: null,
  matteCoverage: 0,
  matteSource: null,
  warnings: [],
};

export function StickerStudio() {
  const navigate = useNavigate();
  const projectId = useEditor((s) => s.projectId);

  const [sources, setSources] = useState<StickerSource[]>([]);
  const [variants, setVariants] = useState<StickerVariant[]>([]);
  const [masks, setMasks] = useState<MaskRecord[]>([]);
  const [activeSource, setActiveSource] = useState<StickerSource | null>(null);
  const [canvasSource, setCanvasSource] = useState<HTMLCanvasElement | null>(null);
  const [analyze, setAnalyze] = useState<AnalyzeState>(EMPTY_ANALYZE);
  const [busyMessage, setBusyMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProcessProgress | null>(null);

  const [mode, setMode] = useState<CutMode>("head");
  const [faceIndex, setFaceIndex] = useState(0);
  const [feather, setFeather] = useState(DEFAULT_CUT_OPTIONS.feather);
  const [expand, setExpand] = useState(DEFAULT_CUT_OPTIONS.expand);
  const [edgeSmooth] = useState(DEFAULT_CUT_OPTIONS.edgeSmooth);
  const [outline, setOutline] = useState<OutlineSettings>({ ...DEFAULT_OUTLINE });
  const [maxSide, setMaxSide] = useState(1200);

  const [preview, setPreview] = useState<PreviewTab>("result");
  const [result, setResult] = useState<{ canvas: HTMLCanvasElement; warnings: string[] } | null>(null);
  const [brushMode, setBrushMode] = useState<BrushMode>("erase");
  const [brushSize, setBrushSize] = useState(28);
  const [brushHardness, setBrushHardness] = useState(0.6);
  const [manualAlpha, setManualAlpha] = useState<Uint8ClampedArray | null>(null);
  const [usage, setUsage] = useState<{ usage: number; quota: number }>({ usage: 0, quota: 0 });
  const [dragging, setDragging] = useState(false);

  const fileRef = useRef<HTMLInputElement | null>(null);
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const painting = useRef(false);

  const effectiveAlpha = manualAlpha ?? analyze.alpha;
  const [latestBlob, setLatestBlob] = useState<Blob | null>(null);

  // Keep the most recent saved sticker around so the AI panel can restyle it.
  useEffect(() => {
    let alive = true;
    const newest = variants[0];
    if (!newest) {
      setLatestBlob(null);
      return;
    }
    void getVariantBlob(newest.id).then((stored) => {
      if (alive) setLatestBlob(stored?.blob ?? null);
    });
    return () => {
      alive = false;
    };
  }, [variants]);

  const refresh = useCallback(async () => {
    const [nextSources, nextVariants, nextUsage] = await Promise.all([
      listSources(),
      listVariants(),
      storageUsage(),
    ]);
    setSources(nextSources);
    setVariants(nextVariants);
    setUsage(nextUsage);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /* ------------------------------------------------------------- importing */

  const loadFile = useCallback(
    async (file: File) => {
      const isImage = file.type.startsWith("image/");
      if (!isImage) {
        toast(`${file.name} 不是图片`, "error");
        return;
      }
      setBusyMessage("读取图片…");
      setProgress({ stage: "decoding", message: "读取图片…", percent: 5 });
      try {
        const canvas = await decodeToCanvas(file, 2048);
        const source = await putSource({
          name: file.name,
          mime: file.type || "image/png",
          width: canvas.width,
          height: canvas.height,
          blob: file,
        });
        setActiveSource(source);
        setCanvasSource(canvas);
        setAnalyze(EMPTY_ANALYZE);
        setManualAlpha(null);
        setResult(null);
        setMasks([]);
        await refresh();
        toast(`已导入 ${file.name}（${canvas.width}×${canvas.height}）`, "success");
      } catch (error) {
        toast(error instanceof Error ? error.message : "读取失败", "error");
      } finally {
        setBusyMessage(null);
        setProgress(null);
      }
    },
    [refresh],
  );

  const openSource = useCallback(async (source: StickerSource) => {
    setBusyMessage("载入原图…");
    try {
      const blob = await getSourceBlob(source.id);
      if (!blob) {
        toast("原图已不在本机（可能清理过浏览器数据）", "error");
        return;
      }
      const canvas = await decodeToCanvas(blob, 2048);
      setActiveSource(source);
      setCanvasSource(canvas);
      setAnalyze(EMPTY_ANALYZE);
      setManualAlpha(null);
      setResult(null);
      setMasks(await listMasks(source.id));
    } catch (error) {
      toast(error instanceof Error ? error.message : "载入失败", "error");
    } finally {
      setBusyMessage(null);
    }
  }, []);

  /* -------------------------------------------------------------- analysis */

  const runAnalysis = useCallback(async () => {
    if (!canvasSource || !activeSource) return;
    setAnalyze((prev) => ({ ...prev, status: "running", message: "本地识别中…", percent: 5 }));
    try {
      const outcome = await analyzeImage(canvasSource, (event) =>
        setAnalyze((prev) => ({ ...prev, message: event.message, percent: event.percent })),
      );
      const mask = await putMask({
        sourceId: activeSource.id,
        width: canvasSource.width,
        height: canvasSource.height,
        algorithm: outcome.matteSource,
        alpha: outcome.alpha,
        coverage: outcome.matteCoverage,
      }).catch(() => null);
      setAnalyze({
        status: "ready",
        message: `识别完成 · ${Math.round(outcome.elapsedMs)}ms · 蒙版覆盖 ${Math.round(outcome.matteCoverage * 100)}%`,
        percent: 100,
        faces: outcome.faces,
        alpha: outcome.alpha,
        maskId: mask?.id ?? null,
        matteCoverage: outcome.matteCoverage,
        matteSource: outcome.matteSource,
        warnings: outcome.warnings,
      });
      setMasks(await listMasks(activeSource.id));
    } catch (error) {
      setAnalyze((prev) => ({
        ...prev,
        status: "error",
        message: error instanceof Error ? error.message : "识别失败",
      }));
    }
  }, [activeSource, canvasSource]);

  /* ------------------------------------------------------------- composing */

  const recompute = useCallback(async () => {
    if (!canvasSource || !effectiveAlpha) return;
    try {
      const outcome = compose({
        source: canvasSource,
        personAlpha: effectiveAlpha,
        faces: analyze.faces,
        mode,
        faceIndex,
        outline,
        feather,
        expand,
        edgeSmooth,
      });
      setResult({ canvas: outcome.canvas, warnings: outcome.warnings });
    } catch (error) {
      toast(error instanceof Error ? error.message : "合成失败", "error");
    }
  }, [analyze.faces, canvasSource, effectiveAlpha, edgeSmooth, expand, faceIndex, feather, mode, outline]);

  useEffect(() => {
    void recompute();
  }, [recompute]);

  /* ---------------------------------------------------------------- preview */

  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas) return;
    const ctx = ctx2d(canvas);
    if (preview === "source" && canvasSource) {
      const width = Math.min(760, canvasSource.width);
      canvas.width = width;
      canvas.height = Math.round((width / canvasSource.width) * canvasSource.height);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(canvasSource, 0, 0, canvas.width, canvas.height);
      return;
    }
    if (preview === "mask" && effectiveAlpha) {
      const w = canvasSource?.width ?? 512;
      const h = canvasSource?.height ?? 512;
      const maskCanvas = createCanvas(w, h);
      const mctx = ctx2d(maskCanvas);
      const image = mctx.createImageData(w, h);
      for (let i = 0, p = 0; i < effectiveAlpha.length; i++, p += 4) {
        image.data[p] = image.data[p + 1] = image.data[p + 2] = effectiveAlpha[i];
        image.data[p + 3] = 255;
      }
      mctx.putImageData(image, 0, 0);
      const width = Math.min(760, w);
      canvas.width = width;
      canvas.height = Math.round((width / w) * h);
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(maskCanvas, 0, 0, canvas.width, canvas.height);
      return;
    }
    if (result) {
      const width = Math.min(760, result.canvas.width);
      canvas.width = width;
      canvas.height = Math.round((width / result.canvas.width) * result.canvas.height);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // checkerboard so transparency is visible on any theme
      const cell = 12;
      for (let y = 0; y < canvas.height; y += cell) {
        for (let x = 0; x < canvas.width; x += cell) {
          ctx.fillStyle = (x / cell + y / cell) % 2 === 0 ? "#1a1d26" : "#22262f";
          ctx.fillRect(x, y, cell, cell);
        }
      }
      ctx.drawImage(result.canvas, 0, 0, canvas.width, canvas.height);
      return;
    }
    canvas.width = 320;
    canvas.height = 320;
    ctx.clearRect(0, 0, 320, 320);
  }, [preview, canvasSource, result, effectiveAlpha]);

  /* ------------------------------------------------------------ mask paint */

  const paintAt = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = previewRef.current;
      if (!canvas || !effectiveAlpha || !canvasSource) return;
      const rect = canvas.getBoundingClientRect();
      const x = ((clientX - rect.left) / rect.width) * canvasSource.width;
      const y = ((clientY - rect.top) / rect.height) * canvasSource.height;
      const scaledRadius = (brushSize / 2) * (canvasSource.width / rect.width);
      setManualAlpha((prev) =>
        paintMask(prev ?? effectiveAlpha, canvasSource.width, canvasSource.height, {
          points: [{ x, y }],
          radius: scaledRadius,
          mode: brushMode,
          hardness: brushHardness,
        }),
      );
    },
    [brushHardness, brushMode, brushSize, canvasSource, effectiveAlpha],
  );

  /* ---------------------------------------------------------------- saving */

  const saveVariant = useCallback(async () => {
    if (!result || !activeSource || !analyze.maskId) {
      toast("先生成蒙版再保存", "info");
      return;
    }
    setBusyMessage("保存贴纸…");
    try {
      const finalCanvas = limitSize(result.canvas, maxSide);
      const { blob, mime } = await encode(finalCanvas, "png");
      const thumb = await thumbnail(finalCanvas, 320);
      const variant = await putVariant({
        sourceId: activeSource.id,
        maskId: analyze.maskId,
        kind: manualAlpha ? "manual-mask" : "local-cutout",
        name: `${activeSource.name.replace(/\.[^.]+$/, "")} · ${MODE_LABEL[mode]}`,
        width: finalCanvas.width,
        height: finalCanvas.height,
        mime,
        outline,
        mode,
        warnings: result.warnings,
        blob,
        thumb,
      });
      await refresh();
      toast(`已保存「${variant.name}」到本机素材`, "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "保存失败", "error");
    } finally {
      setBusyMessage(null);
    }
  }, [activeSource, analyze.maskId, manualAlpha, mode, outline, refresh, result, maxSide]);

  const download = useCallback(async () => {
    if (!result || !activeSource) return;
    const finalCanvas = limitSize(result.canvas, maxSide);
    const { blob, mime } = await encode(finalCanvas, "png");
    const name = `${activeSource.name.replace(/\.[^.]+$/, "")}-${mode}.${mime === "image/webp" ? "webp" : "png"}`;
    downloadBlob(blob, name);
  }, [activeSource, maxSide, mode, result]);

  /* --------------------------------------------------------------- to Stage */

  /**
   * Persist an AI-generated cloud asset as a local variant so it behaves like
   * every other sticker (downloadable, importable, kept as its own version).
   *
   * The original local cutout stays untouched. The parent sticker supplies the
   * source/mask ids, so this still works when the user restored a session without
   * re-opening the original photo.
   */
  const adoptAiAsset = useCallback(
    async (parent: StickerVariant, asset: AssetRecord) => {
      try {
        const response = await fetch(asset.url);
        if (!response.ok) throw new Error("无法读取生成的图片");
        const blob = await response.blob();
        const thumb = await makeThumbnail(blob, 320);
        await putVariant({
          sourceId: parent.sourceId,
          maskId: parent.maskId,
          parentVariantId: parent.id,
          kind: "ai-style",
          name: `${parent.name.slice(0, 24)} · AI`.slice(0, 60),
          width: asset.width ?? 1024,
          height: asset.height ?? 1024,
          mime: blob.type === "image/webp" ? "image/webp" : "image/png",
          outline: parent.outline,
          mode: parent.mode,
          warnings: [],
          blob,
          thumb,
        });
        await refresh();
        toast("已保存为独立版本，原图与本地抠图未被覆盖", "success");
      } catch (error) {
        toast(error instanceof Error ? error.message : "保存 AI 版本失败", "error");
      }
    },
    [refresh],
  );

  const addToStage = useCallback(
    async (targets: StickerVariant[], asCharacter: boolean) => {
      if (targets.length === 0) return;
      setBusyMessage(`正在上传 ${targets.length} 张贴纸…`);
      try {
        const outcome = await importStickers(
          targets.map((variant) => ({ variant, asCharacter })),
        );
        await refresh();
        if (outcome.failed.length > 0) {
          toast(`${outcome.ok.length} 张已加入，${outcome.failed.length} 张失败：${outcome.failed[0].message}`, "error");
        } else {
          toast(`已把 ${outcome.ok.length} 张贴纸加入画布`, "success");
          navigate(projectId ? `/editor/${projectId}` : "/editor");
        }
      } catch (error) {
        toast(error instanceof Error ? error.message : "加入画布失败", "error");
      } finally {
        setBusyMessage(null);
      }
    },
    [navigate, projectId, refresh],
  );

  /* ---------------------------------------------------------------- sidebar */

  const sourceList = useMemo(() => sources.slice(0, 40), [sources]);

  return (
    <div className="flex h-full min-h-0 bg-ink text-paper">
      {/* sources */}
      <aside className="flex w-[220px] shrink-0 flex-col border-r border-line bg-ink-2">
        <div className="flex items-center gap-1 border-b border-line p-2">
          <div className="text-[11px] font-bold uppercase tracking-widest text-mute">本机素材</div>
          <IconButton
            icon="plus"
            label="导入图片"
            className="ml-auto h-6 w-6"
            onClick={() => fileRef.current?.click()}
          />
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.currentTarget.value = "";
            if (file) void loadFile(file);
          }}
        />
        <div
          className="scroll-thin min-h-0 flex-1 overflow-y-auto p-2"
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files?.[0];
            if (file) void loadFile(file);
          }}
        >
          {dragging ? (
            <div className="rounded border border-dashed border-neon/60 p-3 text-center text-[10px] text-neon">
              松手导入
            </div>
          ) : null}
          {sourceList.length === 0 ? (
            <p className="px-1 py-6 text-center text-[10px] leading-relaxed text-mute">
              拖入图片、点 + 导入，
              <br />
              或在右侧画布导入贴纸。
            </p>
          ) : (
            <ul className="space-y-1">
              {sourceList.map((source) => (
                <li key={source.id}>
                  <button
                    type="button"
                    onClick={() => void openSource(source)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded border px-1.5 py-1 text-left text-[10.5px]",
                      activeSource?.id === source.id
                        ? "border-neon/60 bg-neon/10 text-paper"
                        : "border-line/60 bg-ink-3/40 text-mute hover:text-paper",
                    )}
                  >
                    <Icon name="image" size={11} />
                    <span className="min-w-0 flex-1 truncate">{source.name}</span>
                    <span className="shrink-0 text-[9px] tabular-nums">{source.width}×{source.height}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="border-t border-line p-2 text-[9px] leading-relaxed text-mute">
          本机已用 {formatBytes(usage.usage)}
          {usage.quota ? ` / ${formatBytes(usage.quota)}` : ""}
          <button
            type="button"
            className="ml-1 underline decoration-dotted hover:text-hot"
            onClick={async () => {
              await clearStickerData();
              await refresh();
              setActiveSource(null);
              setCanvasSource(null);
              setResult(null);
              setAnalyze(EMPTY_ANALYZE);
              toast("已清空本机贴纸数据", "info");
            }}
          >
            清空
          </button>
        </div>
      </aside>

      {/* preview */}
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-1.5 border-b border-line px-3 py-2">
          <div className="text-[12px] font-bold">{activeSource?.name ?? "贴纸工坊"}</div>
          {activeSource ? (
            <span className="text-[10px] text-mute">
              {canvasSource?.width}×{canvasSource?.height}
            </span>
          ) : null}
          <div className="ml-auto flex items-center gap-1">
            {(["result", "source", "mask"] as PreviewTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setPreview(tab)}
                className={cn(
                  "rounded px-2 py-1 text-[10.5px] font-semibold",
                  preview === tab ? "bg-neon text-ink" : "text-mute hover:text-paper",
                )}
              >
                {tab === "result" ? "结果" : tab === "source" ? "原图" : "蒙版"}
              </button>
            ))}
          </div>
        </div>

        {progress ? (
          <div className="border-b border-line px-3 py-1.5">
            <div className="mb-1 flex items-center gap-1.5 text-[10px] text-mute">
              <Spinner size={10} />
              {progress.message}
              <span className="ml-auto tabular-nums">{progress.percent}%</span>
            </div>
            <div className="h-1 overflow-hidden rounded bg-ink-3">
              <div className="h-full bg-neon transition-all" style={{ width: `${progress.percent}%` }} />
            </div>
          </div>
        ) : null}

        <div className="grid min-h-0 flex-1 place-items-center overflow-auto p-4">
          {!activeSource ? (
            <EmptyState
              icon="image"
              title="还没有图片"
              description="导入一张图片，或用左侧已有素材。所有抠图都在本机完成，不上传原图。"
              action={
                <Button size="sm" icon="upload" onClick={() => fileRef.current?.click()}>
                  选择图片
                </Button>
              }
            />
          ) : (
            <canvas
              ref={previewRef}
              className={cn(
                "max-h-full max-w-full rounded border border-line bg-ink-3",
                preview === "mask" ? "cursor-crosshair" : "",
              )}
              onPointerDown={(e) => {
                if (preview !== "mask") return;
                painting.current = true;
                e.currentTarget.setPointerCapture(e.pointerId);
                paintAt(e.clientX, e.clientY);
              }}
              onPointerMove={(e) => {
                if (preview !== "mask" || !painting.current) return;
                paintAt(e.clientX, e.clientY);
              }}
              onPointerUp={(e) => {
                painting.current = false;
                if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                  e.currentTarget.releasePointerCapture(e.pointerId);
                }
              }}
            />
          )}
        </div>

        {result?.warnings.length ? (
          <div className="border-t border-line px-3 py-1.5 text-[10px] leading-relaxed text-amber-300">
            {result.warnings.slice(0, 2).map((warning) => (
              <div key={warning}>· {warning}</div>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-3 py-2">
          <Button
            size="sm"
            variant="primary"
            icon="sparkles"
            disabled={!activeSource || analyze.status === "running"}
            onClick={() => void runAnalysis()}
          >
            {analyze.status === "running" ? "识别中…" : analyze.alpha ? "重新识别" : "识别主体"}
          </Button>
          <Button size="sm" variant="secondary" icon="check" disabled={!result} onClick={() => void saveVariant()}>
            保存到本机
          </Button>
          <Button size="sm" variant="outline" icon="download" disabled={!result} onClick={() => void download()}>
            下载 PNG
          </Button>
          <div className="ml-auto flex items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              icon="image"
              disabled={variants.length === 0}
              onClick={() => void addToStage(variants.slice(0, 1), false)}
            >
              最新一张加入画布
            </Button>
            <Button
              size="sm"
              variant="primary"
              icon="users"
              disabled={variants.length === 0}
              onClick={() => void addToStage(variants.slice(0, 1), true)}
            >
              作为角色加入
            </Button>
          </div>
        </div>
        {busyMessage ? (
          <div className="border-t border-line px-3 py-1 text-[10px] text-neon">{busyMessage}</div>
        ) : null}
      </main>

      {/* controls */}
      <aside className="scroll-thin w-[280px] shrink-0 space-y-2 overflow-y-auto border-l border-line bg-ink-2 p-2.5">
        <Field label="识别状态">
          <p className="text-[10px] leading-relaxed text-mute">{analyze.message}</p>
          {analyze.alpha ? (
            <p className="text-[9px] text-mute">
              蒙版覆盖 {Math.round(alphaCoverage(analyze.alpha) * 100)}%
              {analyze.matteSource === "fallback" ? " · 颜色蒙版" : ""}
            </p>
          ) : null}
          {analyze.warnings.slice(0, 3).map((warning) => (
            <p key={warning} className="text-[9px] leading-relaxed text-amber-300">
              · {warning}
            </p>
          ))}
        </Field>

        <Field label="裁切模式">
          <Select
            value={mode}
            aria-label="裁切模式"
            onChange={(e) => setMode(e.target.value as CutMode)}
            className="h-7 text-[11px]"
          >
            {CUT_MODES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </Select>
        </Field>

        {analyze.faces.length > 1 ? (
          <Field label={`主体（${analyze.faces.length} 张脸）`}>
            <Select
              value={String(faceIndex)}
              aria-label="主体选择"
              onChange={(e) => setFaceIndex(Number(e.target.value))}
              className="h-7 text-[11px]"
            >
              {analyze.faces.map((face, index) => (
                <option key={index} value={index}>
                  第 {index + 1} 张 · 置信度 {Math.round((face.score ?? 0) * 100)}%
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        <Field label="边缘羽化" hint={feather.toFixed(2)}>
          <Slider value={feather} min={0} max={3} step={0.05} label={feather.toFixed(2)} onChange={setFeather} />
        </Field>
        <Field label="扩张 / 收缩" hint={expand.toFixed(0)}>
          <Slider value={expand} min={-8} max={8} step={1} label={String(expand)} onChange={setExpand} />
        </Field>

        <Field label="描边">
          <div className="space-y-1.5">
            <Switch checked={outline.enabled} onChange={(on) => setOutline((o) => ({ ...o, enabled: on }))} label="启用描边" />
            <div className="flex items-center gap-1.5">
              <ColorInput label="描边颜色" value={outline.color} onChange={(color) => setOutline((o) => ({ ...o, color }))} />
              <input
                type="number"
                min={0}
                max={60}
                value={outline.thickness}
                aria-label="描边粗细"
                onChange={(e) => setOutline((o) => ({ ...o, thickness: Number(e.target.value) || 0 }))}
                className="h-7 w-14 rounded border border-line bg-ink px-1 text-[11px] tabular-nums"
              />
              <span className="text-[9px] text-mute">px</span>
            </div>
            <Switch
              checked={outline.layers === 2}
              onChange={(on) => setOutline((o) => ({ ...o, layers: on ? 2 : 1 }))}
              label="双层描边"
            />
            {outline.layers === 2 ? (
              <div className="flex items-center gap-1.5">
                <ColorInput
                  label="外层颜色"
                  value={outline.secondColor}
                  onChange={(secondColor) => setOutline((o) => ({ ...o, secondColor }))}
                />
                <input
                  type="number"
                  min={0}
                  max={40}
                  value={outline.secondThickness}
                  aria-label="外层描边粗细"
                  onChange={(e) =>
                    setOutline((o) => ({ ...o, secondThickness: Number(e.target.value) || 0 }))
                  }
                  className="h-7 w-14 rounded border border-line bg-ink px-1 text-[11px] tabular-nums"
                />
              </div>
            ) : null}
          </div>
        </Field>

        <Field label="输出长边" hint={`${maxSide}px`}>
          <Slider value={maxSide} min={400} max={2000} step={100} label={String(maxSide)} onChange={setMaxSide} />
        </Field>

        {preview === "mask" ? (
          <Field label="蒙版修复">
            <div className="space-y-1.5">
              <div className="flex gap-1">
                {(["erase", "restore"] as BrushMode[]).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setBrushMode(item)}
                    className={cn(
                      "flex-1 rounded border px-1 py-1 text-[10px]",
                      brushMode === item ? "border-neon/60 bg-neon/15 text-neon" : "border-line text-mute",
                    )}
                  >
                    {item === "erase" ? "擦除" : "恢复"}
                  </button>
                ))}
              </div>
              <Slider
                value={brushSize}
                min={4}
                max={120}
                step={2}
                label={`${brushSize}`}
                onChange={setBrushSize}
              />
              <Slider
                value={brushHardness}
                min={0}
                max={1}
                step={0.05}
                label={brushHardness.toFixed(2)}
                onChange={setBrushHardness}
              />
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="flex-1"
                  onClick={() => {
                    if (!manualAlpha) return;
                    setManualAlpha(smoothMask(manualAlpha, canvasSource?.width ?? 1, canvasSource?.height ?? 1, 1));
                  }}
                >
                  平滑
                </Button>
                <Button size="sm" variant="ghost" className="flex-1" onClick={() => setManualAlpha(null)}>
                  还原
                </Button>
              </div>
            </div>
          </Field>
        ) : null}

        <Field label="从文字生成">
          <AiGeneratePanel
            onSaved={() => {
              void refresh();
            }}
          />
        </Field>

        {variants.length > 0 ? (
          <Field label="AI 风格版">
            <AiStylePanel
              variantId={variants[0].id}
              variantName={variants[0].name}
              sourceBlob={latestBlob}
              onResult={(asset) => void adoptAiAsset(variants[0], asset)}
            />
          </Field>
        ) : null}

        <Field label={`已保存贴纸（${variants.length}）`}>
          <div className="space-y-1">
            {variants.slice(0, 8).map((variant) => (
              <div key={variant.id} className="flex items-center gap-1 rounded border border-line/60 bg-ink px-1.5 py-1">
                <span className="min-w-0 flex-1 truncate text-[10px]">{variant.name}</span>
                <span className="text-[9px] text-mute">
                  {variant.width}×{variant.height}
                </span>
                <IconButton
                  icon="download"
                  label="下载"
                  size={11}
                  className="h-5 w-5"
                  onClick={async () => {
                    const stored = await getVariantBlob(variant.id);
                    if (stored) downloadBlob(stored.blob, `${variant.name}.png`);
                  }}
                />
                <IconButton
                  icon="trash"
                  label="删除"
                  size={11}
                  className="h-5 w-5 hover:text-hot"
                  onClick={async () => {
                    await deleteVariant(variant.id);
                    await refresh();
                  }}
                />
              </div>
            ))}
            {variants.length === 0 ? <p className="text-[9px] text-mute">还没有保存过贴纸。</p> : null}
          </div>
        </Field>

        {masks.length > 1 ? (
          <Field label={`蒙版历史（${masks.length}）`}>
            <div className="flex flex-wrap gap-1">
              {masks.slice(0, 6).map((mask) => (
                <button
                  key={mask.id}
                  type="button"
                  onClick={async () => {
                    const alpha = await getMaskAlpha(mask.id);
                    if (alpha) {
                      setManualAlpha(null);
                      setAnalyze((prev) => ({ ...prev, alpha, maskId: mask.id }));
                      toast("已切换到该蒙版版本", "info");
                    }
                  }}
                  className="rounded border border-line px-1.5 py-0.5 text-[9px] text-mute hover:text-paper"
                >
                  {mask.algorithm}
                </button>
              ))}
            </div>
          </Field>
        ) : null}
      </aside>
    </div>
  );
}
