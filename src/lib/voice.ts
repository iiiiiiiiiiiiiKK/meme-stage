import type { VoiceClip, VoiceMode } from "./types";

/**
 * Picks the clip for the next playback.
 *
 * - `cycle`: A → B → C → A (default; "点一下就换一个")
 * - `random`: never repeats the previous clip when there is more than one
 * - an explicit `clipId` (from an interaction step) always wins
 *
 * `lastIndex` is the index that played previously (-1 when nothing has played).
 */
export function chooseVoice(
  voices: VoiceClip[],
  mode: VoiceMode,
  lastIndex: number,
  clipId?: string,
  random: () => number = Math.random,
): { clip: VoiceClip; index: number } | null {
  if (!voices || voices.length === 0) return null;

  if (clipId) {
    const explicit = voices.findIndex((clip) => clip.id === clipId);
    if (explicit >= 0) return { clip: voices[explicit], index: explicit };
  }

  if (voices.length === 1) return { clip: voices[0], index: 0 };

  let index: number;
  if (mode === "random") {
    index = Math.floor(random() * voices.length) % voices.length;
    if (index === lastIndex) index = (index + 1) % voices.length;
  } else {
    index = (lastIndex + 1) % voices.length;
  }
  return { clip: voices[index], index };
}
