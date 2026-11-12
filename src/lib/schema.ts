/**
 * Project schema validation & normalisation.
 *
 * Runs on the client before upload and again inside the Pages Function before
 * anything is written to D1, so a tampered request cannot store arbitrary data.
 */
import { LIMITS, createProject, makeBubble } from "./defaults";
import type {
  AnimationName,
  BubbleStyle,
  CanvasElement,
  CueEffect,
  EventDef,
  Performance,
  PerformanceCue,
  ProjectData,
  Step,
  StepType,
} from "./types";
import { ANIMATIONS, STEP_TYPES } from "./defaults";

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

const STEP_TYPE_SET = new Set<StepType>(STEP_TYPES.map((s) => s.type));
const ANIMATION_SET = new Set<AnimationName>(ANIMATIONS);
const ELEMENT_TYPES = new Set(["character", "text", "image"]);

function str(value: unknown, max: number, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  // strip control characters except newline / tab
  const cleaned = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  return cleaned.slice(0, max);
}

function num(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

const COLOR_RE = /^(#[0-9a-fA-F]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\))$/;

function color(value: unknown, fallback: string): string {
  return typeof value === "string" && COLOR_RE.test(value) ? value : fallback;
}

/** only same-origin relative paths are allowed — blocks javascript:, data: and open redirects */
export function safeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const url = value.trim();
  if (url.length === 0 || url.length > LIMITS.url) return null;
  if (!url.startsWith("/") || url.startsWith("//")) return null;
  if (url.includes("\\") || url.includes("..") || /[\u0000-\u001f]/.test(url)) return null;
  return url;
}

function style(value: unknown, fallback: BubbleStyle): BubbleStyle {
  const v = (value ?? {}) as Record<string, unknown>;
  const presets = new Set(["comic", "plain", "thought", "caption", "big", "custom"]);
  return {
    preset: presets.has(String(v.preset)) ? (v.preset as BubbleStyle["preset"]) : fallback.preset,
    bg: color(v.bg, fallback.bg),
    fg: color(v.fg, fallback.fg),
    border: color(v.border, fallback.border),
    borderWidth: num(v.borderWidth, fallback.borderWidth, 0, 12),
    fontSize: num(v.fontSize, fallback.fontSize, 10, 120),
    fontFamily: str(v.fontFamily, 40, fallback.fontFamily) || fallback.fontFamily,
    bold: bool(v.bold, fallback.bold),
    italic: bool(v.italic, fallback.italic),
    radius: num(v.radius, fallback.radius, 0, 80),
    padding: num(v.padding, fallback.padding, 0, 60),
    tail: ["none", "left", "right", "bottom"].includes(String(v.tail))
      ? (v.tail as BubbleStyle["tail"])
      : fallback.tail,
    animation: ["pop", "bounce", "fade", "none"].includes(String(v.animation))
      ? (v.animation as BubbleStyle["animation"])
      : fallback.animation,
    hold: num(v.hold, fallback.hold, 0, 30),
  };
}

function element(raw: unknown, index: number): CanvasElement {
  if (!raw || typeof raw !== "object") throw new ValidationError(`第 ${index + 1} 个元素格式不正确`);
  const v = raw as Record<string, unknown>;
  const type = String(v.type);
  if (!ELEMENT_TYPES.has(type)) throw new ValidationError(`不支持的元素类型：${type}`);
  const id = str(v.id, 64) || `el_${index}`;
  const el: CanvasElement = {
    id,
    type: type as CanvasElement["type"],
    x: num(v.x, 0, -100_000, 100_000),
    y: num(v.y, 0, -100_000, 100_000),
    width: num(v.width, 200, 10, 20_000),
    height: num(v.height, 200, 10, 20_000),
    rotation: num(v.rotation, 0, -3600, 3600),
    z: num(v.z, index + 1, -1000, 100_000),
    opacity: num(v.opacity, 1, 0, 1),
    locked: bool(v.locked),
    hidden: bool(v.hidden),
    flipX: bool(v.flipX),
    flipY: bool(v.flipY),
  };

  if (type === "character") {
    const c = (v.character ?? {}) as Record<string, unknown>;
    const imageUrl = safeUrl(c.imageUrl);
    if (!imageUrl) throw new ValidationError(`第 ${index + 1} 个人物缺少有效图片`);
    const effects = (c.effects ?? {}) as Record<string, unknown>;
    const placementRaw = (c.bubblePlacement ?? {}) as Record<string, unknown>;
    const anchor = ["auto", "top", "bottom", "left", "right"].includes(String(placementRaw.anchor))
      ? (placementRaw.anchor as NonNullable<CanvasElement["character"]>["bubblePlacement"]["anchor"])
      : "auto";
    const voices: NonNullable<CanvasElement["character"]>["voices"] = [];
    const seenVoiceIds = new Set<string>();
    const pushVoice = (raw: unknown) => {
      if (!raw || typeof raw !== "object" || voices.length >= 20) return;
      const v = raw as Record<string, unknown>;
      const source =
        v.source === "device"
          ? "device"
          : v.source === "tts"
            ? "tts"
            : v.source === "record"
              ? "record"
              : v.source === "upload"
                ? "upload"
                : undefined;
      const text = str(v.text, LIMITS.line);
      const voiceUrl = safeUrl(v.url);
      // device voices are synthesized on the visitor's browser and need no file
      if (source === "device") {
        if (!text) return;
      } else if (!voiceUrl) {
        return;
      }
      const id = str(v.id, 64) || `voice_${voices.length + 1}`;
      if (seenVoiceIds.has(id)) return;
      seenVoiceIds.add(id);
      const line = str(v.line, LIMITS.line);
      const rate = num(v.rate, 1, 0.5, 2);
      const pitch = num(v.pitch, 1, 0.5, 2);
      const langRaw = str(v.lang, 20);
      const lang =
        source === "device"
          ? langRaw || undefined
          : ["zh", "en", "jp", "kr", "fr", "es"].includes(langRaw)
            ? langRaw
            : undefined;
      voices.push({
        id,
        name: str(v.name, LIMITS.name, "语音") || "语音",
        url: voiceUrl ?? "",
        assetId: str(v.assetId, 64) || undefined,
        duration: num(v.duration, 0, 0, 600),
        volume: num(v.volume, 1, 0, 1),
        ...(line ? { line } : {}),
        ...(rate !== 1 ? { rate } : {}),
        ...(source ? { source } : {}),
        ...(lang ? { lang } : {}),
        ...(source === "device" ? { text } : {}),
        ...(source === "device" && v.voiceURI ? { voiceURI: str(v.voiceURI, 200) } : {}),
        ...(source === "device" && pitch !== 1 ? { pitch } : {}),
      });
    };
    // legacy documents stored a single `voice`; migrate them on read
    if (c.voice) pushVoice(c.voice);
    if (Array.isArray(c.voices)) {
      for (const raw of c.voices) pushVoice(raw);
    }
    const mouthRaw = (c.mouth ?? null) as Record<string, unknown> | null;
    const mouth =
      mouthRaw && typeof mouthRaw === "object" && typeof mouthRaw.x === "number" && typeof mouthRaw.y === "number"
        ? {
            x: num(mouthRaw.x, 0.5, 0.02, 0.98),
            y: num(mouthRaw.y, 0.4, 0.02, 0.98),
            size: num(mouthRaw.size, 0.16, 0.04, 0.6),
            ...(mouthRaw.custom === true ? { custom: true } : {}),
          }
        : undefined;
    el.character = {
      name: str(c.name, LIMITS.name, `人物 ${index + 1}`),
      imageUrl,
      thumbUrl: safeUrl(c.thumbUrl) ?? undefined,
      assetId: str(c.assetId, 64) || undefined,
      line: str(c.line, LIMITS.line),
      bubble: style(c.bubble, makeBubble("comic")),
      bubblePlacement: {
        anchor,
        offsetX: num(placementRaw.offsetX, 0, -5000, 5000),
        offsetY: num(placementRaw.offsetY, 0, -5000, 5000),
        maxWidth: num(placementRaw.maxWidth, 300, 140, 640),
      },
      ...(mouth ? { mouth } : {}),
      effects: {
        outline: num(effects.outline, 0, 0, 12),
        shadow: bool(effects.shadow, true),
        glow: effects.glow ? color(effects.glow, "#b6ff3c") : null,
        shake: bool(effects.shake),
      },
      voices,
      voiceMode: c.voiceMode === "random" ? "random" : "cycle",
    };
  }

  if (type === "text") {
    const t = (v.text ?? {}) as Record<string, unknown>;
    el.text = {
      content: str(t.content, LIMITS.text, "说点什么"),
      style: style(t.style, makeBubble("big")),
      duration: num(t.duration, 2.2, 0, 30),
    };
  }

  if (type === "image") {
    const i = (v.image ?? {}) as Record<string, unknown>;
    const url = safeUrl(i.url);
    if (!url) throw new ValidationError(`第 ${index + 1} 张图片缺少有效地址`);
    const animated =
      i.animated === "gif" || i.animated === "webp" || i.animated === "mp4" ? i.animated : undefined;
    el.image = {
      url,
      thumbUrl: safeUrl(i.thumbUrl) ?? undefined,
      assetId: str(i.assetId, 64) || undefined,
      name: str(i.name, LIMITS.name, "图片"),
      ...(animated ? { animated } : {}),
    };
  }

  return el;
}

function step(raw: unknown, i: number): Step {
  const v = (raw ?? {}) as Record<string, unknown>;
  const type = String(v.type) as StepType;
  if (!STEP_TYPE_SET.has(type)) throw new ValidationError(`未知的互动动作：${type}`);
  const s: Step = { id: str(v.id, 64) || `st_${i}`, type };
  if (v.targetId) s.targetId = str(v.targetId, 64);
  if (v.text !== undefined) s.text = str(v.text, LIMITS.text);
  if (v.clipId) s.clipId = str(v.clipId, 64);
  if (v.ms !== undefined) s.ms = num(v.ms, 0, 0, 60_000);
  if (v.animation !== undefined && ANIMATION_SET.has(String(v.animation) as AnimationName)) {
    s.animation = v.animation as AnimationName;
  }
  if (v.dx !== undefined) s.dx = num(v.dx, 0, -20_000, 20_000);
  if (v.dy !== undefined) s.dy = num(v.dy, 0, -20_000, 20_000);
  if (v.eventId) s.eventId = str(v.eventId, 64);
  if (v.parallel !== undefined) s.parallel = bool(v.parallel);
  return s;
}

function event(raw: unknown, i: number): EventDef {
  const v = (raw ?? {}) as Record<string, unknown>;
  const steps = Array.isArray(v.steps)
    ? v.steps.slice(0, LIMITS.steps).map(step)
    : [];
  return {
    id: str(v.id, 64) || `ev_${i}`,
    name: str(v.name, LIMITS.name, "互动"),
    triggerId: str(v.triggerId, 64),
    steps,
    nextEventId: v.nextEventId ? str(v.nextEventId, 64) : null,
    enabled: bool(v.enabled, true),
  };
}

function effect(raw: unknown): CueEffect | null {
  const v = (raw ?? {}) as Record<string, unknown>;
  const url = safeUrl(v.url);
  if (!url) return null;
  const kind = v.kind === "gif" || v.kind === "webp" || v.kind === "mp4" ? v.kind : "gif";
  const anchors = ["center", "top", "bottom", "left", "right", "top-left", "top-right"];
  return {
    id: str(v.id, 64) || `fx_${Math.random().toString(36).slice(2, 8)}`,
    url,
    kind,
    anchor: anchors.includes(String(v.anchor)) ? (v.anchor as CueEffect["anchor"]) : "center",
    size: num(v.size, 180, 40, 900),
    duration: num(v.duration, 1200, 100, 20_000),
    delay: num(v.delay, 0, 0, 20_000),
    loop: bool(v.loop),
    muted: bool(v.muted, true),
  };
}

function cue(raw: unknown, index: number): PerformanceCue | null {
  const v = (raw ?? {}) as Record<string, unknown>;
  const actorId = str(v.actorId, 64);
  if (!actorId) return null;
  const animation = ANIMATION_SET.has(String(v.animation) as AnimationName)
    ? (v.animation as AnimationName)
    : undefined;
  const effects = Array.isArray(v.effects)
    ? v.effects.slice(0, 6).map(effect).filter((fx): fx is CueEffect => fx !== null)
    : [];
  return {
    id: str(v.id, 64) || `cq_${index}`,
    actorId,
    ...(str(v.clipId, 64) ? { clipId: str(v.clipId, 64) } : {}),
    ...(str(v.text, LIMITS.line) ? { text: str(v.text, LIMITS.line) } : {}),
    ...(v.waitBefore !== undefined ? { waitBefore: num(v.waitBefore, 0, 0, 20_000) } : {}),
    ...(v.waitAfter !== undefined ? { waitAfter: num(v.waitAfter, 260, 0, 20_000) } : {}),
    ...(animation ? { animation } : {}),
    spotlight: bool(v.spotlight),
    showBubble: bool(v.showBubble, true),
    ...(v.moveX !== undefined ? { moveX: num(v.moveX, 0, -20_000, 20_000) } : {}),
    ...(v.moveY !== undefined ? { moveY: num(v.moveY, 0, -20_000, 20_000) } : {}),
    ...(effects.length > 0 ? { effects } : {}),
    lipFlap: bool(v.lipFlap),
    ...(v.holdMs !== undefined ? { holdMs: num(v.holdMs, 0, 0, 60_000) } : {}),
  };
}

function performance(raw: unknown, index: number): Performance {
  const v = (raw ?? {}) as Record<string, unknown>;
  const cues = Array.isArray(v.cues) ? v.cues.slice(0, 200).map(cue) : [];
  return {
    id: str(v.id, 64) || `pf_${index}`,
    name: str(v.name, LIMITS.name, "表演") || "表演",
    cues: cues.filter((c): c is PerformanceCue => c !== null),
    loop: bool(v.loop),
    autoPlay: bool(v.autoPlay, true),
  };
}

export function normalizeProject(raw: unknown): ProjectData {
  if (!raw || typeof raw !== "object") throw new ValidationError("作品数据不是有效对象");
  const v = raw as Record<string, unknown>;
  if (v.version !== undefined && v.version !== 1) {
    throw new ValidationError("不支持的作品数据版本");
  }

  const elementsRaw = Array.isArray(v.elements) ? v.elements : [];
  if (elementsRaw.length > LIMITS.elements) {
    throw new ValidationError(`单张画布最多 ${LIMITS.elements} 个元素`);
  }
  const elements = elementsRaw.map(element);
  const ids = new Set<string>();
  for (const el of elements) {
    if (ids.has(el.id)) throw new ValidationError("作品包含重复的元素 ID");
    ids.add(el.id);
  }

  const eventsRaw = Array.isArray(v.events) ? v.events : [];
  if (eventsRaw.length > LIMITS.events) throw new ValidationError(`最多 ${LIMITS.events} 条互动`);
  const events = eventsRaw.map(event);
  for (const ev of events) {
    if (ev.triggerId && !ids.has(ev.triggerId)) {
      throw new ValidationError("互动事件引用了不存在的人物");
    }
    for (const s of ev.steps) {
      if (s.targetId && !ids.has(s.targetId)) {
        throw new ValidationError("互动动作引用了不存在的人物");
      }
    }
  }

  const bgRaw = (v.background ?? {}) as Record<string, unknown>;
  const bgType = bgRaw.type === "image" ? "image" : "color";
  const bgUrl = safeUrl(bgRaw.url);

  const settingsRaw = (v.settings ?? {}) as Record<string, unknown>;

  // performances may only reference elements that survived normalisation
  const performancesRaw = Array.isArray(v.performances) ? v.performances.slice(0, 8) : [];
  const performances = performancesRaw.map(performance).map((pf) => ({
    ...pf,
    cues: pf.cues.filter((c) => ids.has(c.actorId)),
  }));

  const project: ProjectData = {
    version: 1,
    title: str(v.title, LIMITS.title, "未命名作品") || "未命名作品",
    description: str(v.description, LIMITS.description),
    mode: v.mode === "free" ? "free" : "preset",
    width: num(v.width, 1600, 320, 8000),
    height: num(v.height, 900, 320, 8000),
    background: {
      type: bgType,
      color: color(bgRaw.color, "#101018"),
      url: bgType === "image" ? bgUrl ?? undefined : undefined,
      assetId: str(bgRaw.assetId, 64) || undefined,
    },
    elements,
    events,
    performances,
    settings: {
      audioMode: settingsRaw.audioMode === "mix" ? "mix" : "single",
      reactions: bool(settingsRaw.reactions, true),
      showAuthor: bool(settingsRaw.showAuthor, true),
      allowRemix: bool(settingsRaw.allowRemix, true),
      authorName: str(settingsRaw.authorName, 40),
      soundHint: str(settingsRaw.soundHint, 60, "轻点人物，听他们开口") || "轻点人物，听他们开口",
      showPlayButton: bool(settingsRaw.showPlayButton, true),
    },
    updatedAt: typeof v.updatedAt === "number" ? num(v.updatedAt, Date.now(), 0, 9e15) : Date.now(),
  };

  // keep z contiguous and element array ordered, which keeps rendering predictable
  project.elements.sort((a, b) => a.z - b.z);
  project.elements.forEach((el, i) => {
    el.z = i + 1;
  });

  return project;
}

export function normalizeForStorage(raw: unknown): { project: ProjectData; json: string } {
  const project = normalizeProject(raw);
  const json = JSON.stringify(project);
  if (new TextEncoder().encode(json).length > LIMITS.projectBytes) {
    throw new ValidationError("作品数据过大，请减少元素或缩短文字");
  }
  return { project, json };
}

export { createProject };
