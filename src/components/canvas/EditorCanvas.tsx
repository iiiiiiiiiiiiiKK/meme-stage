import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Stage, Layer, Rect, Line, Transformer, Image as KonvaImage } from "react-konva";
import Konva from "konva";
import { useEditor } from "../../store/editor";
import {
  clamp,
  contentBounds,
  fitViewport,
  frameBounds,
  MAX_SCALE,
  MIN_SCALE,
  snapPosition,
  zoomAt,
  type Bounds,
  type Viewport,
} from "../../lib/geometry";
import type { CanvasElement } from "../../lib/types";
import { ElementNode, type NodeRegistry } from "./ElementNode";
import { IconButton } from "../ui";
import { Icon } from "../Icon";
import { loadImage } from "../../lib/image";

interface Marquee {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Gesture {
  type: "pan" | "marquee";
  startScreen: { x: number; y: number };
  startViewport: Viewport;
  startWorld: { x: number; y: number };
  additive: boolean;
  moved: boolean;
}

interface DragBase {
  primaryId: string;
  start: Record<string, { x: number; y: number; w: number; h: number; nx: number; ny: number }>;
}

export interface EditorCanvasHandle {
  exportFrame: (targetWidth: number) => Promise<string>;
}

const boundsOf = (el: CanvasElement): Bounds => ({
  x: el.x,
  y: el.y,
  width: el.width,
  height: el.height,
});

export const EditorCanvas = forwardRef<EditorCanvasHandle>(function EditorCanvas(_props, ref) {
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  const viewport = useEditor((s) => s.viewport);
  const fitTick = useEditor((s) => s.fitTick);
  const focusTick = useEditor((s) => s.focusTick);
  const setViewport = useEditor((s) => s.setViewport);
  const select = useEditor((s) => s.select);
  const selectMany = useEditor((s) => s.selectMany);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const transformerRef = useRef<Konva.Transformer | null>(null);
  const overlayLayerRef = useRef<Konva.Layer | null>(null);
  const registry = useRef<NodeRegistry>(new Map());
  const gesture = useRef<Gesture | null>(null);
  const dragBase = useRef<DragBase | null>(null);
  const spaceRef = useRef(false);
  const altRef = useRef(false);
  const pinchRef = useRef<{ distance: number; scale: number; mid: { x: number; y: number } } | null>(null);
  const clipboard = useRef<CanvasElement[]>([]);
  const initialized = useRef(false);

  const [size, setSize] = useState({ width: 0, height: 0 });
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] });
  const [spacePressed, setSpacePressed] = useState(false);
  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null);
  const [exporting, setExporting] = useState(false);

  const sorted = useMemo(() => [...project.elements].sort((a, b) => a.z - b.z), [project.elements]);
  const selectionSet = useMemo(() => new Set(selection), [selection]);

  /* ---------------------------------------------------------------- sizing */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      setSize({ width: Math.max(1, Math.floor(rect.width)), height: Math.max(1, Math.floor(rect.height)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fitAll = useCallback(
    (padding = 56, maxScale = 1.6) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setViewport(fitViewport({ width: rect.width, height: rect.height }, frameBounds(project), padding, maxScale));
    },
    [project, setViewport],
  );

  useEffect(() => {
    if (size.width > 0 && size.height > 0 && !initialized.current) {
      initialized.current = true;
      fitAll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.width, size.height]);

  useEffect(() => {
    if (fitTick > 0 && size.width > 0) fitAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitTick]);

  useEffect(() => {
    if (focusTick === 0) return;
    const els = project.elements.filter((el) => selection.includes(el.id));
    if (els.length === 0) return;
    const b = contentBounds(els);
    setViewport(fitViewport({ width: size.width, height: size.height }, b, 140, 1.4));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTick]);

  /* ------------------------------------------------------------- background */
  useEffect(() => {
    let alive = true;
    if (project.background.type === "image" && project.background.url) {
      loadImage(project.background.url)
        .then((img) => alive && setBgImage(img))
        .catch(() => alive && setBgImage(null));
    } else {
      setBgImage(null);
    }
    return () => {
      alive = false;
    };
  }, [project.background.type, project.background.url]);

  /* --------------------------------------------------------------- pointer */
  const screenPoint = (e: { clientX: number; clientY: number }) => {
    const rect = containerRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const beginGesture = useCallback(
    (type: "pan" | "marquee", clientX: number, clientY: number, additive: boolean) => {
      const p = screenPoint({ clientX, clientY });
      const v = useEditor.getState().viewport;
      gesture.current = {
        type,
        startScreen: p,
        startViewport: { ...v },
        startWorld: { x: (p.x - v.x) / v.scale, y: (p.y - v.y) / v.scale },
        additive,
        moved: false,
      };
    },
    [],
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const g = gesture.current;
      if (!g) return;
      const p = screenPoint(e);
      const dx = p.x - g.startScreen.x;
      const dy = p.y - g.startScreen.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) g.moved = true;
      if (g.type === "pan") {
        setViewport({ ...g.startViewport, x: g.startViewport.x + dx, y: g.startViewport.y + dy });
      } else {
        const v = g.startViewport;
        const world = {
          x: (Math.min(p.x, g.startScreen.x) - v.x) / v.scale,
          y: (Math.min(p.y, g.startScreen.y) - v.y) / v.scale,
          width: Math.abs(dx) / v.scale,
          height: Math.abs(dy) / v.scale,
        };
        setMarquee(world);
      }
    };
    const onUp = (e: PointerEvent) => {
      const g = gesture.current;
      if (!g) return;
      gesture.current = null;
      if (g.type === "marquee") {
        const v = g.startViewport;
        const p = screenPoint(e);
        const rect = {
          x: (Math.min(p.x, g.startScreen.x) - v.x) / v.scale,
          y: (Math.min(p.y, g.startScreen.y) - v.y) / v.scale,
          width: Math.abs(p.x - g.startScreen.x) / v.scale,
          height: Math.abs(p.y - g.startScreen.y) / v.scale,
        };
        setMarquee(null);
        const state = useEditor.getState();
        if (rect.width < 6 || rect.height < 6) {
          if (!g.additive) selectMany([]);
          return;
        }
        const hits = state.project.elements
          .filter(
            (el) =>
              !el.hidden &&
              !(el.x + el.width <= rect.x || rect.x + rect.width <= el.x) &&
              !(el.y + el.height <= rect.y || rect.y + rect.height <= el.y),
          )
          .map((el) => el.id);
        if (g.additive) selectMany([...new Set([...state.selection, ...hits])]);
        else selectMany(hits);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [setViewport, selectMany]);

  const onStageDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.target !== e.target.getStage()) return;
    if (e.evt.button !== 0 && e.evt.button !== 1) return;
    e.evt.preventDefault();
    const pan = e.evt.button === 1 || spaceRef.current || e.evt.altKey;
    beginGesture(pan ? "pan" : "marquee", e.evt.clientX, e.evt.clientY, e.evt.shiftKey);
  };

  const onStageTouchStart = (e: Konva.KonvaEventObject<TouchEvent>) => {
    const touches = e.evt.touches;
    if (touches.length === 2) {
      e.evt.preventDefault();
      gesture.current = null;
      setMarquee(null);
      const rect = containerRef.current!.getBoundingClientRect();
      const [a, b] = [touches[0], touches[1]];
      const mid = { x: (a.clientX + b.clientX) / 2 - rect.left, y: (a.clientY + b.clientY) / 2 - rect.top };
      pinchRef.current = {
        distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        scale: useEditor.getState().viewport.scale,
        mid,
      };
      return;
    }
    if (e.target !== e.target.getStage()) return;
    beginGesture("pan", e.evt.touches[0].clientX, e.evt.touches[0].clientY, false);
  };

  const onStageTouchMove = (e: Konva.KonvaEventObject<TouchEvent>) => {
    const touches = e.evt.touches;
    const pinch = pinchRef.current;
    if (touches.length === 2 && pinch) {
      e.evt.preventDefault();
      const [a, b] = [touches[0], touches[1]];
      const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const rect = containerRef.current!.getBoundingClientRect();
      const mid = { x: (a.clientX + b.clientX) / 2 - rect.left, y: (a.clientY + b.clientY) / 2 - rect.top };
      const v = useEditor.getState().viewport;
      const scaled = zoomAt(v, pinch.mid.x, pinch.mid.y, pinch.scale * (distance / pinch.distance));
      setViewport({ ...scaled, x: scaled.x + (mid.x - pinch.mid.x), y: scaled.y + (mid.y - pinch.mid.y) });
      pinchRef.current = { ...pinch, distance };
    }
  };

  const onStageTouchEnd = () => {
    pinchRef.current = null;
  };

  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const v = useEditor.getState().viewport;
    const factor = Math.exp(-e.evt.deltaY * (e.evt.ctrlKey ? 0.0035 : 0.0016));
    const next = clamp(v.scale * factor, MIN_SCALE, MAX_SCALE);
    setViewport(zoomAt(v, pointer.x, pointer.y, next));
  };

  /* ---------------------------------------------------------------- dragging */
  const onDragStart = (id: string) => {
    const state = useEditor.getState();
    if (!state.selection.includes(id)) state.select(id);
    const selected = state.project.elements.filter((el) => state.selection.includes(el.id) || el.id === id);
    const start: DragBase["start"] = {};
    for (const el of selected) {
      start[el.id] = {
        x: el.x,
        y: el.y,
        w: el.width,
        h: el.height,
        nx: el.x + el.width / 2,
        ny: el.y + el.height / 2,
      };
    }
    dragBase.current = { primaryId: id, start };
  };

  const onDragMove = (id: string, node: Konva.Group) => {
    const base = dragBase.current;
    if (!base) return;
    const state = useEditor.getState();
    const el = state.project.elements.find((e) => e.id === id);
    if (!el) return;
    const b = base.start[id];
    if (!b) return;

    let centerX = node.x();
    let centerY = node.y();
    if (state.snapEnabled && !altRef.current && !spaceRef.current) {
      const others = state.project.elements
        .filter((other) => !base.start[other.id] && !other.hidden)
        .map(boundsOf);
      const snapped = snapPosition(
        { x: centerX - el.width / 2, y: centerY - el.height / 2, width: el.width, height: el.height },
        others,
        { x: 0, y: 0, width: state.project.width, height: state.project.height },
        7 / state.viewport.scale,
      );
      centerX = snapped.x + el.width / 2;
      centerY = snapped.y + el.height / 2;
      node.position({ x: centerX, y: centerY });
      setGuides({ x: snapped.guidesX, y: snapped.guidesY });
    } else if (guides.x.length || guides.y.length) {
      setGuides({ x: [], y: [] });
    }

    const dx = centerX - b.nx;
    const dy = centerY - b.ny;
    for (const [otherId, start] of Object.entries(base.start)) {
      if (otherId === id) continue;
      const other = registry.current.get(otherId);
      other?.position({ x: start.nx + dx, y: start.ny + dy });
    }
  };

  const onDragEnd = (id: string, node: Konva.Group) => {
    const base = dragBase.current;
    dragBase.current = null;
    setGuides({ x: [], y: [] });
    if (!base) return;
    const b = base.start[id];
    if (!b) return;
    const dx = node.x() - b.nx;
    const dy = node.y() - b.ny;
    if (dx === 0 && dy === 0) return;
    useEditor.getState().mutate((draft) => {
      for (const el of draft.elements) {
        const start = base.start[el.id];
        if (!start || el.locked) continue;
        el.x = Math.round(start.x + dx);
        el.y = Math.round(start.y + dy);
      }
    });
  };

  /* ------------------------------------------------------------- transformer */
  useEffect(() => {
    const tr = transformerRef.current;
    if (!tr) return;
    if (selection.length === 1 && !exporting) {
      const el = project.elements.find((e) => e.id === selection[0]);
      const node = registry.current.get(selection[0]);
      if (node && el && !el.locked) {
        tr.nodes([node]);
        tr.getLayer()?.batchDraw();
        return;
      }
    }
    tr.nodes([]);
  }, [selection, project.elements, exporting]);

  const onTransformEnd = (id: string, node: Konva.Group) => {
    const el = project.elements.find((item) => item.id === id);
    if (!el) return;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    const width = Math.max(24, Math.round(el.width * Math.abs(scaleX)));
    const height = Math.max(24, Math.round(el.height * Math.abs(scaleY)));
    node.scale({ x: 1, y: 1 });
    const centerX = node.x();
    const centerY = node.y();
    useEditor.getState().updateElement(id, {
      x: Math.round(centerX - width / 2),
      y: Math.round(centerY - height / 2),
      width,
      height,
      rotation: Math.round(node.rotation() * 10) / 10,
    });
  };

  /* --------------------------------------------------------------- keyboard */
  useEffect(() => {
    const isTyping = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        el.isContentEditable
      );
    };
    const onKeyDown = (e: KeyboardEvent) => {
      altRef.current = e.altKey;
      if (e.code === "Space" && !isTyping(e.target)) {
        spaceRef.current = true;
        setSpacePressed(true);
      }
      if (isTyping(e.target) || document.querySelector('[role="dialog"]')) return;
      if (document.body.dataset.mode === "preview") return;
      const state = useEditor.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) state.redo();
        else state.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        state.redo();
        return;
      }
      if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        state.duplicateSelected();
        return;
      }
      if (mod && e.key.toLowerCase() === "c") {
        clipboard.current = state.project.elements.filter((el) => state.selection.includes(el.id));
        return;
      }
      if (mod && e.key.toLowerCase() === "v") {
        if (clipboard.current.length === 0) return;
        e.preventDefault();
        const cloned = clipboard.current.map((el, i) => ({
          ...structuredClone(el),
          id: `el_${Math.random().toString(36).slice(2, 9)}${i}`,
          x: el.x + 40,
          y: el.y + 40,
        }));
        state.addElements(cloned);
        return;
      }
      if (mod && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        const v = state.viewport;
        state.setViewport(zoomAt(v, size.width / 2, size.height / 2, v.scale * 1.2));
        return;
      }
      if (mod && e.key === "-") {
        e.preventDefault();
        const v = state.viewport;
        state.setViewport(zoomAt(v, size.width / 2, size.height / 2, v.scale / 1.2));
        return;
      }
      if (mod && e.key === "0") {
        e.preventDefault();
        fitAll();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (state.selection.length) {
          e.preventDefault();
          state.removeSelected();
        }
        return;
      }
      if (e.key === "Escape") {
        state.selectMany([]);
        return;
      }
      if (e.key.startsWith("Arrow")) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const map: Record<string, [number, number]> = {
          ArrowLeft: [-step, 0],
          ArrowRight: [step, 0],
          ArrowUp: [0, -step],
          ArrowDown: [0, step],
        };
        const [dx, dy] = map[e.key] ?? [0, 0];
        state.moveSelected(dx, dy);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      altRef.current = e.altKey;
      if (e.code === "Space") {
        spaceRef.current = false;
        setSpacePressed(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [fitAll, size.height, size.width]);

  /* ----------------------------------------------------------------- export */
  useImperativeHandle(ref, () => ({
    exportFrame: async (targetWidth: number) => {
      const stage = stageRef.current;
      if (!stage) throw new Error("画布尚未准备好");
      setExporting(true);
      const state = useEditor.getState();
      const prevSelection = [...state.selection];
      state.selectMany([]);
      await Promise.all(
        state.project.elements.map((el) => {
          const url = el.type === "character" ? el.character?.imageUrl : el.image?.url;
          return url ? loadImage(url).catch(() => null) : Promise.resolve(null);
        }),
      );
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      const saved = {
        width: stage.width(),
        height: stage.height(),
        x: stage.x(),
        y: stage.y(),
        scale: stage.scaleX(),
      };
      const scale = targetWidth / state.project.width;
      stage.size({ width: targetWidth, height: Math.round(state.project.height * scale) });
      stage.position({ x: 0, y: 0 });
      stage.scale({ x: scale, y: scale });
      stage.batchDraw();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const dataUrl = stage.toDataURL({ pixelRatio: 1, mimeType: "image/png" });
      stage.size({ width: saved.width, height: saved.height });
      stage.position({ x: saved.x, y: saved.y });
      stage.scale({ x: saved.scale, y: saved.scale });
      stage.batchDraw();
      state.selectMany(prevSelection);
      setExporting(false);
      return dataUrl;
    },
  }));

  const cursor = spacePressed || gesture.current?.type === "pan" ? "cursor-grab" : "cursor-default";

  return (
    <div ref={containerRef} className={`relative h-full w-full overflow-hidden grid-bg ${cursor}`} data-testid="canvas">
      {size.width > 0 ? (
        <Stage
          ref={stageRef}
          width={size.width}
          height={size.height}
          x={viewport.x}
          y={viewport.y}
          scaleX={viewport.scale}
          scaleY={viewport.scale}
          onMouseDown={onStageDown}
          onTouchStart={onStageTouchStart}
          onTouchMove={onStageTouchMove}
          onTouchEnd={onStageTouchEnd}
          onWheel={onWheel}
        >
          <Layer listening={false}>
            <Rect
              x={0}
              y={0}
              width={project.width}
              height={project.height}
              fill={project.background.color}
              shadowColor="#000"
              shadowBlur={60}
              shadowOpacity={0.6}
              cornerRadius={project.mode === "free" ? 6 : 2}
            />
            {bgImage ? (
              <KonvaImage
                image={bgImage}
                x={0}
                y={0}
                width={project.width}
                height={project.height}
                listening={false}
              />
            ) : null}
            <Rect
              x={0}
              y={0}
              width={project.width}
              height={project.height}
              stroke={project.mode === "free" ? "#4d7cff" : "#b6ff3c"}
              strokeWidth={2 / viewport.scale}
              dash={project.mode === "free" ? [14 / viewport.scale, 10 / viewport.scale] : undefined}
              opacity={0.55}
              listening={false}
            />
          </Layer>

          <Layer>
            {sorted.map((el) =>
              el.hidden ? null : (
                <ElementNode
                  key={el.id}
                  el={el}
                  interactive
                  selected={selectionSet.has(el.id)}
                  registry={registry.current}
                  onSelect={(id, additive) => select(id, additive)}
                  onDragStart={onDragStart}
                  onDragMove={onDragMove}
                  onDragEnd={onDragEnd}
                  onTransformEnd={onTransformEnd}
                />
              ),
            )}
          </Layer>

          <Layer ref={overlayLayerRef} listening={false} visible={!exporting}>
            {guides.x.map((x, i) => (
              <Line
                key={`gx-${i}`}
                points={[x, 0, x, project.height]}
                stroke="#ff4d9d"
                strokeWidth={1 / viewport.scale}
                dash={[8 / viewport.scale, 6 / viewport.scale]}
              />
            ))}
            {guides.y.map((y, i) => (
              <Line
                key={`gy-${i}`}
                points={[0, y, project.width, y]}
                stroke="#ff4d9d"
                strokeWidth={1 / viewport.scale}
                dash={[8 / viewport.scale, 6 / viewport.scale]}
              />
            ))}
            {marquee ? (
              <Rect
                x={marquee.x}
                y={marquee.y}
                width={marquee.width}
                height={marquee.height}
                fill="rgba(182,255,60,0.08)"
                stroke="#b6ff3c"
                strokeWidth={1.5 / viewport.scale}
              />
            ) : null}
          </Layer>

          <Layer>
            <Transformer
              ref={transformerRef}
              rotateEnabled
              rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
              borderStroke="#b6ff3c"
              borderStrokeWidth={1.5}
              borderDash={[5, 4]}
              anchorStroke="#b6ff3c"
              anchorFill="#07070a"
              anchorSize={9 / Math.max(0.6, Math.min(1.4, viewport.scale))}
              anchorCornerRadius={2}
              rotateAnchorOffset={26}
              padding={4}
              boundBoxFunc={(oldBox, newBox) =>
                newBox.width < 20 || newBox.height < 20 ? oldBox : newBox
              }
            />
          </Layer>
        </Stage>
      ) : null}

      {project.elements.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
          <div className="rounded-xl border border-dashed border-neon/40 bg-ink/80 px-5 py-4 backdrop-blur">
            <div className="font-display text-lg text-neon">画布是空的</div>
            <p className="mt-1 max-w-[260px] text-[12px] leading-relaxed text-mute">
              一次导入 20 张人物图片，或从左侧示例里挑几个熟人，然后给他们配声音。
            </p>
          </div>
        </div>
      ) : null}

      <div className="absolute bottom-3 left-3 flex items-center gap-1 rounded-lg border border-line bg-ink/90 p-1 backdrop-blur">
        <IconButton
          icon="zoom-out"
          label="缩小"
          onClick={() => {
            const v = useEditor.getState().viewport;
            setViewport(zoomAt(v, size.width / 2, size.height / 2, v.scale / 1.2));
          }}
        />
        <button
          type="button"
          className="min-w-12 px-1 text-center text-[11px] font-semibold tabular-nums text-mute hover:text-paper"
          onClick={() => {
            const v = useEditor.getState().viewport;
            setViewport(zoomAt(v, size.width / 2, size.height / 2, 1));
          }}
          title="重置为 100%"
        >
          {Math.round(viewport.scale * 100)}%
        </button>
        <IconButton
          icon="zoom-in"
          label="放大"
          onClick={() => {
            const v = useEditor.getState().viewport;
            setViewport(zoomAt(v, size.width / 2, size.height / 2, v.scale * 1.2));
          }}
        />
        <div className="mx-1 h-5 w-px bg-line" />
        <IconButton icon="fit" label="适应画布（⌘0）" onClick={() => fitAll()} />
        <IconButton
          icon="target"
          label="定位到选中（⌘⇧F）"
          onClick={() => {
            if (selection.length === 0) return;
            const b = contentBounds(project.elements.filter((el) => selection.includes(el.id)));
            setViewport(
              fitViewport({ width: size.width, height: size.height }, b, Math.min(size.width, size.height) * 0.28, 1.6),
            );
          }}
        />
      </div>

      <div className="pointer-events-none absolute bottom-3 right-3 flex items-center gap-1.5 rounded-md border border-line bg-ink/80 px-2 py-1 text-[10px] text-mute backdrop-blur">
        <Icon name="users" size={11} />
        {project.elements.length} 个人物 · 缩放 {Math.round(viewport.scale * 100)}%
      </div>
    </div>
  );
});
