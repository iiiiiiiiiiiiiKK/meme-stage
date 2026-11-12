import { createCanvas, ctx2d } from './image';
import {
  applyMaskToCanvas,
  buildHeadRegionMask,
  dilateMask,
  erodeMask,
  extractAlpha,
  multiplyMasks,
  ovalBounds,
  removeSpecks,
  selectComponent,
  tightenAlpha,
} from './mask';
import { renderOutlined, featherAlpha, type Bounds } from './outline';
import type { CutMode, CutoutOptions, FaceDetection, OutlineSettings } from '../types';

export interface CutoutResult {
  /** Final sticker with outline + shadow, trimmed. */
  canvas: HTMLCanvasElement;
  /** Alpha channel of the trimmed sticker. */
  alpha: Uint8ClampedArray;
  /** Alpha of the subject only (no outline), trimmed. */
  subjectAlpha: Uint8ClampedArray;
  /** Mask at source resolution, before trimming. */
  mask: Uint8ClampedArray;
  /** Bounds in source pixels that were cropped out. */
  bounds: Bounds;
  width: number;
  height: number;
  faceBox: [number, number, number, number] | null;
  warnings: string[];
}

export interface CutoutInput {
  source: HTMLCanvasElement;
  /** Person alpha matte from the local model (source resolution). */
  personAlpha: Uint8ClampedArray;
  faces: FaceDetection[];
  options: CutoutOptions;
}

/**
 * Resolution-independent scale factor.
 *
 * Every "pixel" value in the UI (feather, expand, outline thickness) is expressed
 * at a 200 px face reference size and multiplied by this factor, so a sticker cut
 * from a 4000 px photo looks exactly like one cut from a 500 px photo.
 */
export function referenceScale(faces: FaceDetection[], width: number, height: number, faceIndex = 0): number {
  const face = faces[faceIndex] ?? faces[0];
  const ref = face ? Math.max(face.box[2], face.box[3]) : Math.min(width, height) * 0.25;
  return Math.max(0.35, Math.min(12, ref / 200));
}

function scaledOutline(outline: OutlineSettings, scale: number): OutlineSettings {
  return {
    ...outline,
    thickness: Math.round(outline.thickness * scale),
    secondThickness: Math.round(outline.secondThickness * scale),
    inner: Math.round(outline.inner * scale),
    shadowBlur: Math.round(outline.shadowBlur * scale),
  };
}

/**
 * Builds the alpha mask for the requested cut mode.
 *
 * The rule is always: a neural subject matte defines the silhouette, and the face
 * mesh only decides *which part* of that silhouette survives. Rectangles are
 * never used as a mask.
 */
export function buildCutMask(
  width: number,
  height: number,
  personAlpha: Uint8ClampedArray,
  faces: FaceDetection[],
  options: CutoutOptions,
): {
  mask: Uint8ClampedArray;
  faceBox: [number, number, number, number] | null;
  warning: string | null;
  /** The geometric head region, used as a last-resort fallback. */
  region: Uint8ClampedArray | null;
} {
  const mode: CutMode = options.mode;
  const face = faces[options.faceIndex] ?? faces[0] ?? null;

  if (mode === 'background' || mode === 'full') {
    return { mask: personAlpha.slice(), faceBox: face?.box ?? null, warning: null, region: null };
  }
  if (!face) {
    return {
      mask: personAlpha.slice(),
      faceBox: null,
      warning: 'No face was detected, so the whole person silhouette was kept instead of a head crop.',
      region: null,
    };
  }

  const box = { x: face.box[0], y: face.box[1], width: face.box[2], height: face.box[3] };
  const region = buildHeadRegionMask(width, height, face.oval, box, mode);

  // Region 鈭?real person silhouette.
  let mask = multiplyMasks(personAlpha, region);

  // Keep only the person that owns the chosen face, so a group photo does not
  // leak the other people into the sticker.
  const seed = face.oval.length > 4 ? ovalBounds(face.oval) : null;
  const seedX = seed ? seed.centerX : face.box[0] + face.box[2] / 2;
  const seedY = seed ? seed.bottom - seed.height * 0.25 : face.box[1] + face.box[3] * 0.6;
  const component = selectComponent(mask, width, height, seedX, seedY, 40);
  if (component.found) mask = component.mask;

  return { mask, faceBox: face.box, warning: null, region };
}

export interface RunCutoutExtra {
  /** Extra edge crispness, 0..1. Defaults to 0.55. */
  crispness?: number;
}

export function runCutout(input: CutoutInput): CutoutResult {
  const { source, personAlpha, faces, options } = input;
  const { width, height } = source;
  const warnings: string[] = [];
  const scale = referenceScale(faces, width, height, options.faceIndex);

  const { mask: rawMask, faceBox, warning, region } = buildCutMask(width, height, personAlpha, faces, options);
  if (warning) warnings.push(warning);

  // Translate the UI's pixel values (expressed at a 200 px reference) into the
  // real resolution of this photo.
  const featherPx = options.feather * scale;
  const expandPx = options.expand * scale;
  const smoothPx = options.edgeSmooth * scale;

  let mask = removeSpecks(rawMask, width, height, Math.max(16, Math.round(24 * scale * scale)));
  if (expandPx > 0.01) mask = dilateMask(mask, width, height, expandPx, 1);
  else if (expandPx < -0.01) mask = erodeMask(mask, width, height, -expandPx);
  mask = featherAlpha(mask, width, height, featherPx + smoothPx);

  let subjectCanvas = applyMaskToCanvas(source, mask);
  let subjectAlpha = extractAlpha(subjectCanvas);
  let hasSubject = subjectAlpha.some((a) => a > 8);

  // The neural matte may simply not cover this part of the photo (very small
  // face, heavy crop, unusual lighting). Instead of handing back the untouched
  // photo 鈥?which looks like the cutout silently failed 鈥?fall back to the
  // geometric head region, which still produces a usable sticker.
  if (!hasSubject && region && region.some((a) => a > 8)) {
    mask = featherAlpha(dilateMask(region, width, height, 1, 1), width, height, Math.max(1, 1.5 * scale));
    subjectCanvas = applyMaskToCanvas(source, mask);
    subjectAlpha = extractAlpha(subjectCanvas);
    hasSubject = subjectAlpha.some((a) => a > 8);
    if (hasSubject) {
      warnings.push(
        'The person matte did not cover this region, so the head was cropped with the face mesh only. ' +
          'The edges are approximate 鈥?refine them with the Mask brush if needed.',
      );
    }
  }

  if (!hasSubject) {
    warnings.push('The selected person produced an empty mask. Try another person, another mode, or the Background mode.');
    const fallback = createCanvas(width, height);
    ctx2d(fallback).drawImage(source, 0, 0);
    const fallbackAlpha = extractAlpha(fallback);
    return {
      canvas: fallback,
      alpha: fallbackAlpha,
      subjectAlpha: fallbackAlpha,
      mask,
      bounds: { x: 0, y: 0, width, height },
      width,
      height,
      faceBox,
      warnings,
    };
  }

  const outlined = renderOutlined(subjectCanvas, subjectAlpha, scaledOutline(options.outline, scale), { padding: 2 });

  // `renderOutlined` already cropped to the outline spread and reports the exact
  // offset it used, so the subject alpha is trimmed by the same rectangle.
  const bounds: Bounds = { x: outlined.offsetX, y: outlined.offsetY, width: outlined.width, height: outlined.height };
  const trimmed = outlined.canvas;

  const trimmedSubject = createCanvas(bounds.width, bounds.height);
  const tsctx = ctx2d(trimmedSubject);
  tsctx.drawImage(subjectCanvas, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
  subjectAlpha = extractAlpha(trimmedSubject);

  return {
    canvas: trimmed,
    alpha: extractAlpha(trimmed),
    subjectAlpha,
    mask,
    bounds,
    width: trimmed.width,
    height: trimmed.height,
    faceBox,
    warnings,
  };
}

/** Snapshot of a mask for the UI (white on black). */
export function maskPreviewCanvas(mask: Uint8ClampedArray, width: number, height: number): HTMLCanvasElement {
  const canvas = createCanvas(width, height);
  const ctx = ctx2d(canvas);
  const image = ctx.createImageData(width, height);
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    image.data[p] = image.data[p + 1] = image.data[p + 2] = mask[i];
    image.data[p + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

export { tightenAlpha };
