/**
 * The one and only sticker processing pipeline.
 *
 * Both the single-sticker workbench and the batch queue call these functions, so
 * there is exactly one implementation of decode → detect → matte → compose. The
 * heavy pixel work lives in `./engine/*`, copied unchanged from Meme Studio (it
 * was already correct); this module only adds the orchestration, cancellation
 * checks, progress reporting and the domain records around it.
 */
import { detectAll, getEngine, personAlpha, type ProgressEvent } from "./engine/ai";
import { runCutout, maskPreviewCanvas, type CutoutResult } from "./engine/cutout";
import {
  applyMaskToCanvas,
  extractAlpha,
  removeSpecks,
} from "./engine/mask";
import { canvasToBlob, createCanvas, ctx2d, makeThumbnail } from "./engine/image";
import { DEFAULT_OUTLINE, type CutMode, type FaceDetection, type OutlineSettings, type PersonColor } from "./types";
import { alphaCoverage, growMask, paintMask, smoothMask } from "./maskOps";
import { applyPersonColor } from "./engine/filters";
export { alphaCoverage, growMask, paintMask, smoothMask };

export interface ProcessProgress {
  stage: "decoding" | "detecting" | "matting" | "composing" | "saving";
  message: string;
  /** 0–100; only moves when a real stage advances */
  percent: number;
}

export type ProgressHandler = (progress: ProcessProgress) => void;

export interface DetectOutcome {
  faces: FaceDetection[];
  /** the person alpha plane at the source resolution */
  alpha: Uint8ClampedArray;
  width: number;
  height: number;
  matteCoverage: number;
  matteSource: "selfie" | "rvm" | "fallback";
  warnings: string[];
  elapsedMs: number;
}

export interface ComposeInput {
  source: HTMLCanvasElement;
  personAlpha: Uint8ClampedArray;
  faces: FaceDetection[];
  mode: CutMode;
  faceIndex: number;
  outline: OutlineSettings;
  feather?: number;
  expand?: number;
  edgeSmooth?: number;
  /** local colour treatment; never calls a model */
  personColor?: PersonColor;
  colorTint?: string;
  halftoneSize?: number;
}

export interface ComposeOutcome {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  warnings: string[];
}

/**
 * Turn a decoded canvas into a person matte plus face boxes.
 *
 * This is the only path that loads the local models, so a batch of fifty photos
 * still downloads and warms them once.
 */
export async function analyze(
  canvas: HTMLCanvasElement,
  onProgress?: ProgressHandler,
  signal?: AbortSignal,
): Promise<DetectOutcome> {
  const started = performance.now();
  const warnings: string[] = [];
  const emit = (event: ProgressEvent) => {
    if (event.stage === "detecting") {
      onProgress?.({ stage: "detecting", message: "本地检测人脸…", percent: 20 });
    } else if (event.stage === "matting") {
      onProgress?.({ stage: "matting", message: "本地生成人物蒙版…", percent: 45 });
    } else if (event.stage === "loading") {
      onProgress?.({ stage: "detecting", message: "首次加载本地模型（约 6MB）…", percent: 8 });
    }
  };

  await getEngine(emit);
  if (signal?.aborted) throw new DOMException("已取消", "AbortError");

  const detect = await detectAll(canvas, emit);
  if (signal?.aborted) throw new DOMException("已取消", "AbortError");

  const matte = await personAlpha(canvas, emit);
  if (signal?.aborted) throw new DOMException("已取消", "AbortError");

  if (matte.source === "fallback") {
    warnings.push("本地人物模型没能给出可用蒙版，已退回颜色蒙版；复杂背景请用手动修复。");
  }
  if (matte.note && matte.source !== "fallback") warnings.push(matte.note);
  if (detect.faces.length === 0) warnings.push("没有检测到人脸：只能做「去背 / 整个人」，或用手动修复。");
  if (detect.faces.length > 1) warnings.push(`检测到 ${detect.faces.length} 张人脸，可以在右侧选主体。`);

  const coverage = alphaCoverage(matte.alpha);
  if (coverage < 0.01) warnings.push("蒙版几乎为空，抠图结果会是空白；建议改用手动修复或换一张图。");
  else if (coverage > 0.98) warnings.push("蒙版几乎覆盖整张图，背景可能没被去掉。");

  onProgress?.({ stage: "composing", message: "合成贴纸…", percent: 70 });

  return {
    faces: detect.faces,
    alpha: matte.alpha,
    width: canvas.width,
    height: canvas.height,
    matteCoverage: coverage,
    matteSource: matte.source,
    warnings,
    elapsedMs: Math.round(performance.now() - started),
  };
}

/**
 * Run the cutout + stroke renderer. Pure pixel work, no model calls.
 *
 * Colour treatment happens *before* masking so only the surviving subject is
 * affected: the outline and the alpha edge are computed from the same geometry
 * either way, and switching a filter never re-runs detection.
 */
export function compose(input: ComposeInput): ComposeOutcome {
  const warnings: string[] = [];
  let alpha = input.personAlpha;

  if (input.mode === "background" || input.mode === "full") {
    // whole-person silhouette: clean tiny speckles but keep the real matte
    alpha = removeSpecks(alpha, input.source.width, input.source.height, 24);
  }

  const source =
    input.personColor && input.personColor !== "original"
      ? applyPersonColor(input.source, input.personColor, {
          customTint: input.colorTint,
          halftoneSize: input.halftoneSize,
        })
      : input.source;

  const result: CutoutResult = runCutout({
    source,
    personAlpha: alpha,
    faces: input.faces,
    options: {
      mode: input.mode,
      faceIndex: input.faceIndex,
      feather: input.feather ?? 0.6,
      expand: input.expand ?? 0,
      edgeSmooth: input.edgeSmooth ?? 0.4,
      outline: input.outline,
    },
  });
  warnings.push(...result.warnings);
  return { canvas: result.canvas, width: result.width, height: result.height, warnings };
}

/** Scale a composed sticker down to `maxSide`, never up. */
export function limitSize(canvas: HTMLCanvasElement, maxSide: number): HTMLCanvasElement {
  const longest = Math.max(canvas.width, canvas.height);
  if (!maxSide || longest <= maxSide) return canvas;
  const scale = maxSide / longest;
  const out = createCanvas(Math.max(1, Math.round(canvas.width * scale)), Math.max(1, Math.round(canvas.height * scale)));
  const ctx = ctx2d(out);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(canvas, 0, 0, out.width, out.height);
  return out;
}

export async function encode(
  canvas: HTMLCanvasElement,
  format: "png" | "webp" = "png",
): Promise<{ blob: Blob; mime: "image/png" | "image/webp" }> {
  if (format === "webp") {
    const blob = await canvasToBlob(canvas, "image/webp", 0.94);
    if (blob.type === "image/webp") return { blob, mime: "image/webp" };
  }
  return { blob: await canvasToBlob(canvas, "image/png"), mime: "image/png" };
}

/** Thumbnail with a transparent background preserved. */
export function thumbnail(canvas: HTMLCanvasElement, size = 320): Promise<Blob> {
  return makeThumbnail(canvas, size);
}

/** White-on-black preview of a mask, for the workbench. */
export function maskPreview(mask: Uint8ClampedArray, width: number, height: number): HTMLCanvasElement {
  return maskPreviewCanvas(mask, width, height);
}

export const DEFAULT_CUT_OPTIONS = {
  mode: "head" as CutMode,
  faceIndex: 0,
  feather: 0.6,
  expand: 0,
  edgeSmooth: 0.4,
  outline: DEFAULT_OUTLINE,
};

export type { CutoutResult };
export { applyMaskToCanvas, extractAlpha };
