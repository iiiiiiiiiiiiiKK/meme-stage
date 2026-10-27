import { useEffect, useRef } from "react";
import { useEditor } from "../store/editor";
import { api, ApiRequestError } from "../lib/api";
import { rememberProject, saveDraft } from "../lib/local";
import type { ProjectData } from "../lib/types";

let inFlight: Promise<void> | null = null;
let queued = false;

function applySaved(snapshot: ProjectData, rev: number, updatedAt: number) {
  const unchanged = useEditor.getState().project === snapshot;
  if (unchanged) {
    useEditor.getState().markSaved(rev, updatedAt);
  } else {
    useEditor.setState({
      rev,
      saveState: "saved",
      dirty: true,
      saveError: null,
      conflict: false,
    });
  }
}

export async function persistNow(force = false): Promise<void> {
  const state = useEditor.getState();
  if (!state.dirty && !force) return;
  if (inFlight) {
    queued = true;
    return inFlight;
  }

  const snapshot = state.project;
  const draftKey = state.projectId ?? "new";
  saveDraft(draftKey, snapshot, state.rev);

  const task = (async () => {
    useEditor.getState().setSaveState("saving");
    try {
      if (!state.projectId) {
        const res = await api.createProject(snapshot);
        const latest = useEditor.getState();
        latest.setProjectId(res.id);
        rememberProject(res.id);
        applySaved(snapshot, res.rev, res.updatedAt);
        saveDraft(res.id, useEditor.getState().project, res.rev);
        return;
      }

      const res = await api.saveProject(state.projectId, snapshot, state.rev, force);
      applySaved(snapshot, res.rev, res.updatedAt);
      useEditor.getState().setConflict(false);
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 409 && state.projectId) {
        // Another tab (or a request that landed during a reload) advanced the
        // revision. Re-read the current revision and save the local state again —
        // the person in front of the screen always wins.
        try {
          const latest = await api.getProject(state.projectId);
          const retried = await api.saveProject(state.projectId, snapshot, latest.rev, false);
          applySaved(snapshot, retried.rev, retried.updatedAt);
          useEditor.getState().setConflict(false);
          return;
        } catch (retryError) {
          if (retryError instanceof ApiRequestError && retryError.status === 409) {
            // A request that was already in flight when the tab reloaded can land
            // between our GET and PUT. The on-screen state is authoritative here.
            try {
              const forced = await api.saveProject(state.projectId, snapshot, 0, true);
              applySaved(snapshot, forced.rev, forced.updatedAt);
              useEditor.getState().setConflict(false);
              return;
            } catch {
              useEditor.getState().setConflict(true);
              useEditor.getState().setSaveState("error", "这个作品在别处被修改过");
              return;
            }
          }
          useEditor
            .getState()
            .setSaveState("error", retryError instanceof Error ? retryError.message : "保存失败");
          return;
        }
      }

      if (error instanceof ApiRequestError) {
        if (error.status === 401) {
          useEditor.getState().setSaveState("error", "编辑器身份失效，请刷新页面");
        } else {
          useEditor.getState().setSaveState("error", error.message);
        }
      } else {
        const message = error instanceof Error ? error.message : "网络异常";
        useEditor.getState().setSaveState("error", `保存失败：${message}`);
      }
    } finally {
      inFlight = null;
      if (queued) {
        queued = false;
        void persistNow();
      }
    }
  })();

  inFlight = task;
  return task;
}

export function useAutosave(): void {
  const project = useEditor((s) => s.project);
  const dirty = useEditor((s) => s.dirty);
  const projectId = useEditor((s) => s.projectId);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!dirty) return;
    saveDraft(projectId ?? "new", project, useEditor.getState().rev);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void persistNow(), 1400);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [project, dirty, projectId]);

  useEffect(() => {
    const onOnline = () => {
      if (useEditor.getState().dirty) void persistNow();
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);
}
