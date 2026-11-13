/**
 * Person colour treatments.
 *
 * These run on the *source pixels* before masking, so only the surviving subject is
 * affected — the outline and alpha pipeline is untouched. They are pure canvas
 * operations: no model, no network, no per-frame cost.
 */
import { createCanvas, ctx2d } from "./image";
import type { PersonColor } from "../types";

/** Luminance in 0..1, Rec. 709 weights (matches how the eye weights channels). */
function luma(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function mapPixels(
  source: HTMLCanvasElement,
  transform: (r: number, g: number, b: number, x: number, y: number) => [number, number, number] | null,
): HTMLCanvasElement {
  const out = createCanvas(source.width, source.height);
  const ctx = ctx2d(out);
  ctx.drawImage(source, 0, 0);
  const image = ctx.getImageData(0, 0, out.width, out.height);
  const data = image.data;
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const p = (y * out.width + x) * 4;
      if (data[p + 3] === 0) continue;
      const next = transform(data[p], data[p + 1], data[p + 2], x, y);
      if (!next) continue;
      data[p] = next[0];
      data[p + 1] = next[1];
      data[p + 2] = next[2];
    }
  }
  ctx.putImageData(image, 0, 0);
  return out;
}

/**
 * Apply the requested colour treatment and return a canvas.
 *
 * `original` returns the same canvas object (no copy) so the common path stays free.
 */
export function applyPersonColor(
  source: HTMLCanvasElement,
  mode: PersonColor,
  options?: { customTint?: string; halftoneSize?: number },
): HTMLCanvasElement {
  if (mode === "original") return source;

  if (mode === "grayscale") {
    return mapPixels(source, (r, g, b) => {
      const value = Math.round(luma(r, g, b) * 255);
      return [value, value, value];
    });
  }

  if (mode === "mono") {
    // Hard black/white: the classic meme look, threshold near mid-grey.
    return mapPixels(source, (r, g, b) => {
      const value = luma(r, g, b) > 0.52 ? 255 : 0;
      return [value, value, value];
    });
  }

  if (mode === "duotone") {
    const [dr, dg, db] = hexToRgb(options?.customTint ?? "#ff4d6d");
    return mapPixels(source, (r, g, b) => {
      const t = luma(r, g, b);
      // Deep shadow → tint, highlight → near-white, so detail survives both ends.
      return [
        Math.round(dr * t + 255 * (1 - t) * 0.06),
        Math.round(dg * t + 255 * (1 - t) * 0.06),
        Math.round(db * t + 255 * (1 - t) * 0.06),
      ];
    });
  }

  if (mode === "halftone") {
    const size = Math.max(3, Math.round(options?.halftoneSize ?? 6));
    // Precompute the source, then redraw as dots whose radius follows luminance.
    const base = createCanvas(source.width, source.height);
    ctx2d(base).drawImage(source, 0, 0);
    const src = ctx2d(base).getImageData(0, 0, base.width, base.height);
    const out = createCanvas(source.width, source.height);
    const ctx = ctx2d(out);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, out.width, out.height);
    for (let y = 0; y < out.height; y += size) {
      for (let x = 0; x < out.width; x += size) {
        const p = (Math.min(out.height - 1, y + (size >> 1)) * out.width + Math.min(out.width - 1, x + (size >> 1))) * 4;
        if (src.data[p + 3] === 0) continue;
        const t = luma(src.data[p], src.data[p + 1], src.data[p + 2]);
        const radius = (t * size) / 1.6;
        if (radius < 0.35) continue;
        ctx.fillStyle = "#111111";
        ctx.beginPath();
        ctx.arc(x + size / 2, y + size / 2, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Keep only the subject: paint the dots through the source alpha.
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(base, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    return out;
  }

  if (mode === "custom") {
    const [tr, tg, tb] = hexToRgb(options?.customTint ?? "#ffd166");
    return mapPixels(source, (r, g, b) => {
      const t = luma(r, g, b);
      // Screen-style tint that lifts shadows but never fully replaces the original.
      return [
        Math.round(r * 0.55 + tr * t * 0.45),
        Math.round(g * 0.55 + tg * t * 0.45),
        Math.round(b * 0.55 + tb * t * 0.45),
      ];
    });
  }

  return source;
}

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value;
  const num = Number.parseInt(full, 16);
  if (!Number.isFinite(num)) return [255, 255, 255];
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}
