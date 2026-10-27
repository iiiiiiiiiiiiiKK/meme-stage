export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Size {
  x: number;
  y: number;
}

export type LayoutMode = "scatter" | "grid" | "cluster" | "random" | "nooverlap" | "custom";

export interface LayoutOptions {
  mode: LayoutMode;
  columns?: number;
  /** gap in px between cells (grid / custom) */
  gap?: number;
  /** target height of each imported character */
  baseHeight?: number;
  /** 0..1, only used by custom/random to add jitter or overlap */
  overlap?: number;
  seed?: number;
  padding?: number;
}

export const LAYOUT_LABELS: { mode: LayoutMode; label: string; hint: string }[] = [
  { mode: "scatter", label: "自由散落", hint: "自然拼贴，尽量不重叠" },
  { mode: "grid", label: "网格排列", hint: "整齐的人物墙" },
  { mode: "cluster", label: "中心聚集", hint: "围绕中心的群像" },
  { mode: "random", label: "随机拼贴", hint: "允许重叠的混沌感" },
  { mode: "nooverlap", label: "避免重叠", hint: "每个人物都看得清" },
  { mode: "custom", label: "自定义", hint: "自己定列数、间距和大小" },
];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function overlaps(a: Rect, b: Rect, gap: number): boolean {
  return !(
    a.x + a.width + gap <= b.x ||
    b.x + b.width + gap <= a.x ||
    a.y + a.height + gap <= b.y ||
    b.y + b.height + gap <= a.y
  );
}

function clampInside(rect: Rect, frame: Size, padding: number): Rect {
  const maxX = Math.max(padding, frame.width - padding - rect.width);
  const maxY = Math.max(padding, frame.height - padding - rect.height);
  return {
    ...rect,
    x: Math.min(maxX, Math.max(padding, rect.x)),
    y: Math.min(maxY, Math.max(padding, rect.y)),
  };
}

/**
 * Computes non-stacked positions for freshly imported pictures.
 * Every rect is guaranteed to sit inside the frame (or a sane world area for
 * free-canvas projects), so nobody ends up lost outside the viewport.
 */
export function layoutElements(sizes: Size[], frame: Size, options: LayoutOptions): Rect[] {
  const n = sizes.length;
  if (n === 0) return [];

  const padding = options.padding ?? Math.max(24, Math.min(frame.width, frame.height) * 0.04);
  const availableW = Math.max(120, frame.width - padding * 2);
  const availableH = Math.max(120, frame.height - padding * 2);
  const baseHeight =
    options.baseHeight && options.baseHeight > 0
      ? options.baseHeight
      : Math.max(90, Math.min(availableH * 0.5, Math.min(availableH / Math.ceil(Math.sqrt(n)), 460)));

  const aspect = (s: Size) => (s.width > 0 && s.height > 0 ? s.width / s.height : 1);
  const sized = sizes.map((s) => {
    const h = Math.min(baseHeight, availableH);
    const w = Math.min(h * aspect(s), availableW);
    return { width: w, height: h };
  });

  const seed = options.seed ?? 20240607;
  const rand = mulberry32(seed);

  const gridRects = (colsOverride?: number): Rect[] => {
    const cols =
      colsOverride ??
      options.columns ??
      Math.max(1, Math.round(Math.sqrt((n * availableW) / Math.max(1, availableH))));
    const colCount = Math.max(1, Math.min(n, cols));
    const rows = Math.ceil(n / colCount);
    const gap = options.gap ?? Math.max(10, padding * 0.5);
    const cellW = (availableW - gap * (colCount - 1)) / colCount;
    const cellH = (availableH - gap * (rows - 1)) / rows;
    return sized.map((s, i) => {
      const c = i % colCount;
      const r = Math.floor(i / colCount);
      const fit = Math.min(1, cellW / s.width, cellH / s.height);
      const w = s.width * fit;
      const h = s.height * fit;
      return {
        x: padding + c * (cellW + gap) + (cellW - w) / 2,
        y: padding + r * (cellH + gap) + (cellH - h) / 2,
        width: w,
        height: h,
      };
    });
  };

  const scattered = (strict: boolean): Rect[] => {
    const placed: Rect[] = [];
    const gap = Math.max(6, padding * 0.25);
    for (let i = 0; i < n; i++) {
      const s = sized[i];
      let candidate: Rect | null = null;
      const attempts = strict ? 240 : 90;
      for (let t = 0; t < attempts; t++) {
        const x = padding + rand() * Math.max(0, frame.width - padding * 2 - s.width);
        const y = padding + rand() * Math.max(0, frame.height - padding * 2 - s.height);
        const rect = { x, y, width: s.width, height: s.height };
        const collision = placed.some((p) => overlaps(p, rect, strict ? gap : -gap * 0.2));
        if (!collision) {
          candidate = rect;
          break;
        }
      }
      if (!candidate) {
        // fall back to a grid slot but nudge it a little so it never stacks exactly
        const fallback = gridRects()[i];
        candidate = clampInside(
          {
            ...fallback,
            x: fallback.x + (rand() - 0.5) * 12,
            y: fallback.y + (rand() - 0.5) * 12,
          },
          frame,
          padding,
        );
      }
      placed.push(candidate);
    }
    return placed;
  };

  switch (options.mode) {
    case "grid":
      return gridRects();
    case "custom": {
      const rects = gridRects();
      const jitter = Math.max(0, Math.min(1, options.overlap ?? 0));
      if (jitter === 0) return rects;
      const gap = options.gap ?? 24;
      return rects.map((r) => {
        const dx = (rand() - 0.5) * jitter * gap * 4;
        const dy = (rand() - 0.5) * jitter * gap * 4;
        return clampInside({ ...r, x: r.x + dx, y: r.y + dy }, frame, padding);
      });
    }
    case "cluster": {
      const cx = frame.width / 2;
      const cy = frame.height / 2;
      const maxR = Math.min(availableW, availableH) / 2 - Math.max(...sized.map((s) => s.width / 2));
      return sized.map((s, i) => {
        if (i === 0) {
          return clampInside(
            { x: cx - s.width / 2, y: cy - s.height / 2, ...s },
            frame,
            padding,
          );
        }
        const perRing = Math.max(5, Math.floor((2 * Math.PI * Math.max(80, maxR)) / (Math.max(...sized.map((z) => z.width)) || 200)));
        const ring = Math.floor((i - 1) / perRing);
        const inRing = (i - 1) % perRing;
        const count = Math.min(perRing, n - 1 - ring * perRing);
        const radius = Math.max(80, maxR) * ((ring + 1) / (Math.ceil((n - 1) / perRing) + 0.2));
        const angle = (inRing / Math.max(1, count)) * Math.PI * 2 + ring * 0.6;
        const x = cx + Math.cos(angle) * radius - s.width / 2;
        const y = cy + Math.sin(angle) * radius - s.height / 2;
        return clampInside({ x, y, ...s }, frame, padding);
      });
    }
    case "random": {
      const jitter = options.overlap ?? 0.6;
      return sized.map((s) => {
        const rect = {
          x: padding + rand() * Math.max(0, frame.width - padding * 2 - s.width),
          y: padding + rand() * Math.max(0, frame.height - padding * 2 - s.height),
          width: s.width,
          height: s.height,
        };
        return clampInside(
          {
            ...rect,
            x: rect.x + (rand() - 0.5) * s.width * jitter * 0.4,
            y: rect.y + (rand() - 0.5) * s.height * jitter * 0.4,
          },
          frame,
          padding,
        );
      });
    }
    case "nooverlap":
      return scattered(true);
    case "scatter":
    default:
      return scattered(false);
  }
}

export const CANVAS_PRESETS: { id: string; label: string; width: number; height: number; hint: string }[] = [
  { id: "16:9", label: "横向 16:9", width: 1600, height: 900, hint: "桌面 / X / YouTube" },
  { id: "9:16", label: "竖向 9:16", width: 900, height: 1600, hint: "手机 / 快拍 / 抖音" },
  { id: "1:1", label: "方形 1:1", width: 1200, height: 1200, hint: "朋友圈 / Instagram" },
  { id: "4:5", label: "竖向 4:5", width: 1080, height: 1350, hint: "小红书 / 微博" },
];
