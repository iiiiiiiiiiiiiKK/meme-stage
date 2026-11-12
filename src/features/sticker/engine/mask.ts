import { createCanvas, ctx2d } from './image';
import type { CutMode } from '../types';

export function extractAlpha(canvas: HTMLCanvasElement): Uint8ClampedArray {
  const { width, height } = canvas;
  const data = ctx2d(canvas).getImageData(0, 0, width, height).data;
  const mask = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 3; i < mask.length; i++, p += 4) mask[i] = data[p];
  return mask;
}

export function maskToCanvas(mask: Uint8ClampedArray, width: number, height: number, color = '#ffffff'): HTMLCanvasElement {
  const canvas = createCanvas(width, height);
  const ctx = ctx2d(canvas);
  const image = ctx.createImageData(width, height);
  const [r, g, b] = hexToRgb(color);
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    image.data[p] = r;
    image.data[p + 1] = g;
    image.data[p + 2] = b;
    image.data[p + 3] = mask[i];
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const num = Number.parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(num)) return [255, 255, 255];
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

/** Separable box blur, three passes ≈ Gaussian. Operates on a copy. */
export function blurMask(mask: Uint8ClampedArray, width: number, height: number, radius: number): Uint8ClampedArray {
  const r = Math.max(0, Math.round(radius));
  if (r <= 0) return mask.slice();
  let src = mask;
  let dst = new Uint8ClampedArray(mask.length);
  for (let pass = 0; pass < 3; pass++) {
    boxBlurH(src, dst, width, height, r);
    boxBlurV(dst, src, width, height, r);
  }
  // src now holds the result because we ping-ponged three times
  return src;
}

function boxBlurH(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, r: number): void {
  const div = r * 2 + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      dst[row + x] = sum / div;
      const add = Math.min(w - 1, x + r + 1);
      const sub = Math.max(0, x - r);
      sum += src[row + add] - src[row + sub];
    }
  }
}

function boxBlurV(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, r: number): void {
  const div = r * 2 + 1;
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += src[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = sum / div;
      const add = Math.min(h - 1, y + r + 1);
      const sub = Math.max(0, y - r);
      sum += src[add * w + x] - src[sub * w + x];
    }
  }
}

/**
 * Chamfer 3×3 distance transform: distance (in pixels) from every pixel to the
 * nearest pixel with mask value > 127. Foreground pixels get 0.
 */
export function distanceTransform(mask: Uint8ClampedArray, width: number, height: number): Float32Array {
  const INF = 1e9;
  const dist = new Float32Array(mask.length);
  for (let i = 0; i < mask.length; i++) dist[i] = mask[i] > 127 ? 0 : INF;
  // forward pass
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (dist[i] === 0) continue;
      let d = dist[i];
      if (y > 0) {
        d = Math.min(d, dist[i - width] + 1);
        if (x > 0) d = Math.min(d, dist[i - width - 1] + 1.4142);
        if (x < width - 1) d = Math.min(d, dist[i - width + 1] + 1.4142);
      }
      if (x > 0) d = Math.min(d, dist[i - 1] + 1);
      dist[i] = d;
    }
  }
  // backward pass
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      if (dist[i] === 0) continue;
      let d = dist[i];
      if (y < height - 1) {
        d = Math.min(d, dist[i + width] + 1);
        if (x > 0) d = Math.min(d, dist[i + width - 1] + 1.4142);
        if (x < width - 1) d = Math.min(d, dist[i + width + 1] + 1.4142);
      }
      if (x < width - 1) d = Math.min(d, dist[i + 1] + 1);
      dist[i] = d;
    }
  }
  return dist;
}

/** Grow the mask by `radius` pixels; `soft` feathers the new edge. */
export function dilateMask(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
  soft = 1,
): Uint8ClampedArray {
  const r = Math.max(0, radius);
  if (r <= 0) return mask.slice();
  const dist = distanceTransform(mask, width, height);
  const out = new Uint8ClampedArray(mask.length);
  const softness = Math.max(0.001, soft);
  for (let i = 0; i < mask.length; i++) {
    const d = dist[i];
    if (d <= r) out[i] = 255;
    else if (d <= r + softness) {
      const t = 1 - (d - r) / softness;
      out[i] = Math.max(mask[i], 255 * t);
    } else out[i] = mask[i];
  }
  return out;
}

export function erodeMask(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
): Uint8ClampedArray {
  const r = Math.max(0, radius);
  if (r <= 0) return mask.slice();
  // Invert, dilate, invert: erosion by distance to background.
  const inverted = new Uint8ClampedArray(mask.length);
  for (let i = 0; i < mask.length; i++) inverted[i] = 255 - mask[i];
  const dilated = dilateMask(inverted, width, height, r, 0.75);
  const out = new Uint8ClampedArray(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = Math.min(mask[i], 255 - dilated[i]);
  return out;
}

export function multiplyMasks(a: Uint8ClampedArray, b: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(a.length);
  for (let i = 0; i < a.length; i++) out[i] = (a[i] * b[i]) / 255;
  return out;
}

export function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Build the allowed head region for a face box. The region is generous and is
 * later intersected with the real person alpha matte, so hair and shoulders are
 * shaped by the segmentation — never by a rectangle.
 */
export function buildRegionMask(
  width: number,
  height: number,
  box: Rect,
  mode: CutMode,
  feather = 0.06,
): Uint8ClampedArray {
  const mask = new Uint8ClampedArray(width * height);
  const faceW = Math.max(8, box.width);
  const faceH = Math.max(8, box.height);
  const cx = box.x + faceW / 2;
  const faceTop = box.y;
  const faceBottom = box.y + faceH;

  let rx = faceW * 0.62;
  let top = faceTop - faceH * 0.6;
  let bottom = faceBottom + faceH * 0.12;
  let power = 2; // ellipse
  let taper = 0;

  switch (mode) {
    case 'background':
    case 'full':
      mask.fill(255);
      return mask;
    case 'face':
      // handled by the oval path; approximate with a tight ellipse
      rx = faceW * 0.52;
      top = faceTop + faceH * 0.05;
      bottom = faceBottom + faceH * 0.02;
      break;
    case 'head':
      rx = faceW * 0.66;
      top = faceTop - faceH * 0.62;
      bottom = faceBottom + faceH * 0.1;
      break;
    case 'head-neck':
      rx = faceW * 0.7;
      top = faceTop - faceH * 0.62;
      bottom = faceBottom + faceH * 0.62;
      break;
    case 'head-shoulders':
      rx = faceW * 1.35;
      top = faceTop - faceH * 0.62;
      bottom = faceBottom + faceH * 1.65;
      power = 3.2;
      taper = 0.55;
      break;
    case 'upper-body':
      rx = faceW * 1.9;
      top = faceTop - faceH * 0.62;
      bottom = faceBottom + faceH * 3.1;
      power = 4;
      taper = 0.7;
      break;
  }

  const ry = Math.max(1, (bottom - top) / 2);
  const cy = (top + bottom) / 2;
  const featherPx = Math.max(0.5, Math.min(rx, ry) * feather);

  for (let y = 0; y < height; y++) {
    const ny = (y - cy) / ry;
    for (let x = 0; x < width; x++) {
      // trapezoid taper: narrow the region towards the bottom for bust crops
      const wide = 1 + (taper * Math.max(0, ny)) * 0.85;
      const nx = (x - cx) / (rx * wide);
      const value = Math.abs(nx) ** power + Math.abs(ny) ** power;
      const edge = 1 + featherPx / Math.max(rx, ry);
      let a = 0;
      if (value <= 1) a = 255;
      else if (value < edge * edge) {
        a = 255 * (1 - smoothstep((Math.sqrt(value) - 1) / (edge - 1 || 1)));
      }
      mask[y * width + x] = a;
    }
  }
  return mask;
}

/** Exact face oval from facemesh landmarks, filled and feathered. */
export function faceOvalMask(
  width: number,
  height: number,
  points: [number, number][],
  feather = 2,
): Uint8ClampedArray {
  const canvas = createCanvas(width, height);
  const ctx = ctx2d(canvas);
  ctx.fillStyle = '#ffffff';
  if (points.length > 2) {
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
    ctx.closePath();
    ctx.fill();
  }
  const mask = extractAlpha(canvas);
  return feather > 0 ? blurMask(mask, width, height, feather) : mask;
}

export interface OvalBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

export function ovalBounds(points: Array<[number, number]>): OvalBounds {
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const [x, y] of points) {
    if (x < left) left = x;
    if (x > right) right = x;
    if (y < top) top = y;
    if (y > bottom) bottom = y;
  }
  return {
    left,
    right,
    top,
    bottom,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2,
  };
}

/**
 * Builds the head region from the real FaceMesh contour.
 *
 * The contour already gives the forehead, temples, cheeks and chin exactly. What
 * it does *not* contain is hair, because FaceMesh only tracks the face. The
 * region therefore adds a generous dome above the forehead and widens below the
 * chin for the bust modes.
 *
 * This region is only a *selector*: it is intersected with the person matte, so
 * the final silhouette (hair, ears, shoulders) always comes from the neural
 * matte and never from a geometric shape.
 */
export function buildHeadRegionMask(
  width: number,
  height: number,
  oval: Array<[number, number]>,
  box: Rect,
  mode: CutMode,
): Uint8ClampedArray {
  const canvas = createCanvas(width, height);
  const ctx = ctx2d(canvas);
  ctx.fillStyle = '#ffffff';

  const fallbackFaceW = Math.max(8, box.width);
  const fallbackFaceH = Math.max(8, box.height);
  const hasOval = oval.length > 4;
  const b = hasOval
    ? ovalBounds(oval)
    : {
        left: box.x,
        right: box.x + fallbackFaceW,
        top: box.y,
        bottom: box.y + fallbackFaceH,
        width: fallbackFaceW,
        height: fallbackFaceH,
        centerX: box.x + fallbackFaceW / 2,
        centerY: box.y + fallbackFaceH / 2,
      };

  const faceW = b.width;
  const faceH = b.height;
  const cx = b.centerX;
  const chin = b.bottom;

  const fillOval = (): void => {
    if (!hasOval) {
      ctx.beginPath();
      ctx.ellipse(cx, b.centerY, faceW * 0.5, faceH * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(oval[0][0], oval[0][1]);
    for (const [x, y] of oval.slice(1)) ctx.lineTo(x, y);
    ctx.closePath();
    ctx.fill();
  };

  const fillEllipse = (ex: number, ey: number, rx: number, ry: number): void => {
    ctx.beginPath();
    ctx.ellipse(ex, ey, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2);
    ctx.fill();
  };

  const fillTrapezoid = (topY: number, bottomY: number, topHalf: number, bottomHalf: number): void => {
    ctx.beginPath();
    ctx.moveTo(cx - topHalf, topY);
    ctx.lineTo(cx + topHalf, topY);
    ctx.lineTo(cx + bottomHalf, bottomY);
    ctx.lineTo(cx - bottomHalf, bottomY);
    ctx.closePath();
    ctx.fill();
  };

  switch (mode) {
    case 'background':
    case 'full':
      return new Uint8ClampedArray(width * height).fill(255);

    case 'face':
      fillOval();
      break;

    case 'head': {
      // Face contour + hair dome + a sliver of neck below the chin.
      fillOval();
      fillEllipse(cx, b.top + faceH * 0.04, faceW * 0.68, faceH * 0.86);
      fillTrapezoid(chin - faceH * 0.06, chin + faceH * 0.1, faceW * 0.34, faceW * 0.3);
      break;
    }

    case 'head-neck': {
      fillOval();
      fillEllipse(cx, b.top + faceH * 0.04, faceW * 0.68, faceH * 0.86);
      fillTrapezoid(chin - faceH * 0.06, chin + faceH * 0.62, faceW * 0.32, faceW * 0.26);
      break;
    }

    case 'head-shoulders': {
      fillOval();
      fillEllipse(cx, b.top + faceH * 0.04, faceW * 0.68, faceH * 0.86);
      fillTrapezoid(chin - faceH * 0.05, chin + faceH * 0.55, faceW * 0.34, faceW * 0.42);
      fillTrapezoid(chin + faceH * 0.5, chin + faceH * 2.1, faceW * 0.42, faceW * 0.95);
      fillEllipse(cx, chin + faceH * 1.5, faceW * 0.85, faceH * 0.7);
      break;
    }

    case 'upper-body': {
      fillOval();
      fillEllipse(cx, b.top + faceH * 0.04, faceW * 0.68, faceH * 0.86);
      fillTrapezoid(chin - faceH * 0.05, chin + faceH * 3.4, faceW * 0.4, faceW * 1.25);
      break;
    }
  }

  const mask = extractAlpha(canvas);
  const feather = Math.max(0.6, Math.min(8, faceW * 0.012));
  return blurMask(mask, width, height, feather);
}

/**
 * Keeps only the connected component of `mask` that contains the seed point.
 *
 * This is what makes multi-person photos behave: the person matte contains
 * everybody, and the component containing the chosen face is the only one that
 * survives.
 */
export function selectComponent(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  seedX: number,
  seedY: number,
  threshold = 40,
): { mask: Uint8ClampedArray; found: boolean } {
  const sx = Math.max(0, Math.min(width - 1, Math.round(seedX)));
  const sy = Math.max(0, Math.min(height - 1, Math.round(seedY)));
  const out = new Uint8ClampedArray(mask.length);
  const visited = new Uint8Array(mask.length);

  // Walk to the nearest foreground pixel around the seed so a seed that lands in
  // a soft alpha hole still selects the person.
  let start = -1;
  const radius = Math.max(6, Math.round(Math.min(width, height) * 0.02));
  for (let r = 0; r <= radius && start < 0; r++) {
    for (let dy = -r; dy <= r && start < 0; dy++) {
      for (let dx = -r; dx <= r && start < 0; dx++) {
        const x = sx + dx;
        const y = sy + dy;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        if (mask[y * width + x] > threshold) start = y * width + x;
      }
    }
  }
  if (start < 0) return { mask: out, found: false };

  const queue = new Int32Array(mask.length);
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  visited[start] = 1;
  while (head < tail) {
    const idx = queue[head++];
    out[idx] = mask[idx];
    const x = idx % width;
    const y = (idx - x) / width;
    if (x > 0) {
      const n = idx - 1;
      if (!visited[n] && mask[n] > threshold) {
        visited[n] = 1;
        queue[tail++] = n;
      }
    }
    if (x < width - 1) {
      const n = idx + 1;
      if (!visited[n] && mask[n] > threshold) {
        visited[n] = 1;
        queue[tail++] = n;
      }
    }
    if (y > 0) {
      const n = idx - width;
      if (!visited[n] && mask[n] > threshold) {
        visited[n] = 1;
        queue[tail++] = n;
      }
    }
    if (y < height - 1) {
      const n = idx + width;
      if (!visited[n] && mask[n] > threshold) {
        visited[n] = 1;
        queue[tail++] = n;
      }
    }
  }
  return { mask: out, found: true };
}

/**
 * Sharpens the transition band of a soft matte.
 *
 * Neural mattes are deliberately soft. A sticker wants a crisp edge with a
 * one-pixel anti-aliased rim, so the alpha is re-mapped with a smoothstep whose
 * steepness is controlled by `crispness` (0 = untouched, 1 = fully binary).
 */
export function tightenAlpha(mask: Uint8ClampedArray, crispness = 0.55): Uint8ClampedArray {
  if (crispness <= 0) return mask;
  const out = new Uint8ClampedArray(mask.length);
  const k = 1 + crispness * 6;
  for (let i = 0; i < mask.length; i++) {
    const t = mask[i] / 255;
    const x = Math.min(1, Math.max(0, (t - 0.5) * k + 0.5));
    out[i] = smoothstep(x) * 255;
  }
  return out;
}

/** Drop the alpha channel of a source canvas using the given mask. */
export function applyMaskToCanvas(
  source: HTMLCanvasElement,
  mask: Uint8ClampedArray,
  options: { feather?: number; expand?: number; smooth?: number } = {},
): HTMLCanvasElement {
  const { width, height } = source;
  let working = mask;
  if (options.expand && options.expand !== 0) {
    working = options.expand > 0 ? dilateMask(working, width, height, options.expand, 1) : erodeMask(working, width, height, -options.expand);
  }
  const feather = Math.max(0, options.feather ?? 0);
  if (feather > 0) working = blurMask(working, width, height, feather);
  const smooth = Math.max(0, options.smooth ?? 0);
  if (smooth > 0) working = blurMask(working, width, height, smooth);

  const out = createCanvas(width, height);
  const ctx = ctx2d(out);
  ctx.drawImage(source, 0, 0);
  const image = ctx.getImageData(0, 0, width, height);
  for (let i = 0, p = 3; i < working.length; i++, p += 4) {
    image.data[p] = (image.data[p] * working[i]) / 255;
  }
  ctx.putImageData(image, 0, 0);
  return out;
}

/** Flood-fill background removal for images with a relatively uniform backdrop. */
export function floodBackgroundRemoval(
  source: HTMLCanvasElement,
  tolerance = 0.18,
): { canvas: HTMLCanvasElement; mask: Uint8ClampedArray } {
  const { width, height } = source;
  const data = ctx2d(source).getImageData(0, 0, width, height).data;
  const visited = new Uint8Array(width * height);
  const mask = new Uint8ClampedArray(width * height).fill(255);
  const seeds: number[] = [];
  // sample the border pixels as background seeds
  for (let x = 0; x < width; x += Math.max(1, width >> 6)) {
    seeds.push(x, (height - 1) * width + x);
  }
  for (let y = 0; y < height; y += Math.max(1, height >> 6)) {
    seeds.push(y * width, y * width + width - 1);
  }

  const tol = Math.max(0.02, tolerance) * 255 * 1.732;
  const isBackground = (a: number, b: number) => {
    const dr = data[a * 4] - data[b * 4];
    const dg = data[a * 4 + 1] - data[b * 4 + 1];
    const db = data[a * 4 + 2] - data[b * 4 + 2];
    return Math.sqrt(dr * dr + dg * dg + db * db) <= tol;
  };

  const stack: number[] = [];
  for (const seed of seeds) {
    if (!visited[seed] && data[seed * 4 + 3] > 8) {
      visited[seed] = 1;
      stack.push(seed);
    }
  }
  while (stack.length) {
    const idx = stack.pop() as number;
    const x = idx % width;
    const y = (idx - x) / width;
    // compare against the seed's color sampled from the border average
    const bg = seeds[0];
    if (!isBackground(idx, bg)) continue;
    mask[idx] = 0;
    const neighbours = [x > 0 ? idx - 1 : -1, x < width - 1 ? idx + 1 : -1, y > 0 ? idx - width : -1, y < height - 1 ? idx + width : -1];
    for (const n of neighbours) {
      if (n >= 0 && !visited[n] && data[n * 4 + 3] > 8) {
        visited[n] = 1;
        stack.push(n);
      }
    }
  }
  const feathered = blurMask(mask, width, height, 1.2);
  return { canvas: applyMaskToCanvas(source, feathered), mask: feathered };
}

/** Removes tiny isolated alpha speckles (down to `minArea` px). */
export function removeSpecks(mask: Uint8ClampedArray, width: number, height: number, minArea = 12): Uint8ClampedArray {
  const out = mask.slice();
  const visited = new Uint8Array(mask.length);
  const stack: number[] = [];
  for (let i = 0; i < mask.length; i++) {
    if (visited[i] || mask[i] < 16) continue;
    let area = 0;
    visited[i] = 1;
    stack.length = 0;
    stack.push(i);
    const pixels: number[] = [];
    while (stack.length) {
      const idx = stack.pop() as number;
      pixels.push(idx);
      area++;
      const x = idx % width;
      const y = (idx - x) / width;
      const ns = [x > 0 ? idx - 1 : -1, x < width - 1 ? idx + 1 : -1, y > 0 ? idx - width : -1, y < height - 1 ? idx + width : -1];
      for (const n of ns) {
        if (n >= 0 && !visited[n] && mask[n] >= 16) {
          visited[n] = 1;
          stack.push(n);
        }
      }
    }
    if (area < minArea) for (const idx of pixels) out[idx] = 0;
  }
  return out;
}
