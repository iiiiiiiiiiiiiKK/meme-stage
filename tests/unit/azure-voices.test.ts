import { describe, expect, it } from "vitest";
import { AZURE_VOICES, buildAzureSsml, escapeXml, rateToPercent } from "../../src/lib/azureVoices";

describe("Azure speech helpers", () => {
  it("includes Chinese voices with style lists", () => {
    const xiaoxiao = AZURE_VOICES.find((voice) => voice.id === "zh-CN-XiaoxiaoNeural");
    expect(xiaoxiao?.locale).toBe("zh-CN");
    expect(xiaoxiao?.styles).toContain("cheerful");
  });

  it("builds SSML with style and rate", () => {
    const ssml = buildAzureSsml({
      text: "这波真的不亏。",
      voiceId: "zh-CN-XiaoxiaoNeural",
      style: "cheerful",
      rate: 1.2,
    });
    expect(ssml).toContain('<voice name="zh-CN-XiaoxiaoNeural">');
    expect(ssml).toContain('<mstts:express-as style="cheerful">');
    expect(ssml).toContain('rate="+20%"');
    expect(ssml).toContain("这波真的不亏。");
  });

  it("omits express-as for the default style", () => {
    const ssml = buildAzureSsml({ text: "hi", voiceId: "en-US-AriaNeural", style: "general" });
    expect(ssml).not.toContain("express-as");
    expect(ssml).toContain('xml:lang="en-US"');
  });

  it("falls back to the default style when a voice does not support it", () => {
    const ssml = buildAzureSsml({
      text: "hi",
      voiceId: "ko-KR-SunHiNeural",
      style: "cheerful",
    });
    expect(ssml).not.toContain("express-as");
  });

  it("escapes XML in user text", () => {
    expect(escapeXml('<script> & "x"')).toBe("&lt;script&gt; &amp; &quot;x&quot;");
    const ssml = buildAzureSsml({
      text: "<b>hi</b> & bye",
      voiceId: "zh-CN-YunxiNeural",
    });
    expect(ssml).toContain("&lt;b&gt;hi&lt;/b&gt; &amp; bye");
  });

  it("converts speed to prosody percentages", () => {
    expect(rateToPercent(1)).toBe("+0%");
    expect(rateToPercent(0.8)).toBe("-20%");
    expect(rateToPercent(1.5)).toBe("+50%");
    expect(rateToPercent(99)).toBe("+100%");
  });

  it("rejects unknown voices", () => {
    expect(() => buildAzureSsml({ text: "x", voiceId: "nope" })).toThrow();
  });
});
