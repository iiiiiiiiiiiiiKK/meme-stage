/**
 * Filename conventions for batch import.
 *
 * Supported shapes (the separator between columns is `--`; `__` also works):
 *   cat.png                     → name "cat"
 *   cat--我听不懂但是喵.png      → name "cat", line "我听不懂但是喵"
 *   cat--我听不懂但是喵--01.png  → name "cat", line "我听不懂但是喵", index 1
 *   cat-01.wav                  → name "cat", voice index 1
 *   cat__喵.png                 → name "cat", line "喵"
 *
 * Anything that does not match falls back to the plain basename, so a weird
 * filename never blocks an import.
 */

export interface ParsedName {
  /** character name the file belongs to */
  name: string;
  /** optional default line extracted from the filename */
  line?: string;
  /** optional ordinal used to order multiple clips */
  index?: number;
  /** the raw basename without extension */
  base: string;
}

const SEPARATOR = /\s*--\s*|\s*__\s*/;
const TRAILING_INDEX = /^(.*?)[-_ ](\d{1,3})$/;

export function parseFileName(fileName: string): ParsedName {
  const base = fileName.replace(/\.[^.]+$/, "").trim();
  if (!base) return { name: "未命名", base: "" };

  const parts = base.split(SEPARATOR).map((part) => part.trim()).filter((part) => part.length > 0);
  const head = parts[0] ?? base;
  const line = parts[1];
  const tail = parts[2];

  // "cat-01" / "cat 1" → name cat, index 1  (only when the head is not itself a name)
  let name = head;
  let index: number | undefined;
  const match = TRAILING_INDEX.exec(head);
  if (match && match[1].trim().length > 0) {
    name = match[1].trim();
    index = Number(match[2]);
  }
  if (tail) {
    const n = Number(tail);
    if (Number.isFinite(n)) index = n;
    else if (!line) return { name, line: tail, index, base };
  }
  return {
    name: name.slice(0, 40) || "未命名",
    ...(line ? { line: line.slice(0, 200) } : {}),
    ...(index !== undefined ? { index } : {}),
    base,
  };
}

/** groups audio files by the character they belong to (case-insensitive) */
export function groupAudioByCharacter<T extends { name: string }>(
  files: T[],
  nameOf: (file: T) => string = (file) => file.name,
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const file of files) {
    const parsed = parseFileName(nameOf(file));
    const key = parsed.name.toLowerCase();
    const list = groups.get(key) ?? [];
    list.push(file);
    groups.set(key, list);
  }
  for (const [, list] of groups) {
    list.sort((a, b) => {
      const ai = parseFileName(nameOf(a)).index ?? 0;
      const bi = parseFileName(nameOf(b)).index ?? 0;
      return ai - bi;
    });
  }
  return groups;
}
