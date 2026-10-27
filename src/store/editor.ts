import { create } from "zustand";
import type { CanvasElement, EventDef, ProjectData } from "../lib/types";
import type { Viewport } from "../lib/geometry";
import { createProject } from "../lib/defaults";

type SaveState = "idle" | "saving" | "saved" | "error" | "local";

interface EditorState {
  project: ProjectData;
  projectId: string | null;
  rev: number;
  selection: string[];
  viewport: Viewport;
  past: ProjectData[];
  future: ProjectData[];
  saveState: SaveState;
  saveError: string | null;
  conflict: boolean;
  dirty: boolean;
  snapEnabled: boolean;
  showGrid: boolean;
  leftOpen: boolean;
  rightOpen: boolean;
  focusTick: number;
  fitTick: number;
  lastCoalesce: { key: string; at: number };

  loadProject: (project: ProjectData, opts: { id: string | null; rev: number }) => void;
  mutate: (fn: (draft: ProjectData) => void, history?: boolean, coalesceKey?: string) => void;
  updateElement: (
    id: string,
    patch: Partial<CanvasElement>,
    history?: boolean,
    coalesceKey?: string,
  ) => void;
  updateCharacter: (
    id: string,
    patch: (c: NonNullable<CanvasElement["character"]>) => void,
    history?: boolean,
    coalesceKey?: string,
  ) => void;
  addElements: (elements: CanvasElement[], history?: boolean) => void;
  removeSelected: () => void;
  duplicateSelected: () => void;
  moveSelected: (dx: number, dy: number) => void;
  alignSelection: (mode: "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom") => void;
  equalizeSelection: () => void;
  moveLayer: (id: string, dir: "up" | "down" | "front" | "back") => void;
  toggleLock: (id: string) => void;
  toggleHidden: (id: string) => void;
  select: (id: string | null, additive?: boolean) => void;
  selectMany: (ids: string[]) => void;
  setViewport: (v: Viewport) => void;
  requestFit: () => void;
  focusElement: (id: string) => void;
  addEvent: (event: EventDef) => void;
  updateEvent: (id: string, patch: Partial<EventDef>) => void;
  removeEvent: (id: string) => void;
  undo: () => void;
  redo: () => void;
  setSaveState: (state: SaveState, error?: string | null) => void;
  markSaved: (rev: number, updatedAt?: number) => void;
  setProjectId: (id: string) => void;
  setConflict: (value: boolean) => void;
  setSnap: (value: boolean) => void;
  setGrid: (value: boolean) => void;
  togglePanel: (side: "left" | "right") => void;
}

const HISTORY_LIMIT = 60;

function sortByZ(project: ProjectData) {
  project.elements.sort((a, b) => a.z - b.z);
  project.elements.forEach((el, i) => {
    el.z = i + 1;
  });
}

export const useEditor = create<EditorState>((set, get) => ({
  project: createProject(),
  projectId: null,
  rev: 0,
  selection: [],
  viewport: { x: 0, y: 0, scale: 1 },
  past: [],
  future: [],
  saveState: "idle",
  saveError: null,
  conflict: false,
  dirty: false,
  snapEnabled: true,
  showGrid: true,
  leftOpen: true,
  rightOpen: true,
  focusTick: 0,
  fitTick: 0,
  lastCoalesce: { key: "", at: 0 },

  loadProject: (project, opts) =>
    set({
      project,
      projectId: opts.id,
      rev: opts.rev,
      selection: [],
      past: [],
      future: [],
      dirty: false,
      saveState: opts.id ? "saved" : "idle",
      saveError: null,
      conflict: false,
      fitTick: get().fitTick + 1,
    }),

  mutate: (fn, history = true, coalesceKey) => {
    const state = get();
    const next = structuredClone(state.project);
    fn(next);
    next.updatedAt = Date.now();
    sortByZ(next);
    const now = Date.now();
    const merge =
      !!coalesceKey && coalesceKey === state.lastCoalesce.key && now - state.lastCoalesce.at < 900;
    set({
      project: next,
      dirty: true,
      past: history && !merge ? [...state.past, state.project].slice(-HISTORY_LIMIT) : state.past,
      future: history && !merge ? [] : state.future,
      lastCoalesce: coalesceKey ? { key: coalesceKey, at: now } : { key: "", at: 0 },
    });
  },

  updateElement: (id, patch, history = true, coalesceKey) => {
    get().mutate((draft) => {
      const el = draft.elements.find((e) => e.id === id);
      if (el) Object.assign(el, patch);
    }, history, coalesceKey);
  },

  updateCharacter: (id, patch, history = true, coalesceKey) => {
    get().mutate((draft) => {
      const el = draft.elements.find((e) => e.id === id);
      if (el?.character) patch(el.character);
    }, history, coalesceKey);
  },

  addElements: (elements, history = true) => {
    if (elements.length === 0) return;
    get().mutate((draft) => {
      const base = draft.elements.reduce((max, el) => Math.max(max, el.z), 0);
      elements.forEach((el, i) => {
        draft.elements.push({ ...el, z: base + i + 1 });
      });
    }, history);
    set({ selection: elements.map((e) => e.id) });
  },

  removeSelected: () => {
    const { selection } = get();
    if (selection.length === 0) return;
    const removed = new Set(selection);
    get().mutate((draft) => {
      draft.elements = draft.elements.filter((el) => !removed.has(el.id));
      draft.events = draft.events.filter((ev) => !removed.has(ev.triggerId));
      for (const ev of draft.events) {
        ev.steps = ev.steps.filter((s) => !s.targetId || !removed.has(s.targetId));
      }
    });
    set({ selection: [] });
  },

  duplicateSelected: () => {
    const { project, selection } = get();
    if (selection.length === 0) return;
    const sources = project.elements.filter((el) => selection.includes(el.id));
    const baseZ = project.elements.reduce((max, el) => Math.max(max, el.z), 0);
    const clones: CanvasElement[] = sources.map((el, i) => {
      const copy = structuredClone(el);
      copy.id = `${el.id.split("_")[0] || "el"}_${Math.random().toString(36).slice(2, 8)}`;
      copy.x += 36;
      copy.y += 36;
      copy.z = baseZ + i + 1;
      if (copy.character?.name) copy.character.name = `${copy.character.name} 副本`;
      return copy;
    });
    get().mutate((draft) => {
      draft.elements.push(...clones);
    });
    set({ selection: clones.map((c) => c.id) });
  },

  moveSelected: (dx, dy) => {
    const { selection } = get();
    if (selection.length === 0) return;
    get().mutate((draft) => {
      for (const el of draft.elements) {
        if (selection.includes(el.id) && !el.locked) {
          el.x += dx;
          el.y += dy;
        }
      }
    });
  },

  alignSelection: (mode) => {
    const { project, selection } = get();
    const els = project.elements.filter((el) => selection.includes(el.id));
    if (els.length < 2) return;
    const minX = Math.min(...els.map((e) => e.x));
    const maxX = Math.max(...els.map((e) => e.x + e.width));
    const minY = Math.min(...els.map((e) => e.y));
    const maxY = Math.max(...els.map((e) => e.y + e.height));
    get().mutate((draft) => {
      for (const el of draft.elements) {
        if (!selection.includes(el.id) || el.locked) continue;
        if (mode === "left") el.x = minX;
        if (mode === "right") el.x = maxX - el.width;
        if (mode === "hcenter") el.x = (minX + maxX) / 2 - el.width / 2;
        if (mode === "top") el.y = minY;
        if (mode === "bottom") el.y = maxY - el.height;
        if (mode === "vcenter") el.y = (minY + maxY) / 2 - el.height / 2;
      }
    });
  },

  equalizeSelection: () => {
    const { project, selection } = get();
    const els = project.elements.filter((el) => selection.includes(el.id));
    if (els.length < 2) return;
    const first = els[0];
    const ratio = first.height / Math.max(1, first.width);
    get().mutate((draft) => {
      for (const el of draft.elements) {
        if (!selection.includes(el.id) || el.locked) continue;
        el.width = first.width;
        el.height = first.width * ratio;
      }
    });
  },

  moveLayer: (id, dir) => {
    get().mutate((draft) => {
      const sorted = [...draft.elements].sort((a, b) => a.z - b.z);
      const index = sorted.findIndex((el) => el.id === id);
      if (index < 0) return;
      let next = index;
      if (dir === "up") next = Math.min(sorted.length - 1, index + 1);
      if (dir === "down") next = Math.max(0, index - 1);
      if (dir === "front") next = sorted.length - 1;
      if (dir === "back") next = 0;
      const [item] = sorted.splice(index, 1);
      sorted.splice(next, 0, item);
      sorted.forEach((el, i) => {
        el.z = i + 1;
      });
      draft.elements = sorted;
    });
  },

  toggleLock: (id) => {
    const el = get().project.elements.find((e) => e.id === id);
    if (el) get().updateElement(id, { locked: !el.locked });
  },

  toggleHidden: (id) => {
    const el = get().project.elements.find((e) => e.id === id);
    if (el) get().updateElement(id, { hidden: !el.hidden });
  },

  select: (id, additive = false) =>
    set((state) => {
      if (!id) return { selection: [] };
      if (!additive) return { selection: [id] };
      return state.selection.includes(id)
        ? { selection: state.selection.filter((s) => s !== id) }
        : { selection: [...state.selection, id] };
    }),

  selectMany: (ids) => set({ selection: [...new Set(ids)] }),

  setViewport: (v) => set({ viewport: v }),
  requestFit: () => set((s) => ({ fitTick: s.fitTick + 1 })),

  focusElement: (id) =>
    set((s) => ({ selection: [id], focusTick: s.focusTick + 1 })),

  addEvent: (event) => {
    get().mutate((draft) => {
      draft.events.push(event);
    });
  },

  updateEvent: (id, patch) => {
    get().mutate((draft) => {
      const ev = draft.events.find((e) => e.id === id);
      if (ev) Object.assign(ev, patch);
    });
  },

  removeEvent: (id) => {
    get().mutate((draft) => {
      draft.events = draft.events
        .filter((e) => e.id !== id)
        .map((e) => (e.nextEventId === id ? { ...e, nextEventId: null } : e));
    });
  },

  undo: () => {
    const { past, project, future } = get();
    if (past.length === 0) return;
    const previous = past[past.length - 1];
    set({
      project: previous,
      past: past.slice(0, -1),
      future: [project, ...future].slice(0, HISTORY_LIMIT),
      dirty: true,
      selection: [],
    });
  },

  redo: () => {
    const { future, project, past } = get();
    if (future.length === 0) return;
    const next = future[0];
    set({
      project: next,
      future: future.slice(1),
      past: [...past, project].slice(-HISTORY_LIMIT),
      dirty: true,
      selection: [],
    });
  },

  setSaveState: (saveState, saveError = null) => set({ saveState, saveError }),
  markSaved: (rev, updatedAt) =>
    set((s) => ({
      rev,
      dirty: false,
      saveState: "saved",
      saveError: null,
      project: updatedAt ? { ...s.project, updatedAt } : s.project,
    })),
  setProjectId: (projectId) => set({ projectId }),
  setConflict: (conflict) => set({ conflict }),
  setSnap: (snapEnabled) => set({ snapEnabled }),
  setGrid: (showGrid) => set({ showGrid }),
  togglePanel: (side) =>
    set((s) => (side === "left" ? { leftOpen: !s.leftOpen } : { rightOpen: !s.rightOpen })),
}));
