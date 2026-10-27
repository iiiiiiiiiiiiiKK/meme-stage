import type { BubblePlacement, CanvasElement } from "./types";

export interface BubbleAnchorPoint {
  /** world coordinates the bubble should point at */
  x: number;
  y: number;
  /** CSS translate percentages for the bubble box */
  tx: string;
  ty: string;
  below: boolean;
}

const DEFAULT_PLACEMENT: BubblePlacement = {
  anchor: "auto",
  offsetX: 0,
  offsetY: 0,
  maxWidth: 300,
};

/**
 * Computes where a character's bubble sits in world space.
 * `forceBelow` lets the visitor stage flip an "auto" bubble under the character
 * when it would otherwise leave the viewport.
 */
export function bubbleAnchorPoint(
  el: Pick<CanvasElement, "x" | "y" | "width" | "height">,
  placement: BubblePlacement | undefined,
  offset: { x: number; y: number } = { x: 0, y: 0 },
  forceBelow = false,
): BubbleAnchorPoint {
  const p = placement ?? DEFAULT_PLACEMENT;
  const left = el.x + offset.x;
  const top = el.y + offset.y;
  const width = el.width;
  const height = el.height;
  const cx = left + width / 2;
  const cy = top + height / 2;
  const ox = p.offsetX ?? 0;
  const oy = p.offsetY ?? 0;

  const anchor = p.anchor === "auto" ? (forceBelow ? "bottom" : "top") : p.anchor;

  switch (anchor) {
    case "bottom":
      return { x: cx + ox, y: top + height + oy, tx: "-50%", ty: "0%", below: true };
    case "left":
      return { x: left + ox, y: cy + oy, tx: "-100%", ty: "-50%", below: false };
    case "right":
      return { x: left + width + ox, y: cy + oy, tx: "0%", ty: "-50%", below: false };
    case "top":
    default:
      return { x: cx + ox, y: top + oy, tx: "-50%", ty: "-100%", below: false };
  }
}
