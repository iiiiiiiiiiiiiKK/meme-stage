import { describe, expect, it } from "vitest";
import { estimateSpeechSeconds, pickDeviceVoice } from "../../src/lib/deviceSpeech";

const voices = [
  { voiceURI: "en-us", lang: "en-US", default: false },
  { voiceURI: "zh-cn", lang: "zh-CN", default: true },
  { voiceURI: "zh-tw", lang: "zh-TW", default: false },
];

describe("device speech helpers", () => {
  it("estimates short CJK lines at least 1.1s and scales with rate", () => {
    const normal = estimateSpeechSeconds("这波真的不亏。");
    expect(normal).toBeGreaterThanOrEqual(1.1);
    expect(estimateSpeechSeconds("这波真的不亏。", 1.5)).toBeLessThan(normal);
    expect(estimateSpeechSeconds("hello world this is a test", 1)).toBeGreaterThan(1);
  });

  it("matches the saved voice URI first", () => {
    expect(pickDeviceVoice(voices, { voiceURI: "zh-tw", lang: "en-US" })?.voiceURI).toBe("zh-tw");
  });

  it("falls back to the same language, then language family, then default", () => {
    expect(pickDeviceVoice(voices, { lang: "zh-CN" })?.voiceURI).toBe("zh-cn");
    expect(pickDeviceVoice(voices, { lang: "zh-HK" })?.voiceURI).toBe("zh-cn");
    expect(pickDeviceVoice(voices, { lang: "fr-FR" })?.voiceURI).toBe("zh-cn");
    expect(pickDeviceVoice([], { lang: "zh" })).toBeNull();
  });
});
