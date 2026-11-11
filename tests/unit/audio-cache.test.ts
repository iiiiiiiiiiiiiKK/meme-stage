import { describe, expect, it } from "vitest";
import { AudioEngine } from "../../src/lib/audio";

/** minimal HTMLAudioElement stand-in for cache/eviction tests */
class FakeAudio {
  src = "";
  preload = "";
  volume = 1;
  playbackRate = 1;
  preservesPitch = true;
  paused = true;
  currentTime = 0;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    created.push(this);
  }
  load() {}
  play() {
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  removeAttribute(name: string) {
    if (name === "src") this.src = "";
  }
  addEventListener() {}
}

const created: FakeAudio[] = [];

function withFakeAudio<T>(fn: () => T): T {
  const g = globalThis as unknown as { Audio: unknown };
  const original = g.Audio;
  created.length = 0;
  g.Audio = FakeAudio as unknown as typeof Audio;
  try {
    return fn();
  } finally {
    g.Audio = original;
  }
}

describe("AudioEngine cache", () => {
  it("does not create a second element for an already warm url", () => {
    withFakeAudio(() => {
      const engine = new AudioEngine();
      engine.preload(["/a.wav", "/b.wav"]);
      engine.preload(["/a.wav", "/b.wav"]);
      expect(created).toHaveLength(2);
    });
  });

  it("evicts idle clips beyond the cache bound", () => {
    withFakeAudio(() => {
      const engine = new AudioEngine();
      const urls = Array.from({ length: AudioEngine.MAX_CACHED_CLIPS + 12 }, (_, i) => `/clip-${i}.wav`);
      engine.preload(urls);
      // bounded, and newest entries survive
      expect(created.length).toBe(urls.length);
      const live = (engine as unknown as { elements: Map<string, FakeAudio> }).elements;
      expect(live.size).toBeLessThanOrEqual(AudioEngine.MAX_CACHED_CLIPS);
      expect(live.has(urls[urls.length - 1])).toBe(true);
      expect(live.has(urls[0])).toBe(false);
    });
  });

  it("keeps a playing clip during eviction", () => {
    withFakeAudio(() => {
      const engine = new AudioEngine();
      const live = (engine as unknown as { elements: Map<string, FakeAudio> }).elements;
      engine.preload(["/keep.wav"]);
      const playing = live.get("/keep.wav")!;
      playing.paused = false;
      engine.preload(Array.from({ length: AudioEngine.MAX_CACHED_CLIPS }, (_, i) => `/filler-${i}.wav`));
      expect(live.has("/keep.wav")).toBe(true);
    });
  });

  it("release() drops every buffered clip", () => {
    withFakeAudio(() => {
      const engine = new AudioEngine();
      engine.preload(["/a.wav", "/b.wav"]);
      engine.release();
      const live = (engine as unknown as { elements: Map<string, FakeAudio> }).elements;
      expect(live.size).toBe(0);
      expect(created.every((audio) => audio.src === "")).toBe(true);
    });
  });
});
