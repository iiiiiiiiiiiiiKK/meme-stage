import { createCanvas, ctx2d } from './image';
import { dilateMask, erodeMask, blurMask, distanceTransform } from './mask';
import type { OutlineSettings } from '../types';

export interface StrokeLayer {
  /** Paint colour, `#rrggbb`. */
  color: string;
  /** Alpha channel of this stroke layer, same dimensions as the source. */
  alpha: Uint8ClampedArray;
  /** True when the stroke sits inside the subject silhouette. */
  inner: boolean;
}

export function hexToRgba(hex: string, alpha = 255): [number, number, number, number] {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean.padEnd(6, '0');
  const value = Number.parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(value)) return [255, 255, 255, alpha];
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255, alpha];
}

/**
 * Computes the outline layers for an alpha mask.
 *
 * A stroke is derived from the real alpha silhouette: the outermost layer is the
 * dilation, the next layer is painted on top of it, and wherever the layer would
 * overlap the subject the subject's own alpha wins when compositing. This makes
 * the outline follow hair, ears and fingers instead of a bounding box.
 */
export function computeStrokeLayers(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
  settings: OutlineSettings,
): StrokeLayer[] {
  if (!settings.enabled) return [];
  const layers: StrokeLayer[] = [];
  const thickness = Math.max(0, settings.thickness);
  const secondThickness = Math.max(0, settings.secondThickness);
  const thirdThickness = Math.max(0, settings.thirdThickness ?? 0);

  /**
   * Outermost silhouette is painted first, each later layer sits on top of it.
   * Support for three layers keeps the same rule as two: the stack grows outward
   * by adding thicknesses, so a 3-layer sticker reads as white → black → accent.
   */
  if (settings.layers === 3 && thirdThickness > 0) {
    const grown = dilateMask(alpha, width, height, thickness + secondThickness + thirdThickness, 1.4);
    layers.push({ color: settings.thirdColor ?? '#ffffff', alpha: grown, inner: false });
  }
  if ((settings.layers === 2 || settings.layers === 3) && secondThickness > 0) {
    const grown = dilateMask(alpha, width, height, thickness + secondThickness, 1.4);
    layers.push({ color: settings.secondColor, alpha: grown, inner: false });
  }
  if (thickness > 0) {
    const grown = dilateMask(alpha, width, height, thickness, 1.4);
    layers.push({ color: settings.color, alpha: grown, inner: false });
  }
  if (settings.inner > 0) {
    const shrunk = erodeMask(alpha, width, height, settings.inner);
    const ring = new Uint8ClampedArray(alpha.length);
    for (let i = 0; i < alpha.length; i++) ring[i] = Math.max(0, alpha[i] - shrunk[i]);
    layers.push({ color: settings.color, alpha: ring, inner: true });
  }
  return layers;
}

export interface RenderOptions {
  /** Extra transparent padding around the trimmed result, in pixels. */
  padding?: number;
  /** Trim the canvas to the visible bounds. */
  trim?: boolean;
  /** Keep the original canvas size. */
  keepSize?: boolean;
}

export interface OutlinedResult {
  /** Painted, already trimmed canvas. */
  canvas: HTMLCanvasElement;
  /** Source-space rectangle that was cropped out (x/y can be negative because of padding). */
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

/**
 * Paints the stroke layers under the source image and returns a trimmed canvas
 * plus the crop offset, so the caller can trim the subject alpha by exactly the
 * same amount.
 *
 * The result always keeps real alpha (never a flattened checkerboard) so it can
 * be exported as a transparent PNG or used as a canvas layer.
 */
export function renderOutlined(
  source: HTMLCanvasElement,
  alpha: Uint8ClampedArray,
  settings: OutlineSettings,
  options: RenderOptions = {},
): OutlinedResult {
  const { width, height } = source;
  const layers = computeStrokeLayers(alpha, width, height, settings);
  const outerLayers = layers.filter((layer) => !layer.inner);
  const innerLayers = layers.filter((layer) => layer.inner);
  const padding = Math.max(0, options.padding ?? 0);

  // Everything that can paint outside the subject has to be part of the margin:
  // the strokes themselves, the glow blur radius, and the shadow blur plus its
  // downward offset.
  const strokeSpread = Math.max(
    settings.thickness +
      (settings.layers >= 2 ? settings.secondThickness : 0) +
      (settings.layers === 3 ? Math.max(0, settings.thirdThickness ?? 0) : 0),
    settings.inner,
  );
  const glowSpread = settings.enabled && settings.glow ? settings.thickness + 4 + 2 : 0;
  const shadowSpread = settings.enabled && settings.shadow
    ? settings.shadowBlur * 2 + Math.max(2, settings.shadowBlur * 0.35)
    : 0;
  const spread = settings.enabled ? strokeSpread + Math.max(glowSpread, shadowSpread) + padding : padding;

  const bounds =
    settings.enabled || padding > 0
      ? paddedBounds(alpha, width, height, spread)
      : { x: 0, y: 0, width, height };

  const canvas = createCanvas(bounds.width, bounds.height);
  const ctx = ctx2d(canvas);
  const offsetX = -bounds.x;
  const offsetY = -bounds.y;

  // Soft shadow / glow silhouettes are painted using the largest available shape.
  const silhouette = outerLayers.length ? outerLayers[0].alpha : alpha;

  if (settings.enabled && settings.shadow) {
    const shadowCanvas = createCanvas(width, height);
    const sctx = ctx2d(shadowCanvas);
    paintMask(sctx, silhouette, width, height, settings.shadowColor);
    ctx.save();
    ctx.globalAlpha = Math.min(1, Math.max(0, settings.shadowOpacity));
    ctx.filter = `blur(${Math.max(0, settings.shadowBlur)}px)`;
    ctx.drawImage(shadowCanvas, offsetX, offsetY + Math.max(2, settings.shadowBlur * 0.35));
    ctx.restore();
  }
  if (settings.enabled && settings.glow) {
    const glowCanvas = createCanvas(width, height);
    const gctx = ctx2d(glowCanvas);
    paintMask(gctx, silhouette, width, height, settings.glowColor);
    ctx.save();
    ctx.filter = `blur(${Math.max(1, settings.thickness + 4)}px)`;
    ctx.globalAlpha = 0.85;
    ctx.drawImage(glowCanvas, offsetX, offsetY);
    ctx.restore();
  }

  // Outer strokes sit behind the subject.
  for (const layer of outerLayers) {
    const layerCanvas = createCanvas(width, height);
    paintMask(ctx2d(layerCanvas), layer.alpha, width, height, layer.color);
    ctx.drawImage(layerCanvas, offsetX, offsetY);
  }

  // The subject itself is always painted last and is never modified.
  const subject = createCanvas(width, height);
  const subjectCtx = ctx2d(subject);
  subjectCtx.drawImage(source, 0, 0);
  const image = subjectCtx.getImageData(0, 0, width, height);
  for (let i = 0, p = 3; i < alpha.length; i++, p += 4) {
    image.data[p] = (image.data[p] * alpha[i]) / 255;
  }
  subjectCtx.putImageData(image, 0, 0);
  ctx.drawImage(subject, offsetX, offsetY);

  // Inner strokes are painted *on* the subject, clipped to the subject alpha so
  // they can never bleed outside it.
  if (innerLayers.length) {
    const clipCanvas = createCanvas(width, height);
    const clipCtx = ctx2d(clipCanvas);
    paintMask(clipCtx, alpha, width, height, '#ffffff');
    for (const layer of innerLayers) {
      const layerCanvas = createCanvas(width, height);
      const lctx = ctx2d(layerCanvas);
      paintMask(lctx, layer.alpha, width, height, layer.color);
      lctx.globalCompositeOperation = 'destination-in';
      lctx.drawImage(clipCanvas, 0, 0);
      ctx.drawImage(layerCanvas, offsetX, offsetY);
    }
  }

  return { canvas, offsetX: bounds.x, offsetY: bounds.y, width: bounds.width, height: bounds.height };
}

export function paintMask(
  ctx: CanvasRenderingContext2D,
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
  color: string,
): void {
  const [r, g, b] = hexToRgba(color);
  const image = ctx.createImageData(width, height);
  for (let i = 0, p = 0; i < alpha.length; i++, p += 4) {
    image.data[p] = r;
    image.data[p + 1] = g;
    image.data[p + 2] = b;
    image.data[p + 3] = alpha[i];
  }
  ctx.putImageData(image, 0, 0);
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function visibleBounds(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
  padding = 0,
  threshold = 1,
): Bounds {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (alpha[row + x] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0 || maxY < 0) {
    return { x: 0, y: 0, width, height };
  }
  const pad = Math.max(0, Math.round(padding));
  const x0 = Math.max(0, minX - pad);
  const y0 = Math.max(0, minY - pad);
  const x1 = Math.min(width - 1, maxX + pad);
  const y1 = Math.min(height - 1, maxY + pad);
  return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/**
 * Bounds that may extend **outside** the source canvas.
 *
 * The plain `visibleBounds` clamps to the image, which silently crops a stroke,
 * shadow or glow belonging to a subject that touches the edge. Stickers must be
 * able to grow past the original frame, so this variant keeps negative x/y and
 * sizes larger than the source.
 */
export function paddedBounds(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
  padding = 0,
  threshold = 1,
): Bounds {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (alpha[row + x] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0 || maxY < 0) {
    return { x: 0, y: 0, width, height };
  }
  const pad = Math.max(0, Math.round(padding));
  const x0 = minX - pad;
  const y0 = minY - pad;
  const x1 = maxX + pad;
  const y1 = maxY + pad;
  return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/**
 * Softens the mask edge before it is used for a cutout.
 */
export function featherAlpha(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
  feather: number,
): Uint8ClampedArray {
  return feather > 0 ? blurMask(alpha, width, height, feather) : alpha.slice();
}

/** Cheap preview of the outline cost so the UI can warn about heavy strokes. */
export function estimateStrokeCost(alpha: Uint8ClampedArray, width: number, height: number): number {
  const dist = distanceTransform(alpha, width, height);
  let edge = 0;
  for (let i = 0; i < dist.length; i++) if (dist[i] > 0 && dist[i] < 4) edge++;
  return edge / Math.max(1, width * height);
}
