import { useEffect, useRef, useState } from "react";
import { Group, Image as KonvaImage, Rect, Text, Line } from "react-konva";
import Konva from "konva";
import type { AnimationName, CanvasElement } from "../../lib/types";
import { cachedImage, loadImage } from "../../lib/image";

export type NodeRegistry = Map<string, Konva.Group>;

export interface PulseSignal {
  anim: AnimationName;
  tick: number;
}

const fontFamily = (value: string) =>
  value === "display"
    ? 'Arial Black, Impact, "Haettenschweiler", sans-serif'
    : value === "mono"
      ? 'ui-monospace, "Cascadia Mono", Consolas, monospace'
      : 'ui-sans-serif, system-ui, "PingFang SC", "Microsoft YaHei", sans-serif';

function useSmartImage(fullUrl: string | undefined, thumbUrl: string | undefined, renderedWidth: number) {
  const [thumb, setThumb] = useState<HTMLImageElement | null>(() => cachedImage(thumbUrl ?? fullUrl));
  const [full, setFull] = useState<HTMLImageElement | null>(() => cachedImage(fullUrl));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    if (!fullUrl) return;
    const small = thumbUrl ?? fullUrl;
    if (!cachedImage(small)) {
      loadImage(small)
        .then((img) => alive && setThumb(img))
        .catch(() => alive && setFailed(true));
    }
    const loadFull = () => {
      if (cachedImage(fullUrl)) {
        setFull(cachedImage(fullUrl));
        return;
      }
      loadImage(fullUrl)
        .then((img) => alive && setFull(img))
        .catch(() => undefined);
    };
    const ric = (globalThis as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
      .requestIdleCallback;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const handle = ric ? ric(loadFull, { timeout: 1200 }) : null;
    if (!handle) timer = setTimeout(loadFull, 260);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      const cic = (globalThis as unknown as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback;
      if (handle && cic) cic(handle);
    };
  }, [fullUrl, thumbUrl]);

  const preferFull = renderedWidth >= 460;
  return { image: preferFull ? (full ?? thumb) : (thumb ?? full), failed };
}

const activeTweens = new WeakMap<Konva.Group, Konva.Tween>();

function tween(node: Konva.Group, params: Parameters<Konva.Group["to"]>[0]): Konva.Tween {
  activeTweens.get(node)?.destroy();
  const next = node.to(params);
  activeTweens.set(node, next);
  return next;
}

function applyPulse(node: Konva.Group, anim: AnimationName, base: { x: number; y: number; rotation: number }) {
  switch (anim) {
    case "bounce":
      tween(node, {
        scaleX: 1.09,
        scaleY: 1.09,
        duration: 0.1,
        onFinish: () =>
          tween(node, { scaleX: 1, scaleY: 1, duration: 0.26, easing: Konva.Easings.ElasticEaseOut }),
      });
      break;
    case "shake":
      tween(node, {
        x: base.x + 9,
        duration: 0.05,
        onFinish: () =>
          tween(node, {
            x: base.x - 9,
            duration: 0.06,
            onFinish: () => tween(node, { x: base.x, duration: 0.06 }),
          }),
      });
      break;
    case "spin":
      tween(node, {
        rotation: base.rotation + 360,
        duration: 0.55,
        easing: Konva.Easings.EaseInOut,
        onFinish: () => {
          node.rotation(base.rotation);
        },
      });
      break;
    case "pulse":
      tween(node, {
        scaleX: 1.06,
        scaleY: 1.06,
        duration: 0.12,
        onFinish: () =>
          tween(node, {
            scaleX: 1,
            scaleY: 1,
            duration: 0.12,
            onFinish: () => tween(node, { scaleX: 1.05, scaleY: 1.05, duration: 0.1 }),
          }),
      });
      break;
    case "pop":
    default:
      node.scale({ x: 0.62, y: 0.62 });
      tween(node, { scaleX: 1, scaleY: 1, duration: 0.28, easing: Konva.Easings.BackEaseOut });
      break;
  }
}

export interface ElementNodeProps {
  el: CanvasElement;
  interactive: boolean;
  selected?: boolean;
  hovered?: boolean;
  pulse?: PulseSignal | null;
  registry?: NodeRegistry;
  onSelect?: (id: string, additive: boolean) => void;
  onDoubleClick?: (id: string) => void;
  onDragStart?: (id: string) => void;
  onDragMove?: (id: string, node: Konva.Group) => void;
  onDragEnd?: (id: string, node: Konva.Group) => void;
  onTransformEnd?: (id: string, node: Konva.Group) => void;
  onClickElement?: (id: string) => void;
}

export function ElementNode({
  el,
  interactive,
  selected,
  pulse,
  registry,
  onSelect,
  onDoubleClick,
  onDragStart,
  onDragMove,
  onDragEnd,
  onTransformEnd,
  onClickElement,
}: ElementNodeProps) {
  const groupRef = useRef<Konva.Group | null>(null);
  const lastPointerAt = useRef(0);
  const center = { x: el.x + el.width / 2, y: el.y + el.height / 2 };
  const baseRef = useRef({ x: center.x, y: center.y, rotation: el.rotation });
  baseRef.current = { x: center.x, y: center.y, rotation: el.rotation };

  useEffect(() => {
    if (registry && groupRef.current) registry.set(el.id, groupRef.current);
    return () => {
      registry?.delete(el.id);
    };
  }, [registry, el.id]);

  useEffect(() => {
    if (!pulse || !groupRef.current) return;
    applyPulse(groupRef.current, pulse.anim, baseRef.current);
  }, [pulse?.tick, pulse?.anim]);

  const imageUrl =
    el.type === "character" ? el.character?.imageUrl : el.type === "image" ? el.image?.url : undefined;
  const thumbUrl =
    el.type === "character" ? el.character?.thumbUrl : el.type === "image" ? el.image?.thumbUrl : undefined;
  const { image, failed } = useSmartImage(imageUrl, thumbUrl, el.width);

  const shadow = el.character?.effects.shadow ?? el.type === "image";
  const glow = el.character?.effects.glow ?? null;
  const outline = el.character?.effects.outline ?? 0;

  const emitPointer = (evt: MouseEvent | TouchEvent) => {
    if (!interactive) return;
    // Konva fires both tap and click on touch devices — de-dupe the pair.
    const now = Date.now();
    if (now - lastPointerAt.current < 380) return;
    lastPointerAt.current = now;
    const additive = "shiftKey" in evt ? (evt as MouseEvent).shiftKey : false;
    onSelect?.(el.id, additive);
    if (!additive) onClickElement?.(el.id);
  };

  const groupProps = {
    id: el.id,
    x: center.x,
    y: center.y,
    rotation: el.rotation,
    opacity: el.opacity,
    draggable: interactive && !el.locked,
    listening: interactive,
    onClick: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      e.cancelBubble = true;
      emitPointer(e.evt);
    },
    onTap: (e: Konva.KonvaEventObject<TouchEvent>) => {
      e.cancelBubble = true;
      emitPointer(e.evt);
    },
    onDblClick: () => onDoubleClick?.(el.id),
    onDragStart: () => onDragStart?.(el.id),
    onDragMove: () => {
      if (groupRef.current) onDragMove?.(el.id, groupRef.current);
    },
    onDragEnd: () => {
      if (groupRef.current) onDragEnd?.(el.id, groupRef.current);
    },
    onTransformEnd: () => {
      if (groupRef.current) onTransformEnd?.(el.id, groupRef.current);
    },
  };

  return (
    <Group ref={groupRef} {...groupProps} name="element">
      {el.type === "text" && el.text ? (
        <TextBubble el={el} selected={!!selected} />
      ) : (
        <Group scaleX={el.flipX ? -1 : 1} scaleY={el.flipY ? -1 : 1}>
          {outline > 0 ? (
            <KonvaImage
              image={image ?? undefined}
              x={-el.width / 2}
              y={-el.height / 2}
              width={el.width}
              height={el.height}
              shadowColor="#f4f1e8"
              shadowBlur={outline * 2.2}
              shadowOpacity={1}
              shadowOffset={{ x: 0, y: 0 }}
              perfectDrawEnabled={false}
              listening={false}
            />
          ) : null}
          {glow ? (
            <KonvaImage
              image={image ?? undefined}
              x={-el.width / 2}
              y={-el.height / 2}
              width={el.width}
              height={el.height}
              shadowColor={glow}
              shadowBlur={34}
              shadowOpacity={0.85}
              shadowOffset={{ x: 0, y: 0 }}
              perfectDrawEnabled={false}
              listening={false}
            />
          ) : null}
          <KonvaImage
            image={image ?? undefined}
            x={-el.width / 2}
            y={-el.height / 2}
            width={el.width}
            height={el.height}
            shadowColor="#000000"
            shadowBlur={shadow ? 18 : 0}
            shadowOpacity={shadow ? 0.45 : 0}
            shadowOffset={shadow ? { x: 6, y: 10 } : { x: 0, y: 0 }}
            perfectDrawEnabled={false}
            imageSmoothingEnabled
          />
          {failed ? <ImageFallback width={el.width} height={el.height} /> : null}
        </Group>
      )}
      {selected ? (
        <Rect
          x={-el.width / 2 - 2}
          y={-el.height / 2 - 2}
          width={el.width + 4}
          height={el.height + 4}
          stroke="#b6ff3c"
          strokeWidth={1.5}
          dash={[6, 5]}
          listening={false}
          opacity={0.9}
        />
      ) : null}
    </Group>
  );
}

function ImageFallback({ width, height }: { width: number; height: number }) {
  return (
    <Group listening={false}>
      <Rect
        x={-width / 2}
        y={-height / 2}
        width={width}
        height={height}
        fill="#1b1b26"
        stroke="#3a3a4c"
        strokeWidth={2}
        cornerRadius={10}
      />
      <Text
        text="图片加载失败"
        width={width}
        x={-width / 2}
        y={-8}
        align="center"
        fontSize={Math.max(12, Math.min(18, width / 12))}
        fill="#8f8fa3"
      />
    </Group>
  );
}

function TextBubble({ el, selected }: { el: CanvasElement; selected: boolean }) {
  const style = el.text!.style;
  const w = el.width;
  const h = el.height;
  const pad = style.padding;
  const tail = style.tail;
  const tailSize = 18;

  const tailPoints =
    tail === "bottom"
      ? [-16, h / 2 - 1, 16, h / 2 - 1, 0, h / 2 + tailSize]
      : tail === "left"
        ? [-w / 2 + 1, -14, -w / 2 + 1, 14, -w / 2 - tailSize, 4]
        : tail === "right"
          ? [w / 2 - 1, -14, w / 2 - 1, 14, w / 2 + tailSize, 4]
          : [];

  return (
    <Group>
      {tail !== "none" ? (
        <Line
          points={tailPoints}
          closed
          fill={style.bg}
          stroke={style.border}
          strokeWidth={style.borderWidth}
        />
      ) : null}
      <Rect
        x={-w / 2}
        y={-h / 2}
        width={w}
        height={h}
        fill={style.bg}
        stroke={style.borderWidth > 0 ? style.border : undefined}
        strokeWidth={style.borderWidth}
        cornerRadius={style.radius}
        shadowColor="#000"
        shadowBlur={selected ? 0 : 14}
        shadowOpacity={0.35}
        shadowOffset={{ x: 4, y: 6 }}
      />
      <Text
        x={-w / 2 + pad}
        y={-h / 2 + pad}
        width={Math.max(20, w - pad * 2)}
        height={Math.max(20, h - pad * 2)}
        text={el.text!.content}
        fontSize={style.fontSize}
        fontFamily={fontFamily(style.fontFamily)}
        fontStyle={`${style.bold ? "bold" : ""}${style.italic ? " italic" : ""}`.trim() || "normal"}
        fill={style.fg}
        align="center"
        verticalAlign="middle"
        wrap="word"
        lineHeight={1.25}
        listening={false}
      />
    </Group>
  );
}

export function estimateTextHeight(text: string, width: number, fontSize: number, padding: number): number {
  const usable = Math.max(40, width - padding * 2);
  const charsPerLine = Math.max(4, Math.floor(usable / (fontSize * 0.62)));
  const lines = Math.max(1, Math.ceil((text.length || 1) / charsPerLine));
  return Math.round(lines * fontSize * 1.25 + padding * 2);
}
