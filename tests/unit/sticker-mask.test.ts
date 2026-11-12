import { describe, expect, it } from "vitest";
import { alphaCoverage, paintMask } from "../../src/features/sticker/maskOps";
import { blurMask, dilateMask, erodeMask, multiplyMasks, removeSpecks, tightenAlpha } from "../../src/features/sticker/engine/mask";

const W = 20;
const H = 20;

function blank(): Uint8ClampedArray {
  return new Uint8ClampedArray(W * H);
}

function filled(value = 255): Uint8ClampedArray {
  return new Uint8ClampedArray(W * H).fill(value);
}

describe("sticker mask editing", () => {
  it("reports the fraction of the image the matte claims", () => {
    expect(alphaCoverage(blank())).toBe(0);
    expect(alphaCoverage(filled())).toBe(1);
    const half = blank();
    for (let i = 0; i < half.length / 2; i++) half[i] = 255;
    expect(alphaCoverage(half)).toBeCloseTo(0.5, 5);
    // almost-transparent pixels below the threshold do not count
    const faint = filled(4);
    expect(alphaCoverage(faint)).toBe(0);
  });

  it("erases a circle without touching the surrounding pixels", () => {
    const mask = filled();
    const out = paintMask(mask, W, H, {
      points: [{ x: 10, y: 10 }],
      radius: 3,
      mode: "erase",
      hardness: 1,
    });
    expect(out[10 * W + 10]).toBe(0);
    expect(out[0]).toBe(255);
    // the source array is never mutated
    expect(mask[10 * W + 10]).toBe(255);
  });

  it("restores pixels that an eraser removed", () => {
    const mask = paintMask(filled(), W, H, {
      points: [{ x: 5, y: 5 }],
      radius: 4,
      mode: "erase",
      hardness: 1,
    });
    expect(mask[5 * W + 5]).toBe(0);
    const restored = paintMask(mask, W, H, {
      points: [{ x: 5, y: 5 }],
      radius: 4,
      mode: "restore",
      hardness: 1,
    });
    expect(restored[5 * W + 5]).toBe(255);
  });

  it("soft brushes leave a feathered edge instead of a hard step", () => {
    const out = paintMask(filled(), W, H, {
      points: [{ x: 10, y: 10 }],
      radius: 6,
      mode: "erase",
      hardness: 0,
    });
    const center = out[10 * W + 10];
    const edge = out[10 * W + 15];
    expect(center).toBeLessThan(20);
    expect(edge).toBeGreaterThan(center);
    expect(edge).toBeLessThan(255);
  });

  it("clips brush strokes at the image border", () => {
    const out = paintMask(filled(), W, H, {
      points: [{ x: -4, y: -4 }],
      radius: 6,
      mode: "erase",
      hardness: 1,
    });
    expect(out[0]).toBe(0);
    expect(out[W * H - 1]).toBe(255);
  });

  it("applies several points of one stroke", () => {
    const out = paintMask(filled(), W, H, {
      points: [
        { x: 4, y: 4 },
        { x: 14, y: 14 },
      ],
      radius: 2,
      mode: "erase",
      hardness: 1,
    });
    expect(out[4 * W + 4]).toBe(0);
    expect(out[14 * W + 14]).toBe(0);
    expect(out[9 * W + 9]).toBe(255);
  });
});

describe("sticker mask morphology", () => {
  it("dilates and erodes symmetrically by the requested radius", () => {
    const single = blank();
    single[10 * W + 10] = 255;
    const grown = dilateMask(single, W, H, 3, 1);
    expect(grown[10 * W + 13]).toBe(255);
    expect(grown[10 * W + 15]).toBe(0);

    const block = blank();
    for (let y = 5; y < 15; y++) for (let x = 5; x < 15; x++) block[y * W + x] = 255;
    const eroded = erodeMask(block, W, H, 2);
    expect(eroded[10 * W + 10]).toBe(255);
    expect(eroded[5 * W + 5]).toBeLessThan(128);
  });

  it("blur produces a soft gradient rather than a binary edge", () => {
    const half = blank();
    for (let y = 0; y < H; y++) for (let x = 0; x < 10; x++) half[y * W + x] = 255;
    const blurred = blurMask(half, W, H, 2);
    expect(blurred[0]).toBeGreaterThan(200);
    expect(blurred[9 * W + 9]).toBeGreaterThan(0);
    expect(blurred[9 * W + 9]).toBeLessThan(255);
  });

  it("multiplies masks as an intersection", () => {
    const a = filled(200);
    const b = filled(100);
    const out = multiplyMasks(a, b);
    expect(Math.round(out[0])).toBe(Math.round((200 * 100) / 255));
  });

  it("tightenAlpha pushes a soft edge toward binary without moving the centre", () => {
    const soft = filled(128);
    const tight = tightenAlpha(soft, 0.6);
    // the 0.5 crossing point barely moves, only the band gets steeper
    expect(Math.abs(tight[0] - 128)).toBeLessThanOrEqual(5);
    const near = filled(180);
    expect(tightenAlpha(near, 0.8)[0]).toBeGreaterThan(near[0]);
  });

  it("drops tiny specks but keeps real blobs", () => {
    const mask = blank();
    mask[0] = 255; // single-pixel speck
    for (let y = 8; y < 14; y++) for (let x = 8; x < 14; x++) mask[y * W + x] = 255;
    const cleaned = removeSpecks(mask, W, H, 6);
    expect(cleaned[0]).toBe(0);
    expect(cleaned[10 * W + 10]).toBe(255);
  });
});
