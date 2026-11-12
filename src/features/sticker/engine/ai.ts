import type { CutMode, FaceDetection } from '../types';

export type { FaceDetection };

/**
 * Local AI engine.
 *
 * Everything here runs inside the browser: the face detector (BlazeFace),
 * the face landmark mesh (FaceMesh) and the person matte (RVM) are TensorFlow.js
 * graphs that are served from `public/models`, so no API key and no network
 * upload is involved. Nothing in this file talks to a third-party service.
 */

export type EngineStage = 'idle' | 'loading' | 'detecting' | 'matting' | 'ready' | 'error';

export interface ProgressEvent {
  stage: EngineStage;
  message: string;
  progress?: number;
}


/** Internal shape that is compatible with @vladmandic/human but kept structural. */
interface HumanFaceLike {
  box: number[];
  boxRaw?: number[];
  score?: number;
  mesh: number[][];
  annotations?: Record<string, number[][]>;
}

interface HumanResultLike {
  face: HumanFaceLike[];
}

interface HumanTensorLike {
  shape: number[];
  data(): Promise<Float32Array | Int32Array | Uint8Array>;
  /** TensorFlow.js tensors hold GPU/WASM memory; callers own the result. */
  dispose?(): void;
}

interface HumanInstance {
  load(config?: unknown): Promise<void>;
  detect(input: HTMLCanvasElement | HTMLImageElement, config?: unknown): Promise<HumanResultLike>;
  segmentation(input: HTMLCanvasElement | HTMLImageElement, config?: unknown): Promise<HumanTensorLike | null>;
  image(input: HTMLCanvasElement | HTMLImageElement, config?: unknown): Promise<unknown>;
  tf: {
    backend(): string;
    setBackend(name: string): Promise<boolean>;
    ready(): Promise<void>;
    getBackend(): string;
  };
  env: { initial: boolean };
  models: { reset(): void };
  /** Last processed input (human keeps the tensor it actually fed the graph). */
  process?: { tensor?: { shape: number[] } };
  config: Record<string, unknown>;
  result?: unknown;
  dispose?(): void;
}

/**
 * Where the model files live.
 *
 * `document.baseURI` is the URL of the *page*, which for a client-side route such
 * as `/studio/sticker` is `/studio/sticker` — resolving `models/` against it
 * would request `/studio/models/…` and 404. The bundle base is the right anchor:
 * it is `/` on a root deployment and `/some-sub-path/` when the app is hosted
 * under a path.
 */
const MODEL_BASE = new URL(
  `${import.meta.env.BASE_URL.replace(/\/?$/, "/")}models/`,
  window.location.origin,
).href;

let instancePromise: Promise<HumanInstance> | null = null;
let engineInfo: { backend: string; segModel: string } | null = null;

const HUMAN_CONFIG = {
  modelBasePath: MODEL_BASE,
  cacheModels: true,
  debug: false,
  backend: 'webgl',
  filter: { enabled: true, flip: false, equalization: false },
  face: {
    enabled: true,
    detector: {
      modelPath: 'blazeface.json',
      maxDetected: 20,
      minConfidence: 0.25,
      iouThreshold: 0.4,
      rotation: false,
      return: false,
    },
    mesh: { enabled: true, modelPath: 'facemesh.json' },
    iris: { enabled: false },
    emotion: { enabled: false },
    description: { enabled: false },
    antispoof: { enabled: false },
    liveness: { enabled: false },
    attention: { enabled: false },
    gear: { enabled: false },
    mobilefacenet: { enabled: false },
  },
  body: { enabled: false },
  hand: { enabled: false },
  object: { enabled: false },
  segmentation: {
    enabled: true,
    // MediaPipe Selfie Segmentation: 213 KB, trained on people, ~0.6 s on a
    // 1280 px photo. RVM is still shipped in `public/models` but its
    // TensorFlow.js graph returns an empty alpha for still images, so it is not
    // the default (see docs/ARCHITECTURE.md).
    modelPath: 'selfie.json',
    ratio: 0.5,
    mode: 'alpha',
  },
};

function emit(onProgress: ((e: ProgressEvent) => void) | undefined, e: ProgressEvent): void {
  onProgress?.(e);
}

export async function getEngine(onProgress?: (e: ProgressEvent) => void): Promise<HumanInstance> {
  if (instancePromise) {
    const existing = await instancePromise;
    return existing;
  }
  instancePromise = (async () => {
    emit(onProgress, { stage: 'loading', message: 'Loading local models (FaceMesh + RVM)…' });
    const mod = await import('@vladmandic/human');
    const HumanCtor = (mod as any).default ?? (mod as any).Human;
    if (!HumanCtor) throw new Error('Could not find Human constructor in @vladmandic/human.');
    const human = new HumanCtor(HUMAN_CONFIG);
    // Prefer WebGL for speed; the WASM backend is the fallback when WebGL fails.
    try {
      await human.tf.setBackend('webgl');
      await human.tf.ready();
    } catch {
      await human.tf.setBackend('wasm');
      await human.tf.ready();
    }
    await human.load(HUMAN_CONFIG);
    engineInfo = {
      backend: human.tf.getBackend?.() ?? human.tf.backend(),
      segModel: 'MediaPipe Selfie Segmentation · 213 KB · Apache-2.0',
    };
    emit(onProgress, { stage: 'ready', message: `Engine ready · ${engineInfo.backend}` });
    return human;
  })().catch((error: unknown) => {
    instancePromise = null;
    const message = error instanceof Error ? error.message : String(error);
    emit(onProgress, { stage: 'error', message });
    throw new Error(`Local AI engine failed to start: ${message}`);
  });
  return instancePromise;
}

export function getEngineInfo(): { backend: string; segModel: string } | null {
  return engineInfo;
}

export function resetEngine(): void {
  instancePromise = null;
  engineInfo = null;
}

export function detectFaces(human: HumanInstance, canvas: HTMLCanvasElement): FaceDetection[] {
  const { width, height } = canvas;
  return (human.result as HumanResultLike | undefined)?.face
    ? ((human.result as HumanResultLike).face || []).map((face, index) => toDetection(face, index, width, height))
    : [];
}

/** MediaPipe FaceMesh face-contour landmark indices (the face oval). */
export const FACE_OVAL_INDICES = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150,
  136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
];

/** Landmark indices that describe the head silhouette used for the crop. */
export const FACE_LANDMARKS = {
  chin: 152,
  forehead: 10,
  leftTemple: 127,
  rightTemple: 356,
  leftCheek: 234,
  rightCheek: 454,
  noseTip: 1,
  leftEyeOuter: 33,
  rightEyeOuter: 263,
};

/**
 * Converts a human face result into pixel coordinates of *our* canvas.
 *
 * human runs the graph on an input tensor that may be a resized copy of the
 * canvas (it caps the long side at 3840 px). `box`, `mesh` and `annotations` are
 * all expressed in that tensor's pixels, so they are scaled back with the ratio
 * between the tensor and the canvas. Annotations are NOT normalised 0..1 — that
 * assumption used to shift the face oval off-canvas.
 */
function toDetection(
  face: HumanFaceLike,
  index: number,
  width: number,
  height: number,
  scaleX = 1,
  scaleY = 1,
): FaceDetection {
  const clamped = (n: number, max: number) => Math.max(0, Math.min(max, n));
  const boxW = Math.max(1, clamped(face.box[2] * scaleX, width));
  const boxH = Math.max(1, clamped(face.box[3] * scaleY, height));
  const mesh = (face.mesh || []).map((p): [number, number] => [p[0] * scaleX, p[1] * scaleY]);

  // human exposes the face contour as `annotations.silhouette`; some builds use
  // `faceOval`. Prefer whichever exists, otherwise derive it from the mesh.
  const contourRaw = face.annotations?.silhouette ?? face.annotations?.faceOval;
  let oval: Array<[number, number]> = [];
  if (contourRaw && contourRaw.length > 4) {
    oval = contourRaw.map((p): [number, number] => [p[0] * scaleX, p[1] * scaleY]);
  } else if (mesh.length > 400) {
    oval = FACE_OVAL_INDICES.map((i) => mesh[i]).filter(Boolean) as Array<[number, number]>;
  }

  return {
    index,
    box: [clamped(face.box[0] * scaleX, width), clamped(face.box[1] * scaleY, height), boxW, boxH],
    score: face.score ?? 0,
    mesh,
    oval,
  };
}

export interface DetectOutcome {
  faces: FaceDetection[];
  elapsedMs: number;
  backend: string;
}

export async function detectAll(
  canvas: HTMLCanvasElement,
  onProgress?: (e: ProgressEvent) => void,
): Promise<DetectOutcome> {
  const human = await getEngine(onProgress);
  emit(onProgress, { stage: 'detecting', message: 'Detecting faces locally…' });
  const started = performance.now();
  const result = (await human.detect(canvas, {
    face: { enabled: true, detector: { maxDetected: 20 }, mesh: { enabled: true } },
    body: { enabled: false },
    hand: { enabled: false },
    object: { enabled: false },
  })) as HumanResultLike;
  const { width, height } = canvas;
  // The graph may have run on a resized copy of the canvas; recover the ratio.
  const inputShape = human.process?.tensor?.shape;
  const scaleX = inputShape && inputShape[2] ? width / inputShape[2] : 1;
  const scaleY = inputShape && inputShape[1] ? height / inputShape[1] : 1;
  const faces = (result.face || []).map((face, index) => toDetection(face, index, width, height, scaleX, scaleY));
  return {
    faces,
    elapsedMs: Math.round(performance.now() - started),
    backend: (human.tf.getBackend?.() ?? human.tf.backend()) || 'webgl',
  };
}
export interface MatteOutcome {
  alpha: Uint8ClampedArray;
  width: number;
  height: number;
  source: 'selfie' | 'rvm' | 'fallback';
  elapsedMs: number;
  note?: string;
  /** Diagnostics for the raw matte tensor (shape + alpha statistics). */
  raw?: { shape: number[]; min: number; max: number; mean: number; alphaIndex: number };
}

/**
 * Person alpha matte. Returns alpha at the exact canvas resolution so it can be
 * intersected with a head region without resampling artefacts.
 *
 * RVM returns an RGBA tensor of shape `[1, H', W', 4]` where `H'`/`W'` are the
 * *matte* resolution (the network decodes at 1/4 of its input). The alpha lives
 * in channel 3. The values are therefore read at the matte resolution and
 * resampled (bilinearly) to the canvas resolution.
 */
export async function personAlpha(
  canvas: HTMLCanvasElement,
  onProgress?: (e: ProgressEvent) => void,
  model: 'selfie' | 'rvm' = 'selfie',
): Promise<MatteOutcome> {
  const human = await getEngine(onProgress);
  emit(onProgress, { stage: 'matting', message: 'Segmenting the person…' });
  const started = performance.now();
  let tensor: HumanTensorLike | null = null;
  try {
    tensor = await human.segmentation(canvas, { segmentation: { enabled: true, modelPath: `${model}.json`, ratio: 0.5, mode: 'alpha' } });
    if (!tensor) throw new Error('The segmentation model returned no result.');
    const shape = tensor.shape as number[];
    // `alpha` mode returns `[H, W, C]`; the default mode returns `[1, H, W, 4]`.
    const [matteH, matteW, channels] =
      shape.length === 4
        ? [shape[1], shape[2], shape[3]]
        : shape.length === 3
          ? [shape[0], shape[1], shape[2]]
          : (() => {
              throw new Error(`Unexpected matte tensor shape: ${shape.join('×')}`);
            })();
    const raw = await tensor.data();
    if (raw.length < matteH * matteW) {
      throw new Error(`Unexpected matte payload size: ${raw.length} for ${matteH}×${matteW}.`);
    }
    const alphaIndex = channels - 1;
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    for (let i = alphaIndex; i < raw.length; i += channels) {
      const v = raw[i];
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
    }
    if (max < 8) {
      throw new Error(
        `The ${model} matte came back empty (max ${Math.round(max)}), so this image would not be cut. ` +
          'A colour matte is used instead.',
      );
    }
    const alpha = resampleAlpha(raw, matteW, matteH, channels, canvas.width, canvas.height);
    return {
      alpha,
      width: canvas.width,
      height: canvas.height,
      source: model === 'selfie' ? 'selfie' : 'rvm',
      elapsedMs: Math.round(performance.now() - started),
      note: `matte ${matteW}×${matteH} → ${canvas.width}×${canvas.height}`,
      raw: {
        shape: [...shape],
        min: Math.round(min),
        max: Math.round(max),
        mean: Number((sum / (raw.length / channels)).toFixed(2)),
        alphaIndex,
      },
    };
  } catch (error) {
    const note = error instanceof Error ? error.message : String(error);
    emit(onProgress, { stage: 'matting', message: `Neural matte unavailable — using the colour matte (${note})` });
    const fallback = await import('./matte-fallback');
    return {
      ...fallback.colorMatte(canvas),
      source: 'fallback',
      note,
      elapsedMs: Math.round(performance.now() - started),
    } as MatteOutcome;
  } finally {
    // `human.segmentation()` hands ownership of its output tensor to the caller.
    // Without this the WebGL/WASM allocation survives every cutout and a long
    // batch eventually exhausts GPU memory.
    tensor?.dispose?.();
  }
}

/**
 * Bilinear resample of an alpha plane.
 *
 * `raw` holds `matteW × matteH` pixels with `channels` values each; the alpha
 * is the last channel. Bilinear interpolation keeps the matte edge smooth
 * instead of the stair-stepping a nearest-neighbour copy produces.
 */
export function resampleAlpha(
  raw: Float32Array | Int32Array | Uint8Array,
  matteW: number,
  matteH: number,
  channels: number,
  outW: number,
  outH: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(outW * outH);
  const alphaIndex = channels - 1;
  for (let y = 0; y < outH; y++) {
    // sample position in matte space, aligned on pixel centres
    const sy = ((y + 0.5) * matteH) / outH - 0.5;
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(matteH - 1, y0 + 1);
    const fy = Math.max(0, Math.min(1, sy - y0));
    for (let x = 0; x < outW; x++) {
      const sx = ((x + 0.5) * matteW) / outW - 0.5;
      const x0 = Math.max(0, Math.floor(sx));
      const x1 = Math.min(matteW - 1, x0 + 1);
      const fx = Math.max(0, Math.min(1, sx - x0));
      const v00 = raw[(y0 * matteW + x0) * channels + alphaIndex];
      const v01 = raw[(y0 * matteW + x1) * channels + alphaIndex];
      const v10 = raw[(y1 * matteW + x0) * channels + alphaIndex];
      const v11 = raw[(y1 * matteW + x1) * channels + alphaIndex];
      const top = v00 + (v01 - v00) * fx;
      const bottom = v10 + (v11 - v10) * fx;
      out[y * outW + x] = top + (bottom - top) * fy;
    }
  }
  return out;
}

export function modeUsesFace(mode: CutMode): boolean {
  return mode !== 'background' && mode !== 'full';
}
