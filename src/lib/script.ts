/**
 * Script import/export: CSV and JSON → PerformanceCue[].
 *
 * Matching rules:
 * - `actor` matches a character by name, or by element id
 * - `audio` matches a voice clip by name (basename, case-insensitive) or clip id
 * - `action` is an AnimationName; unknown values are ignored, not fatal
 * - blank lines and a header row are skipped
 */
import type { AnimationName, CanvasElement, CueEffect, Performance, PerformanceCue } from "./types";
import { ANIMATION_LABELS, ANIMATIONS } from "./defaults";

export interface ParseResult {
  name: string;
  cues: PerformanceCue[];
  errors: string[];
}

export const SCRIPT_TEMPLATE = `order,actor,line,audio,action,waitAfter,spotlight
1,甲,你们看这个方案怎么样？,甲-01,,260,
2,乙,我觉得不太行。,乙-01,shake,300,
3,丙,你们两个先别吵。,丙-01,pop,300,1
4,甲,那就按我的来。,甲-02,bounce,400,`;

const ANIM_SET = new Set<string>(ANIMATIONS);
const LABEL_TO_ANIM = new Map<string, AnimationName>(
  Object.entries(ANIMATION_LABELS).flatMap(([anim, label]) => [
    [label, anim as AnimationName],
    [anim, anim as AnimationName],
  ]),
);

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
      } else {
        quoted = !quoted;
      }
    } else if (ch === "," && !quoted) {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out.map((cell) => cell.trim());
}

function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, "").trim();
}

function findActor(elements: CanvasElement[], token: string): CanvasElement | undefined {
  const needle = token.trim().toLowerCase();
  if (!needle) return undefined;
  return (
    elements.find((el) => el.type === "character" && el.id.toLowerCase() === needle) ??
    elements.find((el) => el.type === "character" && (el.character?.name ?? "").toLowerCase() === needle) ??
    elements.find((el) =>
      el.type === "character" ? (el.character?.name ?? "").toLowerCase().includes(needle) : false,
    )
  );
}

function findClip(actor: CanvasElement | undefined, token: string): string | undefined {
  const voices = actor?.character?.voices ?? [];
  const needle = stripExt(token).toLowerCase();
  if (!needle) return undefined;
  return (
    voices.find((clip) => clip.id.toLowerCase() === needle)?.id ??
    voices.find((clip) => stripExt(clip.name).toLowerCase() === needle)?.id ??
    voices.find((clip) => stripExt(clip.name).toLowerCase().includes(needle))?.id
  );
}

function animOf(token: string): AnimationName | undefined {
  const key = token.trim().toLowerCase();
  if (!key) return undefined;
  if (ANIM_SET.has(key)) return key as AnimationName;
  return LABEL_TO_ANIM.get(token.trim());
}

function cueFromRow(
  row: Record<string, string>,
  elements: CanvasElement[],
  index: number,
  errors: string[],
): PerformanceCue | null {
  const actorToken = row.actor ?? row.name ?? row["人物"] ?? "";
  const actor = findActor(elements, actorToken);
  if (!actor) {
    errors.push(`第 ${index + 1} 行找不到人物「${actorToken}」`);
    return null;
  }
  const clipId = findClip(actor, row.audio ?? row.voice ?? row["音频"] ?? "");
  const text = (row.line ?? row.text ?? row["台词"] ?? "").trim();
  const animation = animOf(row.action ?? row.animation ?? row["动作"] ?? "");
  const waitAfterRaw = row.waitafter ?? row.waitAfter ?? row["停顿"] ?? "";
  const waitAfter = waitAfterRaw === "" ? undefined : Number(waitAfterRaw);
  const spotlightRaw = (row.spotlight ?? "").toLowerCase();
  const lipRaw = (row.lipflap ?? row.lipFlap ?? "").toLowerCase();
  const holdRaw = row.holdms ?? row.holdMs ?? "";

  return {
    id: `cq_${Date.now().toString(36)}_${index}`,
    actorId: actor.id,
    ...(clipId ? { clipId } : {}),
    ...(text ? { text } : {}),
    ...(animation ? { animation } : {}),
    ...(Number.isFinite(waitAfter) ? { waitAfter: Math.max(0, Math.min(20_000, waitAfter!)) } : {}),
    spotlight: spotlightRaw === "1" || spotlightRaw === "true" || spotlightRaw === "yes",
    showBubble: true,
    ...(lipRaw === "1" || lipRaw === "true" ? { lipFlap: true } : {}),
    ...(holdRaw && Number.isFinite(Number(holdRaw))
      ? { holdMs: Math.max(0, Math.min(60_000, Number(holdRaw))) }
      : {}),
  };
}

function parseCsv(text: string, elements: CanvasElement[]): ParseResult {
  const errors: string[] = [];
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  if (lines.length === 0) return { name: "", cues: [], errors: ["内容是空的"] };

  const header = splitCsvLine(lines[0]).map((cell) => cell.toLowerCase());
  const hasHeader = header.some((cell) =>
    ["order", "actor", "name", "line", "text", "audio", "action", "人物", "台词", "音频"].includes(cell),
  );
  const keys = hasHeader ? header : ["order", "actor", "line", "audio", "action", "waitafter", "spotlight"];
  const body = hasHeader ? lines.slice(1) : lines;

  const cues: PerformanceCue[] = [];
  body.forEach((line, index) => {
    const cells = splitCsvLine(line);
    const row: Record<string, string> = {};
    keys.forEach((key, cellIndex) => {
      row[key] = cells[cellIndex] ?? "";
    });
    if (cells.every((cell) => cell === "")) return;
    const cue = cueFromRow(row, elements, index, errors);
    if (cue) cues.push(cue);
  });
  return { name: "", cues, errors };
}

function parseJson(text: string, elements: CanvasElement[]): ParseResult {
  const errors: string[] = [];
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { name: "", cues: [], errors: ["JSON 格式不正确"] };
  }
  const doc = (raw ?? {}) as Record<string, unknown>;
  const list = Array.isArray(doc.cues) ? doc.cues : Array.isArray(raw) ? raw : [];
  const cues: PerformanceCue[] = [];
  list.forEach((item, index) => {
    const row = (item ?? {}) as Record<string, unknown>;
    const asStrings: Record<string, string> = {};
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        asStrings[key.toLowerCase()] = String(value);
      }
    }
    // JSON may reference the actor by name (`actor`) or already by id
    const actorToken = String(row.actor ?? row.actorId ?? row.name ?? "");
    const actor = findActor(elements, actorToken);
    if (!actor) {
      errors.push(`第 ${index + 1} 条找不到人物「${actorToken}」`);
      return;
    }
    const clipToken = String(row.audio ?? row.voice ?? row.clipId ?? "");
    const cue = cueFromRow(
      { ...asStrings, actor: actor.character?.name ?? actorToken, audio: clipToken },
      elements,
      index,
      errors,
    );
    if (cue) {
      // JSON can also carry effects dropped by the flat string map
      if (Array.isArray(row.effects)) {
        const effects = row.effects
          .map((fx, fxIndex) => {
            const f = (fx ?? {}) as Record<string, unknown>;
            const url = typeof f.url === "string" ? f.url : "";
            if (!url.startsWith("/")) return null;
            const kind: CueEffect["kind"] =
              f.kind === "mp4" || f.kind === "webp" ? f.kind : "gif";
            return {
              id: `fx_${index}_${fxIndex}`,
              url,
              kind,
              anchor: "top-right" as const,
              size: typeof f.size === "number" ? f.size : 160,
              duration: typeof f.duration === "number" ? f.duration : 1200,
              muted: true,
            };
          })
          .filter((fx): fx is NonNullable<typeof fx> => fx !== null);
        if (effects.length > 0) cue.effects = effects;
      }
      cues.push(cue);
    }
  });
  return {
    name: typeof doc.name === "string" ? doc.name : "",
    cues,
    errors,
  };
}

export function parseScript(text: string, elements: CanvasElement[]): ParseResult {
  const trimmed = text.trim();
  if (!trimmed) return { name: "", cues: [], errors: ["内容是空的"] };
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return parseJson(trimmed, elements);
  return parseCsv(trimmed, elements);
}

export function stringifyScript(performance: Performance, elements: CanvasElement[]): string {
  const rows = [["order", "actor", "line", "audio", "action", "waitAfter", "spotlight", "lipFlap"]];
  performance.cues.forEach((cue, index) => {
    const actor = elements.find((el) => el.id === cue.actorId);
    const clip = actor?.character?.voices.find((v) => v.id === cue.clipId);
    rows.push([
      String(index + 1),
      actor?.character?.name ?? "",
      cue.text ?? "",
      clip?.name ?? "",
      cue.animation ?? "",
      String(cue.waitAfter ?? 260),
      cue.spotlight ? "1" : "",
      cue.lipFlap ? "1" : "",
    ]);
  });
  return rows
    .map((row) =>
      row
        .map((cell) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell))
        .join(","),
    )
    .join("\n");
}
