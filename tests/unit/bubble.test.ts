import { describe, expect, it } from "vitest";
import { bubbleAnchorPoint } from "../../src/lib/bubblePosition";
import type { BubblePlacement } from "../../src/lib/types";

const el = { x: 100, y: 200, width: 60, height: 80 };

const placement = (patch: Partial<BubblePlacement> = {}): BubblePlacement => ({
  anchor: "auto",
  offsetX: 0,
  offsetY: 0,
  maxWidth: 300,
  ...patch,
});

describe("bubble placement", () => {
  it("attaches an auto bubble above the character by default", () => {
    const point = bubbleAnchorPoint(el, placement());
    expect(point).toMatchObject({ x: 130, y: 200, tx: "-50%", ty: "-100%", below: false });
  });

  it("flips an auto bubble below when there is no room above", () => {
    const point = bubbleAnchorPoint(el, placement(), { x: 0, y: 0 }, true);
    expect(point).toMatchObject({ x: 130, y: 280, tx: "-50%", ty: "0%", below: true });
  });

  it("supports explicit anchors", () => {
    expect(bubbleAnchorPoint(el, placement({ anchor: "bottom" }))).toMatchObject({
      x: 130,
      y: 280,
      ty: "0%",
    });
    expect(bubbleAnchorPoint(el, placement({ anchor: "left" }))).toMatchObject({
      x: 100,
      y: 240,
      tx: "-100%",
      ty: "-50%",
    });
    expect(bubbleAnchorPoint(el, placement({ anchor: "right" }))).toMatchObject({
      x: 160,
      y: 240,
      tx: "0%",
    });
  });

  it("applies offsets in world space and follows element offsets", () => {
    const point = bubbleAnchorPoint(el, placement({ offsetX: 20, offsetY: -15 }), { x: 5, y: 10 });
    expect(point.x).toBe(130 + 5 + 20);
    expect(point.y).toBe(200 + 10 - 15);
  });

  it("falls back to defaults when placement is missing", () => {
    expect(bubbleAnchorPoint(el, undefined)).toMatchObject({ x: 130, y: 200, ty: "-100%" });
  });
});
