import type { CanvasElement, VoiceClip } from "./types";
import { isDeviceSpeechSupported, listDeviceVoices, pickDeviceVoice } from "./deviceSpeech";

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
  private deviceStop: (() => void) | null = null;
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
    if (this.deviceStop) {
      const stop = this.deviceStop;
      this.deviceStop = null;
      stop();
    }
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
    if (!clip) return;
    if (clip.source === "device") return this.speakDevice(clip, mode);
    if (!clip.url) return;
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
    audio.playbackRate = Math.max(0.5, Math.min(2, clip.rate ?? 1));
    audio.preservesPitch = true;
    (audio as HTMLAudioElement & { mozPreservesPitch?: boolean }).mozPreservesPitch = true;

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

  /** browser speechSynthesis: no files, no keys — the visitor's device speaks */
  private speakDevice(clip: VoiceClip, mode: AudioMode): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!isDeviceSpeechSupported()) {
        this.onError?.("当前浏览器不支持系统朗读，请改用云端语音", clip);
        resolve();
        return;
      }
      const synth = window.speechSynthesis;
      if (mode === "single") this.stop();

      const text = (clip.text ?? clip.line ?? "").trim();
      if (!text) {
        resolve();
        return;
      }

      const utterance = new SpeechSynthesisUtterance(text);
      const voice = pickDeviceVoice(listDeviceVoices(), clip);
      if (voice) utterance.voice = voice;
      utterance.lang = voice?.lang || clip.lang || "zh-CN";
      utterance.rate = Math.max(0.5, Math.min(2, clip.rate ?? 1));
      utterance.pitch = Math.max(0.5, Math.min(2, clip.pitch ?? 1));
      utterance.volume = Math.max(0, Math.min(1, clip.volume ?? 1));

      let settled = false;
      const finish = (failed = false) => {
        if (settled) return;
        settled = true;
        if (this.deviceStop === stop) this.deviceStop = null;
        clearTimeout(timer);
        this.onPlayingChange?.(false);
        if (failed) this.onError?.("系统朗读失败，可能是浏览器拦截或没有可用声音", clip);
        resolve();
      };
      const stop = () => {
        try {
          synth.cancel();
        } catch {
          // ignore
        }
        finish(false);
      };
      this.deviceStop = stop;
      utterance.onend = () => finish(false);
      utterance.onerror = (event) => {
        const reason = (event as SpeechSynthesisErrorEvent).error;
        finish(reason !== "interrupted" && reason !== "canceled");
      };
      const timer = setTimeout(() => {
        try {
          synth.cancel();
        } catch {
          // ignore
        }
        finish(true);
      }, 30_000);

      this.onPlayingChange?.(true);
      try {
        synth.speak(utterance);
      } catch {
        finish(true);
      }
    });
  }
}

export const audioEngine = new AudioEngine();

export function elementVoices(el: CanvasElement | undefined): VoiceClip[] {
  return el?.type === "character" ? el.character?.voices ?? [] : [];
}
