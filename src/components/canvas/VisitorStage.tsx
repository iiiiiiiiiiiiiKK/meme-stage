import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Stage, Layer, Rect } from "react-konva";
import Konva from "konva";
import { ElementNode, type NodeRegistry, type PulseSignal } from "./ElementNode";
import type { BubblePlacement, BubbleStyle, CanvasElement, ProjectData, VoiceClip } from "../../lib/types";
import { InteractionRunner, type RuntimeHooks } from "../../lib/engine";
import { audioEngine } from "../../lib/audio";
import { chooseVoice } from "../../lib/voice";
import { bubbleAnchorPoint } from "../../lib/bubblePosition";
import { DEFAULT_BUBBLE_PLACEMENT } from "../../lib/defaults";
import { fitViewport, frameBounds, worldToScreen, zoomAt, type Viewport } from "../../lib/geometry";
import { makeBubble } from "../../lib/defaults";
import { Icon } from "../Icon";

interface BubbleItem {
  key: string;
  elementId: string;
  text: string;
  style: BubbleStyle;
  name: string;
  until: number;
}

interface BubbleView extends BubbleItem {
  x: number;
  y: number;
  below: boolean;
  maxWidth: number;
  tx: string;
  ty: string;
  placement: BubblePlacement | undefined;
}

export interface VisitorStageProps {
  project: ProjectData;
  compact?: boolean;
  allowViewport?: boolean;
  autoTriggerId?: string | null;
  /** editor preview passes this so bubbles can be dragged into place */
  onBubbleMove?: (elementId: string, placement: BubblePlacement) => void;
  onFirstInteraction?: () => void;
  onError?: (message: string) => void;
  className?: string;
}

export function VisitorStage({
  project,
  compact = false,
  allowViewport = true,
  autoTriggerId = null,
  onBubbleMove,
  onFirstInteraction,
  onError,
  className,
}: VisitorStageProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const registry = useRef<NodeRegistry>(new Map());
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, scale: 1 });
  const [pulses, setPulses] = useState<Record<string, PulseSignal>>({});
  const [bubbles, setBubbles] = useState<BubbleItem[]>([]);
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [offsets, setOffsets] = useState<Record<string, { x: number; y: number }>>({});
  const [flash, setFlash] = useState(0);
  const [interacted, setInteracted] = useState(false);
  const [hintVisible, setHintVisible] = useState(true);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const voiceCursors = useRef<Map<string, number>>(new Map());
  const bubbleDrag = useRef<{
    id: string;
    startX: number;
    startY: number;
    ox: number;
    oy: number;
    placement: BubblePlacement;
  } | null>(null);
  const [draggingBubble, setDraggingBubble] = useState<string | null>(null);
  const projectRef = useRef(project);
  projectRef.current = project;
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const pinchRef = useRef<{ distance: number; scale: number; mid: { x: number; y: number } } | null>(null);
  const dragRef = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  /* --------------------------------------------------------------- layout */
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

  const fit = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const bounds = projectRef.current.mode === "free"
      ? { x: 0, y: 0, width: projectRef.current.width, height: projectRef.current.height }
      : frameBounds(projectRef.current);
    setViewport(fitViewport({ width: rect.width, height: rect.height }, bounds, compact ? 12 : 24, 1.4));
  }, [compact]);

  useEffect(() => {
    if (size.width > 0 && size.height > 0) fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.width, size.height, project.width, project.height]);

  useEffect(() => {
    if (size.width === 0) return;
    const t = setTimeout(fit, 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.mode]);

  const clearBubbles = useCallback(() => {
    for (const timer of timers.current.values()) clearTimeout(timer);
    timers.current.clear();
    setBubbles([]);
  }, []);

  useEffect(() => () => clearBubbles(), [clearBubbles]);

  /* -------------------------------------------------------------- runtime */
  const hooks = useMemo<RuntimeHooks>(
    () => ({
      getProject: () => projectRef.current,
      getElement: (id) => projectRef.current.elements.find((el) => el.id === id),
      nextVoice: (el: CanvasElement, clipId?: string) => {
        const voices = el.character?.voices ?? [];
        const last = voiceCursors.current.get(el.id) ?? -1;
        const picked = chooseVoice(voices, el.character?.voiceMode ?? "cycle", last, clipId);
        if (!picked) return null;
        voiceCursors.current.set(el.id, picked.index);
        return picked.clip;
      },
      playVoice: async (_el: CanvasElement, clip: VoiceClip) => {
        if (!clip?.url) return;
        await audioEngine.play(clip, projectRef.current.settings.audioMode);
      },
      showBubble: (el, text, holdSeconds) => {
        const style = el.character?.bubble ?? el.text?.style ?? makeBubble("comic");
        const key = `${el.id}-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
        const name = el.character?.name ?? "";
        setBubbles((prev) => [...prev.filter((b) => b.elementId !== el.id), { key, elementId: el.id, text, style, name, until: Date.now() + holdSeconds * 1000 }].slice(-4));
        const existing = timers.current.get(el.id);
        if (existing) clearTimeout(existing);
        const timer = setTimeout(() => {
          setBubbles((prev) => prev.filter((b) => b.key !== key));
          timers.current.delete(el.id);
        }, Math.max(900, holdSeconds * 1000));
        timers.current.set(el.id, timer);
      },
      hideBubble: (elId) => {
        setBubbles((prev) => prev.filter((b) => b.elementId !== elId));
        const timer = timers.current.get(elId);
        if (timer) clearTimeout(timer);
        timers.current.delete(elId);
      },
      animate: (el, animation) => {
        setPulses((prev) => ({ ...prev, [el.id]: { anim: animation, tick: Date.now() } }));
      },
      setHidden: (el, value) => setHidden((prev) => ({ ...prev, [el.id]: value })),
      moveBy: (el, dx, dy) =>
        setOffsets((prev) => {
          const current = prev[el.id] ?? { x: 0, y: 0 };
          return { ...prev, [el.id]: { x: current.x + dx, y: current.y + dy } };
        }),
      flash: () => setFlash(Date.now()),
      wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      onError: (message) => onError?.(message),
    }),
    [onError],
  );

  const runnerRef = useRef<InteractionRunner | null>(null);
  useEffect(() => {
    runnerRef.current = new InteractionRunner(hooks);
  }, [hooks]);

  useEffect(() => {
    audioEngine.onError = (message) => onError?.(message);
    return () => {
      audioEngine.stop();
      audioEngine.onError = null;
    };
  }, [onError]);

  const trigger = useCallback(
    (id: string) => {
      const el = projectRef.current.elements.find((item) => item.id === id);
      if (!el || el.locked) return;
      setInteracted(true);
      onFirstInteraction?.();
      clearBubbles();
      runnerRef.current?.trigger(id);
    },
    [clearBubbles, onFirstInteraction],
  );

  useEffect(() => {
    if (!autoTriggerId) return;
    const timer = setTimeout(() => trigger(autoTriggerId), 420);
    return () => clearTimeout(timer);
  }, [autoTriggerId, trigger]);

  useEffect(() => {
    if (!draggingBubble) return;
    const onMove = (e: PointerEvent) => {
      const drag = bubbleDrag.current;
      if (!drag) return;
      const dx = (e.clientX - drag.startX) / viewportRef.current.scale;
      const dy = (e.clientY - drag.startY) / viewportRef.current.scale;
      onBubbleMove?.(drag.id, {
        ...drag.placement,
        offsetX: Math.round(drag.ox + dx),
        offsetY: Math.round(drag.oy + dy),
      });
    };
    const onUp = () => {
      const drag = bubbleDrag.current;
      if (drag) {
        const existing = timers.current.get(drag.id);
        if (existing) clearTimeout(existing);
        const timer = setTimeout(() => {
          setBubbles((prev) => prev.filter((b) => b.elementId !== drag.id));
          timers.current.delete(drag.id);
        }, 2600);
        timers.current.set(drag.id, timer);
      }
      bubbleDrag.current = null;
      setDraggingBubble(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [draggingBubble, onBubbleMove]);

  const startBubbleDrag = (e: ReactPointerEvent, view: BubbleView) => {
    if (!onBubbleMove) return;
    e.preventDefault();
    e.stopPropagation();
    const timer = timers.current.get(view.elementId);
    if (timer) clearTimeout(timer);
    timers.current.delete(view.elementId);
    const placement = view.placement ?? { ...DEFAULT_BUBBLE_PLACEMENT };
    bubbleDrag.current = {
      id: view.elementId,
      startX: e.clientX,
      startY: e.clientY,
      ox: placement.offsetX,
      oy: placement.offsetY,
      placement,
    };
    setDraggingBubble(view.elementId);
  };

  /* --------------------------------------------------------- viewport i/o */
  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    if (!allowViewport) return;
    e.evt.preventDefault();
    const stage = e.target.getStage();
    const pointer = stage?.getPointerPosition();
    if (!pointer) return;
    setViewport((v) => zoomAt(v, pointer.x, pointer.y, v.scale * Math.exp(-e.evt.deltaY * 0.0018)));
  };

  const onTouchStart = (e: Konva.KonvaEventObject<TouchEvent>) => {
    if (!allowViewport) return;
    const touches = e.evt.touches;
    if (touches.length === 2) {
      const rect = containerRef.current!.getBoundingClientRect();
      const [a, b] = [touches[0], touches[1]];
      pinchRef.current = {
        distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        scale: viewportRef.current.scale,
        mid: { x: (a.clientX + b.clientX) / 2 - rect.left, y: (a.clientY + b.clientY) / 2 - rect.top },
      };
    } else if (touches.length === 1) {
      const rect = containerRef.current!.getBoundingClientRect();
      dragRef.current = {
        x: touches[0].clientX - rect.left,
        y: touches[0].clientY - rect.top,
        vx: viewportRef.current.x,
        vy: viewportRef.current.y,
      };
    }
  };

  const onTouchMove = (e: Konva.KonvaEventObject<TouchEvent>) => {
    if (!allowViewport) return;
    const touches = e.evt.touches;
    if (touches.length === 2 && pinchRef.current) {
      e.evt.preventDefault();
      const [a, b] = [touches[0], touches[1]];
      const rect = containerRef.current!.getBoundingClientRect();
      const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const mid = { x: (a.clientX + b.clientX) / 2 - rect.left, y: (a.clientY + b.clientY) / 2 - rect.top };
      setViewport((v) => {
        const zoomed = zoomAt(v, pinchRef.current!.mid.x, pinchRef.current!.mid.y, pinchRef.current!.scale * (distance / pinchRef.current!.distance));
        return { ...zoomed, x: zoomed.x + (mid.x - pinchRef.current!.mid.x), y: zoomed.y + (mid.y - pinchRef.current!.mid.y) };
      });
    } else if (touches.length === 1 && dragRef.current) {
      e.evt.preventDefault();
      const rect = containerRef.current!.getBoundingClientRect();
      const x = touches[0].clientX - rect.left;
      const y = touches[0].clientY - rect.top;
      const start = dragRef.current;
      setViewport((v) => ({ ...v, x: start.vx + (x - start.x), y: start.vy + (y - start.y) }));
    }
  };

  const onTouchEnd = () => {
    pinchRef.current = null;
    dragRef.current = null;
  };

  const visible = useMemo(
    () =>
      [...project.elements]
        .filter((el) => !el.hidden && !hidden[el.id])
        .sort((a, b) => a.z - b.z),
    [project.elements, hidden],
  );

  const bubbleViews = useMemo(() => {
    return bubbles
      .map((bubble) => {
        const el = project.elements.find((el) => el.id === bubble.elementId);
        if (!el || el.type !== "character") return null;
        const offset = offsets[el.id] ?? { x: 0, y: 0 };
        const placement = el.character?.bubblePlacement;
        const auto = !placement || placement.anchor === "auto";
        let anchor = bubbleAnchorPoint(el, placement, offset, false);
        let screen = worldToScreen(viewport, anchor.x, anchor.y);
        // only auto-flip when the author has not explicitly offset the bubble
        if (auto && (placement?.offsetY ?? 0) === 0 && screen.y < 150) {
          anchor = bubbleAnchorPoint(el, placement, offset, true);
          screen = worldToScreen(viewport, anchor.x, anchor.y);
        }
        const gap = 8;
        const x = screen.x + (anchor.tx === "-100%" ? -gap : anchor.tx === "0%" ? gap : 0);
        const y = screen.y + (anchor.ty === "-100%" ? -gap : anchor.ty === "0%" ? gap : 0);
        const maxWidth = Math.min(
          placement?.maxWidth ?? 300,
          Math.max(160, (size.width || 360) - 24),
        );
        return {
          ...bubble,
          x,
          y,
          below: anchor.below,
          maxWidth,
          tx: anchor.tx,
          ty: anchor.ty,
          elementId: el.id,
          placement,
        };
      })
      .filter((item): item is BubbleView => item !== null);
  }, [bubbles, project.elements, viewport, offsets, size.width]);

  const hasVoices = project.elements.some((el) => (el.character?.voices.length ?? 0) > 0);

  return (
    <div
      ref={containerRef}
      data-testid="visitor"
      className={`relative h-full w-full overflow-hidden ${className ?? ""}`}
      onClick={() => {
        if (!interacted) {
          setInteracted(true);
          onFirstInteraction?.();
        }
        setHintVisible(false);
        audioEngine.markUnlocked();
      }}
    >
      {size.width > 0 ? (
        <Stage
          width={size.width}
          height={size.height}
          x={viewport.x}
          y={viewport.y}
          scaleX={viewport.scale}
          scaleY={viewport.scale}
          onWheel={onWheel}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          <Layer listening={false}>
            <Rect
              x={0}
              y={0}
              width={project.width}
              height={project.height}
              fill={project.background.color}
              cornerRadius={compact ? 10 : 0}
            />
          </Layer>
          <Layer>
            {visible.map((el) => {
              const offset = offsets[el.id] ?? { x: 0, y: 0 };
              return (
                <ElementNode
                  key={el.id}
                  el={{ ...el, x: el.x + offset.x, y: el.y + offset.y }}
                  interactive
                  pulse={pulses[el.id] ?? null}
                  registry={registry.current}
                  onClickElement={trigger}
                />
              );
            })}
          </Layer>
        </Stage>
      ) : null}

      {bubbleViews.map((bubble) =>
        bubble ? (
          <Bubble
            key={bubble.key}
            bubble={bubble}
            maxWidth={bubble.maxWidth}
            compact={compact}
            draggable={!!onBubbleMove}
            dragging={draggingBubble === bubble.elementId}
            onPointerDown={(e) => startBubbleDrag(e, bubble)}
          />
        ) : null,
      )}

      {flash ? (
        <div
          key={flash}
          className="pointer-events-none absolute inset-0 bg-white"
          style={{ animation: "flash-out 0.26s ease-out forwards" }}
        />
      ) : null}

      {hintVisible && hasVoices && !compact ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center">
          <div className="pop-in flex items-center gap-2 rounded-full border border-neon/40 bg-ink/85 px-4 py-2 text-[12px] text-paper shadow-lg backdrop-blur">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-neon opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-neon" />
            </span>
            {project.settings.soundHint || "轻点人物，听他们开口"}
          </div>
        </div>
      ) : null}

      {allowViewport ? (
        <div className="absolute bottom-3 right-3 flex flex-col gap-1">
          <button
            type="button"
            aria-label="放大"
            className="grid h-8 w-8 place-items-center rounded-md border border-line bg-ink/85 text-mute backdrop-blur hover:text-paper"
            onClick={(e) => {
              e.stopPropagation();
              setViewport((v) => zoomAt(v, size.width / 2, size.height / 2, v.scale * 1.25));
            }}
          >
            <Icon name="zoom-in" size={15} />
          </button>
          <button
            type="button"
            aria-label="缩小"
            className="grid h-8 w-8 place-items-center rounded-md border border-line bg-ink/85 text-mute backdrop-blur hover:text-paper"
            onClick={(e) => {
              e.stopPropagation();
              setViewport((v) => zoomAt(v, size.width / 2, size.height / 2, v.scale / 1.25));
            }}
          >
            <Icon name="zoom-out" size={15} />
          </button>
          <button
            type="button"
            aria-label="重置视图"
            className="grid h-8 w-8 place-items-center rounded-md border border-line bg-ink/85 text-mute backdrop-blur hover:text-paper"
            onClick={(e) => {
              e.stopPropagation();
              fit();
            }}
          >
            <Icon name="fit" size={15} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function hexToRgba(hex: string, alpha: number): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return `rgba(0,0,0,${alpha})`;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function Bubble({
  bubble,
  maxWidth,
  compact,
  draggable,
  dragging,
  onPointerDown,
}: {
  bubble: BubbleView;
  maxWidth: number;
  compact: boolean;
  draggable?: boolean;
  dragging?: boolean;
  onPointerDown?: (event: ReactPointerEvent) => void;
}) {
  const { style } = bubble;
  const fontSize = Math.min(compact ? 15 : 18, Math.max(12, style.fontSize * 0.55));
  const radius = Math.min(style.radius, 20);
  return (
    <div
      className={`absolute z-10 ${draggable ? "pointer-events-auto cursor-move touch-none" : "pointer-events-none"}`}
      style={{
        left: bubble.x,
        top: bubble.y,
        transform: `translate(${bubble.tx}, ${bubble.ty})`,
        maxWidth,
      }}
      onPointerDown={onPointerDown}
      title={draggable ? "拖动气泡，调整台词位置" : undefined}
    >
      <div className="bubble-in">
        <div
          className="relative px-3 py-2 shadow-[3px_3px_0_0_rgba(0,0,0,0.85)]"
          style={{
            background: style.bg,
            color: style.fg,
            border:
              style.borderWidth > 0
                ? `${Math.min(4, Math.max(2, style.borderWidth))}px solid ${style.border}`
                : "none",
            borderRadius: radius,
            fontSize,
            fontWeight: style.bold ? 800 : 500,
            fontStyle: style.italic ? "italic" : "normal",
            lineHeight: 1.35,
            textAlign: "center",
            outline: dragging ? "2px dashed #b6ff3c" : undefined,
            outlineOffset: 3,
          }}
        >
          {bubble.name && !compact ? (
            <div
              className="mb-0.5 text-[9px] font-bold uppercase tracking-widest"
              style={{ color: hexToRgba(style.fg, 0.55) }}
            >
              {bubble.name}
            </div>
          ) : null}
          {bubble.text}
          {style.tail === "bottom" ? (
            <span
              className="absolute left-1/2 h-3 w-3 -translate-x-1/2 rotate-45"
              style={{
                bottom: -7,
                background: style.bg,
                borderRight: style.borderWidth > 0 ? `2px solid ${style.border}` : "none",
                borderBottom: style.borderWidth > 0 ? `2px solid ${style.border}` : "none",
              }}
            />
          ) : null}
          {draggable ? (
            <span className="absolute -right-2.5 -top-2.5 grid h-5 w-5 place-items-center rounded-full border border-neon/60 bg-ink text-neon">
              <Icon name="move" size={10} />
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
