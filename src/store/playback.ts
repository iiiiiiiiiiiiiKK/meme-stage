import { create } from "zustand";
import type { PerformanceState } from "../lib/performance";

/**
 * Shared playback state for scripted performances.
 *
 * The visitor stage owns the runner, but the script timeline lives in the editor
 * dock. A tiny store lets the timeline highlight the cue that is speaking right
 * now without either component owning the other.
 */
interface PlaybackState {
  state: PerformanceState;
  index: number;
  performanceId: string | null;
  set: (patch: Partial<Omit<PlaybackState, "set">>) => void;
  reset: () => void;
}

export const usePlayback = create<PlaybackState>((set) => ({
  state: "idle",
  index: -1,
  performanceId: null,
  set: (patch) => set(patch),
  reset: () => set({ state: "idle", index: -1, performanceId: null }),
}));
