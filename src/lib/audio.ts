import type { CanvasElement, VoiceClip } from "./types";

export type AudioMode = "single" | "mix";

interface PlaybackHandle {
  audio: HTMLAudioElement;
  url: string;
  stop: () => void;
}

/**
 * Small audio runtime shared by the editor preview and the public stage.
 * - never autoplays before a user gesture
 * - "single" mode interrupts the previous voice, "mix" allows overlap
 * - rejects nothing: failures are reported through onError so a broken clip
 *   cannot freeze an interaction chain
 */
export class AudioEngine {
  mode: AudioMode = "single";
  onError: ((message: string, clip: VoiceClip | null) => void) | null = null;
  onPlayingChange: ((playing: boolean) => void) | null = null;

  private active = new Set<PlaybackHandle>();
  private elements = new Map<string, HTMLAudioElement>();
  private current: PlaybackHandle | null = null;
  private unlocked = false;

  markUnlocked(): void {
    this.unlocked = true;
  }

  get isUnlocked(): boolean {
    return this.unlocked;
  }

  get isPlaying(): boolean {
    return this.active.size > 0;
  }

  preload(urls: string[]): void {
    for (const url of urls) {
      if (!url || this.elements.has(url)) continue;
      try {
        const audio = new Audio();
        audio.preload = "metadata";
        audio.src = url;
        this.elements.set(url, audio);
      } catch {
        // ignore — playback will report a real error later
      }
    }
  }

  stop(): void {
    for (const handle of Array.from(this.active)) handle.stop();
    this.active.clear();
    this.current = null;
    this.onPlayingChange?.(false);
  }

  stopFor(url: string): void {
    for (const handle of Array.from(this.active)) {
      if (handle.url === url) handle.stop();
    }
  }

  async play(clip: VoiceClip, mode: AudioMode = this.mode): Promise<void> {
    if (!clip?.url) return;
    if (mode === "single") {
      this.stop();
    } else {
      this.stopFor(clip.url);
    }

    let audio = this.elements.get(clip.url);
    if (!audio) {
      audio = new Audio();
      audio.preload = "auto";
      this.elements.set(clip.url, audio);
    }
    audio.src = clip.url;
    audio.volume = Math.max(0, Math.min(1, clip.volume ?? 1));

    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = (failed: boolean) => {
        if (settled) return;
        settled = true;
        this.active.delete(handle);
        if (this.current === handle) this.current = null;
        if (this.active.size === 0) this.onPlayingChange?.(false);
        if (failed) {
          this.onError?.(
            `「${clip.name || "语音"}」播放失败，请检查音频格式或网络`,
            clip,
          );
        }
        resolve();
      };

      const handle: PlaybackHandle = {
        audio,
        url: clip.url,
        stop: () => {
          try {
            audio.pause();
            audio.currentTime = 0;
          } catch {
            // ignore
          }
          finish(false);
        },
      };

      audio.onended = () => finish(false);
      audio.onerror = () => finish(true);

      this.active.add(handle);
      this.current = handle;
      this.unlocked = true;
      this.onPlayingChange?.(true);

      const attempt = audio.play();
      if (attempt && typeof attempt.catch === "function") {
        attempt.catch((err: unknown) => {
          const name = (err as { name?: string })?.name;
          if (name === "NotAllowedError") {
            this.onError?.("浏览器阻止了自动播放，请再点一次人物", clip);
          } else if (name === "AbortError") {
            // interrupted by a new clip — not an error
          } else {
            this.onError?.(`「${clip.name || "语音"}」无法播放（${name ?? "未知错误"}）`, clip);
          }
          finish(false);
        });
      }
    });
  }

  async preview(url: string, volume = 1, name = "语音"): Promise<void> {
    return this.play({ id: "preview", name, url, duration: 0, volume }, "single");
  }
}

export const audioEngine = new AudioEngine();

export function elementVoices(el: CanvasElement | undefined): VoiceClip[] {
  return el?.type === "character" ? el.character?.voices ?? [] : [];
}
