import type { CanvasElement, ProjectData } from "./types";

export interface Viewport {
  x: number;
  y: number;
  scale: number;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 8;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function frameBounds(project: Pick<ProjectData, "width" | "height">): Bounds {
  return { x: 0, y: 0, width: project.width, height: project.height };
}

export function contentBounds(elements: CanvasElement[]): Bounds {
  if (elements.length === 0) return { x: 0, y: 0, width: 800, height: 600 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const el of elements) {
    if (el.hidden) continue;
    const cx = el.x + el.width / 2;
    const cy = el.y + el.height / 2;
    const rad = (el.rotation * Math.PI) / 180;
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    const w = el.width * cos + el.height * sin;
    const h = el.width * sin + el.height * cos;
    minX = Math.min(minX, cx - w / 2);
    minY = Math.min(minY, cy - h / 2);
    maxX = Math.max(maxX, cx + w / 2);
    maxY = Math.max(maxY, cy + h / 2);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 800, height: 600 };
  return { x: minX, y: minY, width: Math.max(40, maxX - minX), height: Math.max(40, maxY - minY) };
}

export function fitViewport(
  viewportSize: { width: number; height: number },
  bounds: Bounds,
  padding = 56,
  maxScale = 2,
): Viewport {
  const scale = clamp(
    Math.min(
      (viewportSize.width - padding * 2) / Math.max(1, bounds.width),
      (viewportSize.height - padding * 2) / Math.max(1, bounds.height),
    ),
    MIN_SCALE,
    maxScale,
  );
  const x = (viewportSize.width - bounds.width * scale) / 2 - bounds.x * scale;
  const y = (viewportSize.height - bounds.height * scale) / 2 - bounds.y * scale;
  return { x, y, scale };
}

export function worldToScreen(v: Viewport, x: number, y: number) {
  return { x: x * v.scale + v.x, y: y * v.scale + v.y };
}

export function screenToWorld(v: Viewport, x: number, y: number) {
  return { x: (x - v.x) / v.scale, y: (y - v.y) / v.scale };
}

export function zoomAt(v: Viewport, screenX: number, screenY: number, nextScale: number): Viewport {
  const scale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
  const wx = (screenX - v.x) / v.scale;
  const wy = (screenY - v.y) / v.scale;
  return { scale, x: screenX - wx * scale, y: screenY - wy * scale };
}

/** returns the screen-space rect currently occupied by the artboard */
export function frameScreenRect(v: Viewport, project: { width: number; height: number }) {
  const p = worldToScreen(v, 0, 0);
  return { x: p.x, y: p.y, width: project.width * v.scale, height: project.height * v.scale };
}

export interface SnapResult {
  x: number;
  y: number;
  guidesX: number[];
  guidesY: number[];
}

/**
 * Edge + centre snapping against the artboard and every other element.
 * Returns world-space guides for rendering.
 */
export function snapPosition(
  moving: Bounds,
  candidates: Bounds[],
  frame: Bounds | null,
  thresholdWorld: number,
): SnapResult {
  const targetX: number[] = [];
  const targetY: number[] = [];
  for (const c of candidates) {
    targetX.push(c.x, c.x + c.width / 2, c.x + c.width);
    targetY.push(c.y, c.y + c.height / 2, c.y + c.height);
  }
  if (frame) {
    targetX.push(frame.x, frame.x + frame.width / 2, frame.x + frame.width);
    targetY.push(frame.y, frame.y + frame.height / 2, frame.y + frame.height);
  }

  const movingX = [moving.x, moving.x + moving.width / 2, moving.x + moving.width];
  const movingY = [moving.y, moving.y + moving.height / 2, moving.y + moving.height];

  let bestDX = Infinity;
  let bestX = moving.x;
  const guidesX: number[] = [];
  for (const mx of movingX) {
    for (const tx of targetX) {
      const d = tx - mx;
      if (Math.abs(d) < Math.abs(bestDX) && Math.abs(d) <= thresholdWorld) {
        bestDX = d;
        bestX = moving.x + d;
      }
    }
  }
  if (Number.isFinite(bestDX)) {
    for (const tx of targetX) {
      if (movingX.some((mx) => Math.abs(mx + bestDX - tx) < 0.5)) guidesX.push(tx);
    }
  }

  let bestDY = Infinity;
  let bestY = moving.y;
  const guidesY: number[] = [];
  for (const my of movingY) {
    for (const ty of targetY) {
      const d = ty - my;
      if (Math.abs(d) < Math.abs(bestDY) && Math.abs(d) <= thresholdWorld) {
        bestDY = d;
        bestY = moving.y + d;
      }
    }
  }
  if (Number.isFinite(bestDY)) {
    for (const ty of targetY) {
      if (movingY.some((my) => Math.abs(my + bestDY - ty) < 0.5)) guidesY.push(ty);
    }
  }

  return {
    x: Number.isFinite(bestDX) ? bestX : moving.x,
    y: Number.isFinite(bestDY) ? bestY : moving.y,
    guidesX: [...new Set(guidesX)],
    guidesY: [...new Set(guidesY)],
  };
}

export function rectIntersects(a: Bounds, b: Bounds): boolean {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}
