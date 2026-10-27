import { describe, expect, it } from "vitest";
import { chooseVoice } from "../../src/lib/voice";
import type { VoiceClip } from "../../src/lib/types";

const clip = (id: string): VoiceClip => ({
  id,
  name: id,
  url: `/${id}.wav`,
  duration: 1,
  volume: 1,
});

const voices = [clip("a"), clip("b"), clip("c")];

describe("voice selection", () => {
  it("returns null without clips", () => {
    expect(chooseVoice([], "cycle", -1)).toBeNull();
  });

  it("cycles A → B → C → A", () => {
    let last = -1;
    const order: string[] = [];
    for (let i = 0; i < 4; i++) {
      const picked = chooseVoice(voices, "cycle", last);
      order.push(picked!.clip.id);
      last = picked!.index;
    }
    expect(order).toEqual(["a", "b", "c", "a"]);
  });

  it("starts at the first clip for a new character", () => {
    expect(chooseVoice(voices, "cycle", -1)?.clip.id).toBe("a");
  });

  it("never repeats the previous clip in random mode", () => {
    let last = -1;
    for (let i = 0; i < 40; i++) {
      const picked = chooseVoice(voices, "random", last, undefined, () => 0.99);
      expect(picked!.index).not.toBe(last);
      last = picked!.index;
    }
  });

  it("honours an explicit clip id", () => {
    expect(chooseVoice(voices, "cycle", -1, "b")?.clip.id).toBe("b");
    expect(chooseVoice(voices, "cycle", -1, "missing")?.clip.id).toBe("a");
  });

  it("always returns the only clip", () => {
    expect(chooseVoice([clip("solo")], "random", 0, undefined, () => 0.5)?.clip.id).toBe("solo");
  });
});
