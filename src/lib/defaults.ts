import type {
  AnimationName,
  BubbleStyle,
  CanvasElement,
  CharacterData,
  EventDef,
  ProjectData,
  Step,
  StepType,
  TextData,
} from "./types";
import { uid } from "./ids";

export const LIMITS = {
  elements: 300,
  events: 200,
  steps: 40,
  title: 120,
  description: 600,
  name: 60,
  line: 280,
  text: 280,
  url: 2048,
  projectBytes: 2_000_000,
};

export const BUBBLE_PRESETS: Record<string, BubbleStyle> = {
  comic: {
    preset: "comic",
    bg: "#ffffff",
    fg: "#07070a",
    border: "#07070a",
    borderWidth: 4,
    fontSize: 26,
    fontFamily: "system",
    bold: true,
    italic: false,
    radius: 18,
    padding: 18,
    tail: "bottom",
    animation: "pop",
    hold: 2.6,
  },
  plain: {
    preset: "plain",
    bg: "#07070a",
    fg: "#f4f1e8",
    border: "#07070a",
    borderWidth: 0,
    fontSize: 24,
    fontFamily: "system",
    bold: false,
    italic: false,
    radius: 14,
    padding: 14,
    tail: "none",
    animation: "fade",
    hold: 2.6,
  },
  thought: {
    preset: "thought",
    bg: "#dfe8ff",
    fg: "#0b1020",
    border: "#4d7cff",
    borderWidth: 3,
    fontSize: 24,
    fontFamily: "system",
    bold: false,
    italic: true,
    radius: 26,
    padding: 16,
    tail: "left",
    animation: "fade",
    hold: 2.6,
  },
  caption: {
    preset: "caption",
    bg: "#07070a",
    fg: "#f4f1e8",
    border: "#b6ff3c",
    borderWidth: 3,
    fontSize: 22,
    fontFamily: "system",
    bold: true,
    italic: false,
    radius: 4,
    padding: 12,
    tail: "none",
    animation: "none",
    hold: 2.6,
  },
  big: {
    preset: "big",
    bg: "#b6ff3c",
    fg: "#07070a",
    border: "#07070a",
    borderWidth: 5,
    fontSize: 54,
    fontFamily: "display",
    bold: true,
    italic: false,
    radius: 12,
    padding: 22,
    tail: "none",
    animation: "bounce",
    hold: 2.2,
  },
};

export const DEFAULT_BUBBLE_PLACEMENT = {
  anchor: "auto" as const,
  offsetX: 0,
  offsetY: 0,
  maxWidth: 300,
};

export function makeBubble(preset: keyof typeof BUBBLE_PRESETS = "comic"): BubbleStyle {
  return { ...BUBBLE_PRESETS[preset] };
}

export const STEP_TYPES: { type: StepType; label: string; hint: string }[] = [
  { type: "playAudio", label: "播放语音", hint: "播放目标人物的语音" },
  { type: "say", label: "说一句话", hint: "显示气泡字幕" },
  { type: "animate", label: "播放动画", hint: "弹跳 / 抖动 / 放大" },
  { type: "show", label: "显示人物", hint: "让隐藏的人物出现" },
  { type: "hide", label: "隐藏人物", hint: "让目标暂时消失" },
  { type: "move", label: "移动人物", hint: "相对位移，单位像素" },
  { type: "wait", label: "等待", hint: "停顿若干毫秒" },
  { type: "flash", label: "全屏闪一下", hint: "强调当前瞬间" },
  { type: "goto", label: "跳转事件", hint: "继续执行另一个事件" },
];

export const ANIMATIONS: AnimationName[] = ["bounce", "shake", "pop", "spin", "pulse"];

export function createProject(overrides: Partial<ProjectData> = {}): ProjectData {
  return {
    version: 1,
    title: "未命名作品",
    description: "",
    mode: "preset",
    width: 1600,
    height: 900,
    background: { type: "color", color: "#101018" },
    elements: [],
    events: [],
    settings: {
      audioMode: "single",
      reactions: true,
      showAuthor: true,
      allowRemix: true,
      authorName: "",
      soundHint: "轻点人物，听他们开口",
    },
    updatedAt: Date.now(),
    ...overrides,
  };
}

export function createCharacter(args: {
  name: string;
  imageUrl: string;
  thumbUrl?: string;
  assetId?: string;
  width: number;
  height: number;
  x?: number;
  y?: number;
  z?: number;
}): CanvasElement {
  return {
    id: uid("el"),
    type: "character",
    x: args.x ?? 0,
    y: args.y ?? 0,
    width: args.width,
    height: args.height,
    rotation: 0,
    z: args.z ?? 1,
    opacity: 1,
    locked: false,
    hidden: false,
    flipX: false,
    flipY: false,
    character: {
      name: args.name,
      imageUrl: args.imageUrl,
      thumbUrl: args.thumbUrl,
      assetId: args.assetId,
      voices: [],
      voiceMode: "cycle",
      line: "",
      bubble: makeBubble("comic"),
      bubblePlacement: { ...DEFAULT_BUBBLE_PLACEMENT },
      effects: { outline: 0, shadow: true, glow: null, shake: false },
    },
  };
}

export function createText(args: {
  content: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  z?: number;
  preset?: keyof typeof BUBBLE_PRESETS;
}): CanvasElement {
  const bubble = makeBubble(args.preset ?? "big");
  return {
    id: uid("tx"),
    type: "text",
    x: args.x ?? 0,
    y: args.y ?? 0,
    width: args.width ?? 420,
    height: args.height ?? 140,
    rotation: 0,
    z: args.z ?? 10,
    opacity: 1,
    locked: false,
    hidden: false,
    flipX: false,
    flipY: false,
    text: { content: args.content, style: bubble, duration: bubble.hold },
  };
}

export function makeStep(type: StepType, targetId?: string): Step {
  const step: Step = { id: uid("st"), type };
  if (targetId) step.targetId = targetId;
  if (type === "playAudio") step.ms = 0;
  if (type === "wait") step.ms = 600;
  if (type === "animate") step.animation = "bounce";
  if (type === "move") {
    step.dx = 0;
    step.dy = -40;
  }
  return step;
}

export function makeEvent(triggerId: string, name = "新互动"): EventDef {
  return {
    id: uid("ev"),
    name,
    triggerId,
    steps: [],
    nextEventId: null,
    enabled: true,
  };
}

export function makeCharacterData(args: {
  name: string;
  imageUrl: string;
  thumbUrl?: string;
  assetId?: string;
}): CharacterData {
  return {
    name: args.name,
    imageUrl: args.imageUrl,
    thumbUrl: args.thumbUrl,
    assetId: args.assetId,
    voices: [],
    voiceMode: "cycle",
    line: "",
    bubble: makeBubble("comic"),
    bubblePlacement: { ...DEFAULT_BUBBLE_PLACEMENT },
    effects: { outline: 0, shadow: true, glow: null, shake: false },
  };
}

export function makeTextData(content: string): TextData {
  return { content, style: makeBubble("big"), duration: 2.2 };
}
