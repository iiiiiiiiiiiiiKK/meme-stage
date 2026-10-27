import { createCharacter, createText, makeBubble } from "./defaults";
import type { CanvasElement, ProjectData } from "./types";
import type { DemoCharacter } from "../data/demoAssets";

export function placeSize(
  project: ProjectData,
  naturalWidth: number,
  naturalHeight: number,
  fraction = 0.26,
): { width: number; height: number } {
  const height = Math.min(project.height * 0.58, Math.max(120, project.height * fraction));
  const ratio = naturalHeight > 0 && naturalWidth > 0 ? naturalWidth / naturalHeight : 0.75;
  return { width: Math.round(Math.min(project.width * 0.4, height * ratio)), height: Math.round(height) };
}

export function centerSpawn(project: ProjectData, width: number, height: number): { x: number; y: number } {
  const jitterX = (Math.random() - 0.5) * Math.min(120, project.width * 0.1);
  const jitterY = (Math.random() - 0.5) * Math.min(90, project.height * 0.1);
  return {
    x: Math.round(project.width / 2 - width / 2 + jitterX),
    y: Math.round(project.height / 2 - height / 2 + jitterY),
  };
}

export function buildCharacterElement(args: {
  project: ProjectData;
  name: string;
  imageUrl: string;
  thumbUrl?: string;
  assetId?: string;
  width: number;
  height: number;
  line?: string;
  voice?: { id: string; name: string; url: string; duration: number; line?: string };
  accent?: string;
}): CanvasElement {
  const spawn = centerSpawn(args.project, args.width, args.height);
  const el = createCharacter({
    name: args.name,
    imageUrl: args.imageUrl,
    thumbUrl: args.thumbUrl,
    assetId: args.assetId,
    width: args.width,
    height: args.height,
    x: spawn.x,
    y: spawn.y,
  });
  if (el.character) {
    if (args.line) el.character.line = args.line;
    if (args.accent) {
      el.character.bubble = { ...makeBubble("comic"), bg: args.accent };
      el.character.effects.glow = null;
    }
    if (args.voice) {
      el.character.voices = [
        {
          id: args.voice.id,
          name: args.voice.name,
          url: args.voice.url,
          duration: args.voice.duration,
          volume: 1,
          ...(args.voice.line ? { line: args.voice.line } : {}),
        },
      ];
    }
  }
  return el;
}

export function buildDemoElement(project: ProjectData, demo: DemoCharacter, scale = 1): CanvasElement {
  const el = buildCharacterElement({
    project,
    name: demo.name,
    imageUrl: demo.image,
    thumbUrl: demo.face,
    width: Math.round(demo.width * scale * (project.width / 1600)),
    height: Math.round(demo.height * scale * (project.height / 900)),
    line: demo.line,
    accent: demo.accent,
    voice: {
      id: `vc_${demo.id}`,
      name: demo.voiceName,
      url: demo.voice,
      duration: demo.duration,
    },
  });
  el.rotation = (Math.random() - 0.5) * 6;
  if (el.character) el.character.bubble.hold = Math.max(2.2, demo.duration);
  return el;
}

export function buildText(project: ProjectData, content: string): CanvasElement {
  const width = Math.min(560, project.width * 0.42);
  const el = createText({
    content,
    width,
    height: Math.round(Math.min(180, width * 0.34)),
    x: project.width / 2 - width / 2,
    y: project.height * 0.08,
  });
  return el;
}
