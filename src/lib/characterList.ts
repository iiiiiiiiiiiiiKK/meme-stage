/**
 * Character-list import: apply per-character settings to characters that are
 * already on the canvas, matched by name.
 *
 * Shape (CSV with header, or JSON array):
 *   name,line,voiceMode,bubble,volume,height
 *   老K,这波真的不亏,cycle,comic,1,360
 *   猫猫头,我听不懂但是喵,random,thought,0.8,320
 *
 * Matching is case-insensitive on the character name; unknown rows are reported
 * without aborting the rest.
 */
import type { BubblePreset, CanvasElement, VoiceMode } from "./types";

export interface CharacterRow {
  name: string;
  line?: string;
  voiceMode?: VoiceMode;
  bubble?: BubblePreset;
  volume?: number;
  height?: number;
  /** optional per-voice line applied to every clip of that character */
  voiceLine?: string;
}

export interface CharacterListResult {
  rows: CharacterRow[];
  errors: string[];
}

const PRESETS = new Set(["comic", "plain", "thought", "caption", "big", "custom"]);

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else quoted = !quoted;
    } else if (ch === "," && !quoted) {
      out.push(current);
      current = "";
    } else current += ch;
  }
  out.push(current);
  return out.map((cell) => cell.trim());
}

function rowFrom(values: Record<string, string>): CharacterRow | null {
  const name = (values.name ?? values.actor ?? values["人物"] ?? "").trim();
  if (!name) return null;
  const modeRaw = (values.voicemode ?? values.voiceMode ?? values.mode ?? "").toLowerCase();
  const bubbleRaw = (values.bubble ?? values.preset ?? values["气泡"] ?? "").toLowerCase();
  const volumeRaw = Number(values.volume ?? values["音量"] ?? "");
  const heightRaw = Number(values.height ?? values["高度"] ?? "");
  const line = (values.line ?? values.text ?? values["台词"] ?? "").trim();
  const voiceLine = (values.voiceline ?? values.voiceLine ?? "").trim();
  return {
    name,
    ...(line ? { line } : {}),
    ...(modeRaw === "random" || modeRaw === "cycle" ? { voiceMode: modeRaw as VoiceMode } : {}),
    ...(PRESETS.has(bubbleRaw) ? { bubble: bubbleRaw as BubblePreset } : {}),
    ...(Number.isFinite(volumeRaw) && values.volume !== undefined
      ? { volume: Math.max(0, Math.min(1, volumeRaw)) }
      : {}),
    ...(Number.isFinite(heightRaw) && heightRaw > 0 ? { height: Math.round(heightRaw) } : {}),
    ...(voiceLine ? { voiceLine } : {}),
  };
}

export function parseCharacterList(text: string): CharacterListResult {
  const trimmed = text.trim();
  const errors: string[] = [];
  if (!trimmed) return { rows: [], errors: ["内容是空的"] };

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    let raw: unknown;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      return { rows: [], errors: ["JSON 格式不正确"] };
    }
    const list = Array.isArray(raw)
      ? raw
      : Array.isArray((raw as { characters?: unknown[] }).characters)
        ? (raw as { characters: unknown[] }).characters
        : [];
    const rows: CharacterRow[] = [];
    list.forEach((item, index) => {
      const flat: Record<string, string> = {};
      for (const [key, value] of Object.entries((item ?? {}) as Record<string, unknown>)) {
        if (typeof value === "string" || typeof value === "number") flat[key.toLowerCase()] = String(value);
      }
      const row = rowFrom(flat);
      if (row) rows.push(row);
      else errors.push(`第 ${index + 1} 条缺少人物名`);
    });
    return { rows, errors };
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  if (lines.length === 0) return { rows: [], errors: ["内容是空的"] };

  const header = splitCsvLine(lines[0]).map((cell) => cell.toLowerCase());
  const hasHeader = header.some((cell) =>
    ["name", "actor", "line", "voicemode", "bubble", "volume", "height", "人物", "台词"].includes(cell),
  );
  const keys = hasHeader ? header : ["name", "line", "voicemode", "bubble", "volume", "height"];
  const body = hasHeader ? lines.slice(1) : lines;
  const rows: CharacterRow[] = [];
  body.forEach((line, index) => {
    const cells = splitCsvLine(line);
    if (cells.every((cell) => cell === "")) return;
    const values: Record<string, string> = {};
    keys.forEach((key, i) => {
      values[key] = cells[i] ?? "";
    });
    const row = rowFrom(values);
    if (row) rows.push(row);
    else errors.push(`第 ${index + 1} 行缺少人物名`);
  });
  return { rows, errors };
}

/** apply parsed rows in place on a project draft; returns the unmatched names */
export function applyCharacterRows(elements: CanvasElement[], rows: CharacterRow[]): string[] {
  const missed: string[] = [];
  const byName = new Map<string, CanvasElement>();
  for (const el of elements) {
    if (el.type === "character") byName.set((el.character?.name ?? "").toLowerCase(), el);
  }
  for (const row of rows) {
    const el = byName.get(row.name.toLowerCase());
    if (!el || !el.character) {
      missed.push(row.name);
      continue;
    }
    if (row.line) el.character.line = row.line;
    if (row.voiceMode) el.character.voiceMode = row.voiceMode;
    if (row.bubble) el.character.bubble = { ...el.character.bubble, preset: row.bubble };
    if (row.volume !== undefined) {
      for (const clip of el.character.voices) clip.volume = row.volume;
    }
    if (row.voiceLine) {
      for (const clip of el.character.voices) clip.line = row.voiceLine;
    }
    if (row.height) {
      const ratio = el.width / Math.max(1, el.height);
      el.height = row.height;
      el.width = Math.round(row.height * ratio);
    }
  }
  return missed;
}
