import { describe, expect, it } from "vitest";
import { layoutElements } from "../../src/lib/layout";

const FRAME = { width: 1600, height: 900 };
const sizes = Array.from({ length: 20 }, (_, i) => ({ width: 600, height: 800 + i * 2 }));

describe("auto layout", () => {
  it("places every imported picture inside the artboard", () => {
    for (const mode of ["scatter", "grid", "cluster", "random", "nooverlap", "custom"] as const) {
      const rects = layoutElements(sizes, FRAME, { mode, seed: 42 });
      expect(rects).toHaveLength(20);
      for (const rect of rects) {
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.y).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.width).toBeLessThanOrEqual(FRAME.width + 0.001);
        expect(rect.y + rect.height).toBeLessThanOrEqual(FRAME.height + 0.001);
        expect(rect.width).toBeGreaterThan(20);
        expect(rect.height).toBeGreaterThan(20);
      }
    }
  });

  it("never stacks 20 imports on the same coordinate", () => {
    for (const mode of ["scatter", "grid", "cluster", "nooverlap"] as const) {
      const rects = layoutElements(sizes, FRAME, { mode, seed: 7 });
      const keys = new Set(rects.map((r) => `${Math.round(r.x)}:${Math.round(r.y)}`));
      expect(keys.size, mode).toBe(20);
    }
  });

  it("grid uses the requested number of columns", () => {
    const rects = layoutElements(sizes.slice(0, 12), FRAME, { mode: "grid", columns: 4 });
    const rowTops = new Set(rects.map((r) => Math.round(r.y)));
    const firstRow = rects.filter((r) => Math.round(r.y) === Math.round(rects[0].y));
    expect(firstRow).toHaveLength(4);
    expect(rowTops.size).toBe(3);
  });

  it("is deterministic for a given seed", () => {
    const a = layoutElements(sizes, FRAME, { mode: "scatter", seed: 99 });
    const b = layoutElements(sizes, FRAME, { mode: "scatter", seed: 99 });
    expect(a).toEqual(b);
  });

  it("keeps aspect ratio of the source image", () => {
    const rects = layoutElements([{ width: 400, height: 800 }], FRAME, { mode: "grid" });
    expect(rects[0].width / rects[0].height).toBeCloseTo(0.5, 3);
  });

  it("handles 0 and 1 elements", () => {
    expect(layoutElements([], FRAME, { mode: "grid" })).toEqual([]);
    const one = layoutElements([{ width: 600, height: 800 }], FRAME, { mode: "cluster" });
    expect(one).toHaveLength(1);
    expect(one[0].x + one[0].width / 2).toBeCloseTo(FRAME.width / 2, 0);
  });

  it("scatter avoids overlaps more than random", () => {
    const overlapCount = (rects: { x: number; y: number; width: number; height: number }[]) => {
      let count = 0;
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i];
          const b = rects[j];
          if (!(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y)) {
            count += 1;
          }
        }
      }
      return count;
    };
    const scatter = layoutElements(sizes, FRAME, { mode: "nooverlap", seed: 5 });
    const random = layoutElements(sizes, FRAME, { mode: "random", seed: 5 });
    expect(overlapCount(scatter)).toBeLessThanOrEqual(overlapCount(random));
  });
});
