import { describe, expect, it } from "vitest";
import { normalizeProject, normalizeForStorage, safeUrl, ValidationError } from "../../src/lib/schema";
import { createCharacter, createProject, createText, makeBubble } from "../../src/lib/defaults";

function baseProject() {
  const project = createProject();
  const el = createCharacter({
    name: "老K",
    imageUrl: "/demo/k.png",
    width: 300,
    height: 400,
    x: 100,
    y: 120,
  });
  el.character!.line = "兄弟们，这波真的不亏。";
  project.elements = [el];
  project.events = [
    {
      id: "ev_1",
      name: "test",
      triggerId: el.id,
      steps: [{ id: "s1", type: "say", targetId: el.id, text: "hi", ms: 1200 }],
      nextEventId: null,
      enabled: true,
    },
  ];
  return project;
}

describe("project schema", () => {
  it("accepts a valid project", () => {
    const normalized = normalizeProject(baseProject());
    expect(normalized.elements).toHaveLength(1);
    expect(normalized.elements[0].z).toBe(1);
    expect(normalized.title).toBe("未命名作品");
  });

  it("rejects duplicate element ids", () => {
    const project = baseProject();
    project.elements.push({ ...project.elements[0] });
    expect(() => normalizeProject(project)).toThrow(ValidationError);
  });

  it("rejects events pointing at missing elements", () => {
    const project = baseProject();
    project.events[0].triggerId = "ghost";
    expect(() => normalizeProject(project)).toThrow(/不存在/);
  });

  it("rejects unsupported element types and step types", () => {
    const project = baseProject();
    (project.elements[0] as unknown as { type: string }).type = "video";
    expect(() => normalizeProject(project)).toThrow(/不支持的元素类型/);
    const ok = baseProject();
    (ok.events[0].steps[0] as unknown as { type: string }).type = "rm -rf";
    expect(() => normalizeProject(ok)).toThrow(/未知的互动动作/);
  });

  it("blocks javascript: and protocol-relative urls", () => {
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("//evil.example/x.png")).toBeNull();
    expect(safeUrl("/api/files/abc")).toBe("/api/files/abc");
    expect(safeUrl("https://evil.example/x.png")).toBeNull();
    const project = baseProject();
    project.elements[0].character!.imageUrl = "javascript:alert(1)";
    expect(() => normalizeProject(project)).toThrow(/有效图片/);
  });

  it("sanitises colours and clamps numbers", () => {
    const project = baseProject();
    project.elements[0].character!.bubble.bg = "url(javascript:alert(1))";
    project.elements[0].width = 999999;
    project.elements[0].opacity = 5;
    project.elements[0].rotation = Number.POSITIVE_INFINITY;
    const normalized = normalizeProject(project);
    expect(normalized.elements[0].character!.bubble.bg).toBe("#ffffff");
    expect(normalized.elements[0].width).toBeLessThanOrEqual(20000);
    expect(normalized.elements[0].opacity).toBe(1);
    expect(normalized.elements[0].rotation).toBe(0);
  });

  it("caps element count", () => {
    const project = baseProject();
    const template = project.elements[0];
    project.elements = Array.from({ length: 301 }, (_, i) => ({
      ...structuredClone(template),
      id: `el_${i}`,
    }));
    expect(() => normalizeProject(project)).toThrow(/最多/);
  });

  it("keeps z order stable and contiguous", () => {
    const project = baseProject();
    const second = createText({ content: "hi" });
    second.z = 0;
    project.elements.push(second);
    const normalized = normalizeProject(project);
    expect(normalized.elements.map((el) => el.z)).toEqual([1, 2]);
  });

  it("migrates the legacy single-voice field into a voice list", () => {
    const raw = baseProject() as unknown as {
      elements: { character: Record<string, unknown> }[];
    };
    delete raw.elements[0].character.voices;
    raw.elements[0].character.voice = {
      id: "legacy",
      name: "旧语音",
      url: "/demo/voice-k.wav",
      duration: 3.2,
      volume: 0.8,
    };
    const normalized = normalizeProject(raw);
    const voices = normalized.elements[0].character!.voices;
    expect(voices).toHaveLength(1);
    expect(voices[0].id).toBe("legacy");
    expect(voices[0].url).toBe("/demo/voice-k.wav");
    expect(normalized.elements[0].character!.voiceMode).toBe("cycle");
  });

  it("keeps multiple valid voices, drops unsafe ones and normalises the mode", () => {
    const project = baseProject();
    project.elements[0].character!.voices = [
      { id: "v1", name: "一", url: "/a.wav", duration: 1, volume: 1, line: "第一句" },
      { id: "v2", name: "二", url: "javascript:alert(1)", duration: 1, volume: 1 },
      { id: "v3", name: "三", url: "/c.wav", duration: 2, volume: 1 },
    ];
    (project.elements[0].character as unknown as { voiceMode: string }).voiceMode = "random";
    const normalized = normalizeProject(project);
    const character = normalized.elements[0].character!;
    expect(character.voices.map((v) => v.id)).toEqual(["v1", "v3"]);
    expect(character.voices[0].line).toBe("第一句");
    expect(character.voiceMode).toBe("random");
  });

  it("caps the voice list per character", () => {
    const project = baseProject();
    project.elements[0].character!.voices = Array.from({ length: 40 }, (_, i) => ({
      id: `v${i}`,
      name: `v${i}`,
      url: `/v${i}.wav`,
      duration: 1,
      volume: 1,
    }));
    expect(normalizeProject(project).elements[0].character!.voices).toHaveLength(20);
  });

  it("normalises bubble placement and falls back to safe defaults", () => {
    const project = baseProject();
    const character = project.elements[0].character as unknown as Record<string, unknown>;
    delete character.bubblePlacement;
    const normalized = normalizeProject(project);
    expect(normalized.elements[0].character!.bubblePlacement).toEqual({
      anchor: "auto",
      offsetX: 0,
      offsetY: 0,
      maxWidth: 300,
    });

    const raw = baseProject() as unknown as { elements: { character: Record<string, unknown> }[] };
    raw.elements[0].character.bubblePlacement = {
      anchor: "evil",
      offsetX: 99999,
      offsetY: -99999,
      maxWidth: 5000,
    };
    const clamped = normalizeProject(raw).elements[0].character!.bubblePlacement;
    expect(clamped.anchor).toBe("auto");
    expect(clamped.offsetX).toBeLessThanOrEqual(5000);
    expect(clamped.offsetY).toBeGreaterThanOrEqual(-5000);
    expect(clamped.maxWidth).toBe(640);
  });

  it("keeps text-to-speech metadata on voice clips", () => {
    const project = baseProject();
    project.elements[0].character!.voices = [
      {
        id: "tts1",
        name: "文字语音",
        url: "/api/files/tts",
        duration: 2.4,
        volume: 1,
        line: "你好，世界。",
        source: "tts",
        rate: 1.2,
        lang: "zh",
      },
    ];
    const clip = normalizeProject(project).elements[0].character!.voices[0];
    expect(clip).toMatchObject({ source: "tts", rate: 1.2, lang: "zh", line: "你好，世界。" });
  });

  it("clamps playback rate and drops unknown TTS languages", () => {
    const project = baseProject();
    project.elements[0].character!.voices = [
      { id: "a", name: "a", url: "/a.wav", duration: 1, volume: 1, rate: 9, lang: "xx", source: "weird" as never },
    ];
    const clip = normalizeProject(project).elements[0].character!.voices[0];
    expect(clip.rate).toBe(2);
    expect(clip.lang).toBeUndefined();
    expect(clip.source).toBeUndefined();
  });

  it("keeps device speech clips without an audio file", () => {
    const project = baseProject();
    project.elements[0].character!.voices = [
      {
        id: "dev1",
        name: "设备朗读",
        url: "",
        duration: 1.8,
        volume: 1,
        source: "device",
        text: "这波真的不亏。",
        lang: "zh-CN",
        rate: 1.2,
        pitch: 1.1,
        voiceURI: "Microsoft Huihui",
      },
      { id: "bad", name: "空设备语音", url: "", duration: 0, volume: 1, source: "device", text: "" },
    ];
    const voices = normalizeProject(project).elements[0].character!.voices;
    expect(voices).toHaveLength(1);
    expect(voices[0]).toMatchObject({
      source: "device",
      text: "这波真的不亏。",
      voiceURI: "Microsoft Huihui",
      rate: 1.2,
      pitch: 1.1,
    });
  });

  it("serialises to a stable JSON document", () => {
    const project = baseProject();
    const { json, project: normalized } = normalizeForStorage(project);
    expect(JSON.parse(json)).toEqual(normalized);
  });

  it("normalizes unknown bubble preset to a safe value", () => {
    const project = baseProject();
    (project.elements[0].character!.bubble as unknown as { preset: string }).preset = "evil";
    const normalized = normalizeProject(project);
    expect(normalized.elements[0].character!.bubble.preset).toBe(makeBubble("comic").preset);
  });
});
