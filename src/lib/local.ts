import type { ProjectData } from "./types";

const DRAFT_PREFIX = "ms.draft.";
const DRAFT_INDEX = "ms.draft.index";

export interface DraftRecord {
  id: string;
  title: string;
  updatedAt: number;
  rev?: number;
  project: ProjectData;
}

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function saveDraft(id: string, project: ProjectData, rev?: number): void {
  try {
    localStorage.setItem(
      DRAFT_PREFIX + id,
      JSON.stringify({ project, savedAt: Date.now(), rev: rev ?? 0 }),
    );
    const index = readDraftIndex();
    const next = { id, title: project.title, updatedAt: Date.now() };
    const without = index.filter((d) => d.id !== id);
    localStorage.setItem(DRAFT_INDEX, JSON.stringify([next, ...without].slice(0, 40)));
  } catch {
    // quota exceeded — local draft is a convenience, never block the editor
  }
}

export function loadDraft(id: string): { project: ProjectData; savedAt: number; rev: number } | null {
  try {
    const parsed = safeParse<{ project: ProjectData; savedAt: number; rev?: number }>(
      localStorage.getItem(DRAFT_PREFIX + id),
    );
    if (!parsed?.project) return null;
    return { project: parsed.project, savedAt: parsed.savedAt ?? 0, rev: parsed.rev ?? 0 };
  } catch {
    return null;
  }
}

export function removeDraft(id: string): void {
  try {
    localStorage.removeItem(DRAFT_PREFIX + id);
    const index = readDraftIndex().filter((d) => d.id !== id);
    localStorage.setItem(DRAFT_INDEX, JSON.stringify(index));
  } catch {
    // ignore
  }
}

export function readDraftIndex(): { id: string; title: string; updatedAt: number }[] {
  try {
    const list = safeParse<{ id: string; title: string; updatedAt: number }[]>(
      localStorage.getItem(DRAFT_INDEX),
    );
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

const LAST_ID = "ms.lastProjectId";
export function rememberProject(id: string): void {
  try {
    localStorage.setItem(LAST_ID, id);
  } catch {
    // ignore
  }
}
export function lastProject(): string | null {
  try {
    return localStorage.getItem(LAST_ID);
  } catch {
    return null;
  }
}
