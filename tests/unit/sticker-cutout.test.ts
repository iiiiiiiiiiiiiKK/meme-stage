import { describe, expect, it } from "vitest";
import { unionMasks } from "../../src/features/sticker/engine/mask";
import { computeStrokeLayers } from "../../src/features/sticker/engine/outline";
import { buildCutMask } from "../../src/features/sticker/engine/cutout";
import { DEFAULT_OUTLINE, type CutoutOptions, type FaceDetection } from "../../src/features/sticker/types";

/**
 * Unit coverage for the multi-subject and multi-layer rules.
 *
 * The geometric part of `buildCutMask` draws through a real 2D canvas, which Node
 * does not provide; per-face isolation and the union step are covered here, and the
 * full pixel path is exercised in the browser probe (scripts/test-sticker-entry.mjs).
 */

const W = 8;
const H = 4;

function mask(fill: (index: number) => number): Uint8ClampedArray {
  return Uint8ClampedArray.from({ length: W * H }, (_, index) => fill(index));
}

describe("unionMasks", () => {
  it("keeps the brighter pixel at every position", () => {
    const a = mask((i) => (i < 16 ? 200 : 0));
    const b = mask((i) => (i >= 16 ? 180 : 60));
    const out = unionMasks([a, b]);
    expect(out[0]).toBe(200);
    expect(out[20]).toBe(180);
  });

  it("returns a copy for a single mask, never the same reference", () => {
    const only = mask(() => 120);
    const out = unionMasks([only]);
    expect(Array.from(out)).toEqual(Array.from(only));
    expect(out).not.toBe(only);
  });

  it("tolerates an empty list", () => {
    expect(unionMasks([]).length).toBe(0);
    expect(unionMasks([new Uint8ClampedArray(0)]).length).toBe(0);
  });

  it("stops at the shortest mask instead of reading past it", () => {
    const a = mask(() => 255);
    const shorter = new Uint8ClampedArray(3).fill(10);
    const out = unionMasks([a, shorter]);
    expect(out.length).toBe(a.length);
    expect(out[W * H - 1]).toBe(255);
  });
});

describe("multi-subject cutout selection", () => {
  const twoFaces: FaceDetection[] = [
    { index: 0, box: [1, 1, 2, 2], score: 0.9, mesh: [], oval: [] },
    { index: 1, box: [5, 1, 2, 2], score: 0.9, mesh: [], oval: [] },
  ];

  function options(overrides: Partial<CutoutOptions> = {}): CutoutOptions {
    return {
      mode: "head",
      faceIndex: 0,
      feather: 0.6,
      expand: 0,
      edgeSmooth: 0.4,
      outline: { ...DEFAULT_OUTLINE },
      ...overrides,
    };
  }

  it("keeps the whole silhouette when no face was detected", () => {
    const person = mask(() => 255);
    const { mask: cut, warning } = buildCutMask(W, H, person, [], options());
    expect(warning).toContain("No face");
    expect(Array.from(cut)).toEqual(Array.from(person));
  });

  it("background mode ignores face indices entirely", () => {
    const person = mask((i) => (i % 2 === 0 ? 255 : 0));
    const { mask: cut } = buildCutMask(
      W,
      H,
      person,
      twoFaces,
      options({ mode: "background", faceIndices: [0, 1] }),
    );
    expect(Array.from(cut)).toEqual(Array.from(person));
  });
});

describe("multi-layer outline", () => {
  const alpha = mask(() => 255);

  it("emits one layer per enabled stroke, outermost first", () => {
    const layers = computeStrokeLayers(alpha, W, H, {
      ...DEFAULT_OUTLINE,
      enabled: true,
      thickness: 6,
      layers: 3,
      secondThickness: 3,
      thirdColor: "#ff0000",
      thirdThickness: 2,
    });
    expect(layers).toHaveLength(3);
    expect(layers[0]!.color).toBe("#ff0000");
    expect(layers[1]!.color).toBe(DEFAULT_OUTLINE.secondColor);
    expect(layers[2]!.color).toBe(DEFAULT_OUTLINE.color);
  });

  it("two-layer mode never paints the third colour", () => {
    const layers = computeStrokeLayers(alpha, W, H, {
      ...DEFAULT_OUTLINE,
      enabled: true,
      layers: 2,
      thickness: 6,
      secondThickness: 3,
      thirdColor: "#ff0000",
      thirdThickness: 9,
    });
    expect(layers).toHaveLength(2);
    expect(layers.map((layer) => layer.color)).not.toContain("#ff0000");
  });

  it("a disabled outline paints nothing at all", () => {
    expect(computeStrokeLayers(alpha, W, H, { ...DEFAULT_OUTLINE, enabled: false })).toEqual([]);
  });

  it("a zero-thickness third layer is skipped instead of drawn at 0px", () => {
    const layers = computeStrokeLayers(alpha, W, H, {
      ...DEFAULT_OUTLINE,
      enabled: true,
      layers: 3,
      thickness: 6,
      secondThickness: 3,
      thirdThickness: 0,
    });
    expect(layers).toHaveLength(2);
  });

  it("single-layer mode paints exactly the inner stroke", () => {
    const layers = computeStrokeLayers(alpha, W, H, {
      ...DEFAULT_OUTLINE,
      enabled: true,
      layers: 1,
      thickness: 6,
      secondThickness: 0,
    });
    expect(layers).toHaveLength(1);
    expect(layers[0]!.color).toBe(DEFAULT_OUTLINE.color);
  });
});
