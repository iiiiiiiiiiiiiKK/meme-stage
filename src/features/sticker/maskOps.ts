/**
 * Pure mask operations for the sticker workbench.
 *
 * Kept separate from `processor.ts` on purpose: the processor pulls in the local
 * TensorFlow models, which need a DOM. Everything here is plain typed-array math
 * and can therefore be unit-tested without a browser.
 */
import { blurMask, dilateMask, erodeMask } from "./engine/mask";

/** Pixels the matte actually claims, as a fraction of the image. */
export function alphaCoverage(alpha: Uint8ClampedArray): number {
  if (alpha.length === 0) return 0;
  let covered = 0;
  for (let i = 0; i < alpha.length; i++) if (alpha[i] > 8) covered += 1;
  return covered / alpha.length;
}

export interface BrushStroke {
  points: Array<{ x: number; y: number }>;
  radius: number;
  mode: "erase" | "restore";
  /** 1 = hard edge, 0 = fully feathered */
  hardness: number;
}

/**
 * Paint a hand-correction stroke onto a mask copy.
 *
 * The source mask is never mutated, which is what makes "撤销/还原" cheap: the
 * workbench just drops the edited copy and points back at the generated matte.
 */
export function paintMask(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  stroke: BrushStroke,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(mask);
  const radius = Math.max(1, stroke.radius);
  const hard = Math.max(0, Math.min(1, stroke.hardness));
  const value = stroke.mode === "restore" ? 255 : 0;
  for (const point of stroke.points) {
    const minX = Math.max(0, Math.floor(point.x - radius));
    const maxX = Math.min(width - 1, Math.ceil(point.x + radius));
    const minY = Math.max(0, Math.floor(point.y - radius));
    const maxY = Math.min(height - 1, Math.ceil(point.y + radius));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x - point.x;
        const dy = y - point.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > radius) continue;
        const inner = radius * hard;
        const falloff = dist <= inner ? 1 : 1 - (dist - inner) / Math.max(0.001, radius - inner);
        const weight = Math.max(0, Math.min(1, falloff));
        const index = y * width + x;
        out[index] = Math.round(out[index] * (1 - weight) + value * weight);
      }
    }
  }
  return out;
}

/** Feather a hand-edited mask so brush strokes do not leave a jagged rim. */
export function smoothMask(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  radius = 1,
): Uint8ClampedArray {
  return radius > 0 ? blurMask(mask, width, height, radius) : mask.slice();
}

/** Trim / expand a mask by pixels; used by the "边缘修正" controls. */
export function growMask(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  pixels: number,
): Uint8ClampedArray {
  if (pixels === 0) return mask.slice();
  return pixels > 0 ? dilateMask(mask, width, height, pixels, 1) : erodeMask(mask, width, height, -pixels);
}
