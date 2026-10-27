import type { VoiceClip } from "./types";

/** rough duration used for bubble timing when the browser owns the audio */
export function estimateSpeechSeconds(text: string, rate = 1): number {
  const chars = Array.from(text).length;
  const cjk = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(text);
  const seconds = cjk ? chars * 0.22 : Math.max(1, text.trim().split(/\s+/).length) * 0.42;
  return Math.max(1.1, Math.round((seconds / Math.max(0.5, rate)) * 10) / 10);
}

/** picks the closest browser voice for a device clip */
export function pickDeviceVoice<T extends { voiceURI: string; lang: string; default?: boolean }>(
  voices: T[],
  clip: Pick<VoiceClip, "voiceURI" | "lang">,
): T | null {
  if (!voices || voices.length === 0) return null;
  if (clip.voiceURI) {
    const exact = voices.find((voice) => voice.voiceURI === clip.voiceURI);
    if (exact) return exact;
  }
  const lang = (clip.lang ?? "").toLowerCase();
  if (lang) {
    const same = voices.find((voice) => voice.lang?.toLowerCase() === lang);
    if (same) return same;
    const prefix = lang.split("-")[0];
    const family = voices.find((voice) => voice.lang?.toLowerCase().startsWith(prefix));
    if (family) return family;
  }
  return voices.find((voice) => voice.default) ?? voices[0];
}

export function isDeviceSpeechSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof window.SpeechSynthesisUtterance === "function"
  );
}

export function listDeviceVoices(): SpeechSynthesisVoice[] {
  if (!isDeviceSpeechSupported()) return [];
  try {
    return window.speechSynthesis.getVoices();
  } catch {
    return [];
  }
}
