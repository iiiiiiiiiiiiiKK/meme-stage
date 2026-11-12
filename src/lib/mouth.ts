/**
 * Mouth geometry for the lip-flap overlay.
 *
 * A character is drawn as a Konva group centred on the element box with an
 * optional rotation and an optional mirror. The mouth anchor is stored as a
 * fraction of the *unrotated* box, so turning that into a screen point has to
 * undo the same transforms Konva applies — otherwise the flap drifts off the
 * face as soon as a character is flipped or tilted.
 */
import type { CanvasElement, MouthAnchor } from "./types";
import { mouthOf } from "./defaults";
import type { Viewport } from "./geometry";

export interface MouthShape {
  /** centre of the mouth, in screen pixels */
  cx: number;
  cy: number;
  /** rendered mouth width / height, in screen pixels */
  width: number;
  height: number;
  /** rotation to apply to the overlay so it follows the picture */
  rotation: number;
}

const DEG = Math.PI / 180;

/** world-space centre of the mouth for an element, honouring flip and rotation */
export function mouthWorldPoint(
  el: CanvasElement,
  offset: { x: number; y: number } = { x: 0, y: 0 },
): { x: number; y: number; rotation: number; width: number; height: number; anchor: MouthAnchor } {
  const anchor = mouthOf(el.character, el.width, el.height);
  const centerX = el.x + offset.x + el.width / 2;
  const centerY = el.y + offset.y + el.height / 2;
  // local offset from the centre of the box
  let lx = (anchor.x - 0.5) * el.width;
  let ly = (anchor.y - 0.5) * el.height;
  if (el.flipX) lx = -lx;
  if (el.flipY) ly = -ly;
  const rad = (el.rotation ?? 0) * DEG;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const width = Math.max(8, anchor.size * el.width);
  return {
    x: centerX + lx * cos - ly * sin,
    y: centerY + lx * sin + ly * cos,
    rotation: el.rotation ?? 0,
    width,
    height: width * 0.55,
    anchor,
  };
}

/** screen-space mouth box for a viewport, ready to position a DOM overlay */
export function mouthScreenShape(
  el: CanvasElement,
  viewport: Viewport,
  offset: { x: number; y: number } = { x: 0, y: 0 },
): MouthShape {
  const world = mouthWorldPoint(el, offset);
  const scale = viewport.scale;
  return {
    cx: world.x * scale + viewport.x,
    cy: world.y * scale + viewport.y,
    width: Math.max(6, world.width * scale),
    height: Math.max(4, world.height * scale),
    rotation: world.rotation,
  };
}
