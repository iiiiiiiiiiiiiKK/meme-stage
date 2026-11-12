/**
 * Layout templates: save the current canvas *structure* (sizes, background,
 * bubble style, sound settings) and apply it to a new project later.
 *
 * Deliberately excludes elements, voices and published state: a template is a
 * stage, not a work, so applying one never overwrites content by accident.
 */
import type { BubbleStyle, ProjectData } from "./types";
import { makeBubble } from "./defaults";
import { uid } from "./ids";

export interface TemplateSettings {
  width: number;
  height: number;
  mode: ProjectData["mode"];
  background: ProjectData["background"];
  audioMode: ProjectData["settings"]["audioMode"];
  soundHint: string;
  bubble: BubbleStyle;
  bubblePlacement: ProjectData["elements"][number]["character"] extends infer C
    ? C extends { bubblePlacement: infer P }
      ? P
      : never
    : never;
  characterHeight: number;
  layoutMode: string;
}

export interface Template {
  id: string;
  name: string;
  createdAt: number;
  settings: TemplateSettings;
}

const KEY = "ms.templates";
const MAX_TEMPLATES = 20;

export const BUILTIN_TEMPLATES: Template[] = [
  {
    id: "builtin-open-mic",
    name: "全员开麦 · 16:9",
    createdAt: 0,
    settings: {
      width: 1600,
      height: 900,
      mode: "preset",
      background: { type: "color", color: "#101018" },
      audioMode: "single",
      soundHint: "轻点人物，听他们开口",
      bubble: makeBubble("comic"),
      bubblePlacement: { anchor: "auto", offsetX: 0, offsetY: 0, maxWidth: 300 },
      characterHeight: 360,
      layoutMode: "grid",
    },
  },
  {
    id: "builtin-chat",
    name: "群聊截图 · 9:16",
    createdAt: 0,
    settings: {
      width: 900,
      height: 1600,
      mode: "preset",
      background: { type: "color", color: "#0b0b12" },
      audioMode: "single",
      soundHint: "点一句，听一句",
      bubble: makeBubble("caption"),
      bubblePlacement: { anchor: "auto", offsetX: 0, offsetY: 0, maxWidth: 260 },
      characterHeight: 420,
      layoutMode: "custom",
    },
  },
  {
    id: "builtin-poster",
    name: "群像海报 · 16:9",
    createdAt: 0,
    settings: {
      width: 1600,
      height: 900,
      mode: "preset",
      background: { type: "color", color: "#14121c" },
      audioMode: "mix",
      soundHint: "一起来吧",
      bubble: makeBubble("big"),
      bubblePlacement: { anchor: "auto", offsetX: 0, offsetY: 0, maxWidth: 360 },
      characterHeight: 420,
      layoutMode: "cluster",
    },
  },
  {
    id: "builtin-wall",
    name: "Meme 墙 · 1:1",
    createdAt: 0,
    settings: {
      width: 1200,
      height: 1200,
      mode: "preset",
      background: { type: "color", color: "#0d0d13" },
      audioMode: "single",
      soundHint: "随便点一个",
      bubble: makeBubble("plain"),
      bubblePlacement: { anchor: "auto", offsetX: 0, offsetY: 0, maxWidth: 280 },
      characterHeight: 300,
      layoutMode: "random",
    },
  },
  {
    id: "builtin-duet",
    name: "对话舞台 · 16:9",
    createdAt: 0,
    settings: {
      width: 1600,
      height: 900,
      mode: "preset",
      background: { type: "color", color: "#0a0f18" },
      audioMode: "single",
      soundHint: "左右两个人在说话",
      bubble: makeBubble("thought"),
      bubblePlacement: { anchor: "auto", offsetX: 0, offsetY: 0, maxWidth: 320 },
      characterHeight: 480,
      layoutMode: "custom",
    },
  },
];

export function readTemplates(): Template[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as Template[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function writeTemplates(list: Template[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_TEMPLATES)));
  } catch {
    // storage full — templates are a convenience, never block the editor
  }
}

/** snapshot the current project as a reusable stage */
export function captureTemplate(project: ProjectData, name: string): Template {
  const first = project.elements.find((el) => el.type === "character");
  return {
    id: uid("tpl"),
    name: name.trim().slice(0, 40) || "我的模板",
    createdAt: Date.now(),
    settings: {
      width: project.width,
      height: project.height,
      mode: project.mode,
      background: { ...project.background },
      audioMode: project.settings.audioMode,
      soundHint: project.settings.soundHint,
      bubble: { ...(first?.character?.bubble ?? makeBubble("comic")) },
      bubblePlacement: {
        ...(first?.character?.bubblePlacement ?? { anchor: "auto", offsetX: 0, offsetY: 0, maxWidth: 300 }),
      },
      characterHeight: first ? Math.round(first.height) : 360,
      layoutMode: "grid",
    },
  };
}

/**
 * Apply a template to a project. Existing elements keep their identity; when
 * `resizeCast` is true every character is scaled to the template height so the
 * stage looks intentional instead of half-migrated.
 */
export function applyTemplate(project: ProjectData, template: Template, resizeCast = true): ProjectData {
  const s = template.settings;
  const next: ProjectData = {
    ...project,
    width: s.width,
    height: s.height,
    mode: s.mode,
    background: { ...s.background },
    settings: {
      ...project.settings,
      audioMode: s.audioMode,
      soundHint: s.soundHint,
    },
    updatedAt: Date.now(),
  };
  if (!resizeCast) return next;

  next.elements = project.elements.map((el) => {
    if (el.type !== "character" || !el.character) return el;
    const ratio = el.width / Math.max(1, el.height);
    const height = s.characterHeight;
    return {
      ...el,
      height,
      width: Math.round(height * ratio),
      character: {
        ...el.character,
        bubble: { ...s.bubble },
        bubblePlacement: { ...s.bubblePlacement },
      },
    };
  });
  return next;
}
