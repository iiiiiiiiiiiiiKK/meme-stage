import { describe, expect, it } from "vitest";
import {
  contentBounds,
  fitViewport,
  snapPosition,
  worldToScreen,
  zoomAt,
} from "../../src/lib/geometry";
import { createCharacter } from "../../src/lib/defaults";

describe("viewport geometry", () => {
  it("fits and centres the artboard", () => {
    const viewport = fitViewport({ width: 1000, height: 600 }, { x: 0, y: 0, width: 1600, height: 900 }, 40);
    const topLeft = worldToScreen(viewport, 0, 0);
    const bottomRight = worldToScreen(viewport, 1600, 900);
    expect(topLeft.x).toBeGreaterThanOrEqual(0);
    expect(bottomRight.x).toBeLessThanOrEqual(1000.001);
    expect(bottomRight.y).toBeLessThanOrEqual(600.001);
    expect((topLeft.x + bottomRight.x) / 2).toBeCloseTo(500, 0);
  });

  it("zooms around the pointer without moving the point under it", () => {
    const start = { x: 20, y: 30, scale: 0.8 };
    const pointer = { x: 420, y: 260 };
    const before = { x: (pointer.x - start.x) / start.scale, y: (pointer.y - start.y) / start.scale };
    const zoomed = zoomAt(start, pointer.x, pointer.y, 1.9);
    const after = { x: (pointer.x - zoomed.x) / zoomed.scale, y: (pointer.y - zoomed.y) / zoomed.scale };
    expect(after.x).toBeCloseTo(before.x, 4);
    expect(after.y).toBeCloseTo(before.y, 4);
  });

  it("clamps extreme zoom values", () => {
    const zoomed = zoomAt({ x: 0, y: 0, scale: 1 }, 0, 0, 1000);
    expect(zoomed.scale).toBeLessThanOrEqual(8);
    expect(zoomAt({ x: 0, y: 0, scale: 1 }, 0, 0, 0.000001).scale).toBeGreaterThanOrEqual(0.05);
  });

  it("snaps an element to the artboard centre", () => {
    const result = snapPosition(
      { x: 496, y: 200, width: 100, height: 100 },
      [],
      { x: 0, y: 0, width: 1000, height: 600 },
      10,
    );
    expect(result.x).toBe(500);
    expect(result.guidesX).toContain(500);
  });

  it("snaps edges to other elements", () => {
    const result = snapPosition(
      { x: 101, y: 300, width: 80, height: 80 },
      [{ x: 180, y: 100, width: 120, height: 120 }],
      null,
      8,
    );
    expect(result.x).toBe(100);
  });

  it("computes rotated content bounds", () => {
    const el = createCharacter({ name: "x", imageUrl: "/x.png", width: 200, height: 100, x: 0, y: 0 });
    el.rotation = 90;
    const bounds = contentBounds([el]);
    expect(bounds.width).toBeCloseTo(100, 0);
    expect(bounds.height).toBeCloseTo(200, 0);
  });
});
