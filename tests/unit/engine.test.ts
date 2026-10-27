import { describe, expect, it } from "vitest";
import { InteractionRunner, pickEvent } from "../../src/lib/engine";
import { createCharacter, createProject } from "../../src/lib/defaults";
import { chooseVoice } from "../../src/lib/voice";
import type { CanvasElement, ProjectData, VoiceClip } from "../../src/lib/types";

function projectWithTwo(): { project: ProjectData; a: CanvasElement; b: CanvasElement } {
  const project = createProject();
  const a = createCharacter({ name: "A", imageUrl: "/a.png", width: 200, height: 300, x: 10, y: 10 });
  const b = createCharacter({ name: "B", imageUrl: "/b.png", width: 200, height: 300, x: 300, y: 10 });
  a.character!.voices = [{ id: "va", name: "va", url: "/va.wav", duration: 0.2, volume: 1 }];
  b.character!.voices = [{ id: "vb", name: "vb", url: "/vb.wav", duration: 0.2, volume: 1 }];
  a.character!.line = "A LINE";
  b.character!.line = "B LINE";
  project.elements = [a, b];
  return { project, a, b };
}

function makeHooks(project: ProjectData, log: string[]) {
  const cursors = new Map<string, number>();
  return {
    getProject: () => project,
    getElement: (id: string) => project.elements.find((el) => el.id === id),
    nextVoice: (el: CanvasElement, clipId?: string) => {
      const voices = el.character?.voices ?? [];
      const picked = chooseVoice(voices, el.character?.voiceMode ?? "cycle", cursors.get(el.id) ?? -1, clipId);
      if (picked) cursors.set(el.id, picked.index);
      return picked?.clip ?? null;
    },
    playVoice: async (el: CanvasElement, clip: VoiceClip) => {
      log.push(`voice:${el.character?.name}:${clip.id}`);
    },
    showBubble: (el: CanvasElement, text: string) => {
      log.push(`say:${el.character?.name}:${text}`);
    },
    hideBubble: (id: string) => log.push(`hide:${id}`),
    animate: (el: CanvasElement, anim: string) => log.push(`anim:${el.character?.name}:${anim}`),
    setHidden: (el: CanvasElement, hidden: boolean) => log.push(`hidden:${el.character?.name}:${hidden}`),
    moveBy: (el: CanvasElement, dx: number, dy: number) => log.push(`move:${el.character?.name}:${dx}:${dy}`),
    flash: () => log.push("flash"),
    wait: async () => Promise.resolve(),
    onError: (message: string) => log.push(`error:${message}`),
  };
}

describe("interaction runner", () => {
  it("falls back to voice + line when a character has no script", async () => {
    const { project, a } = projectWithTwo();
    const log: string[] = [];
    const runner = new InteractionRunner(makeHooks(project, log));
    await runner.trigger(a.id);
    expect(log.some((line) => line === "voice:A:va")).toBe(true);
    expect(log.some((line) => line.startsWith("say:A:A LINE"))).toBe(true);
  });

  it("runs event steps in order and supports chaining", async () => {
    const { project, a, b } = projectWithTwo();
    project.events = [
      {
        id: "e1",
        name: "first",
        triggerId: a.id,
        enabled: true,
        nextEventId: "e2",
        steps: [
          { id: "s1", type: "animate", targetId: a.id, animation: "bounce" },
          { id: "s2", type: "say", targetId: a.id, text: "line A", ms: 1000 },
          { id: "s3", type: "playAudio", targetId: a.id },
        ],
      },
      {
        id: "e2",
        name: "second",
        triggerId: b.id,
        enabled: true,
        nextEventId: null,
        steps: [{ id: "s4", type: "playAudio", targetId: b.id }],
      },
    ];
    const log: string[] = [];
    const runner = new InteractionRunner(makeHooks(project, log));
    await runner.trigger(a.id);
    expect(log).toEqual([
      "anim:A:bounce",
      "say:A:line A",
      "hide:" + a.id,
      "voice:A:va",
      "voice:B:vb",
    ]);
  });

  it("supports parallel steps (bubble starts before voice finishes)", async () => {
    const { project, a } = projectWithTwo();
    project.events = [
      {
        id: "e1",
        name: "parallel",
        triggerId: a.id,
        enabled: true,
        nextEventId: null,
        steps: [
          { id: "s1", type: "say", targetId: a.id, text: "hi", ms: 800, parallel: true },
          { id: "s2", type: "playAudio", targetId: a.id },
        ],
      },
    ];
    const log: string[] = [];
    const runner = new InteractionRunner(makeHooks(project, log));
    await runner.trigger(a.id);
    expect(log[0]).toBe("say:A:hi");
    expect(log).toContain("voice:A:va");
  });

  it("blocks infinite nextEvent cycles instead of hanging", async () => {
    const { project, a } = projectWithTwo();
    project.events = [
      {
        id: "e1",
        name: "loop",
        triggerId: a.id,
        enabled: true,
        nextEventId: "e2",
        steps: [{ id: "s1", type: "playAudio", targetId: a.id }],
      },
      {
        id: "e2",
        name: "loop2",
        triggerId: a.id,
        enabled: true,
        nextEventId: "e1",
        steps: [{ id: "s2", type: "playAudio", targetId: a.id }],
      },
    ];
    const log: string[] = [];
    const runner = new InteractionRunner(makeHooks(project, log));
    await runner.trigger(a.id);
    expect(log.filter((l) => l.startsWith("error:")).length).toBeGreaterThan(0);
    expect(log.filter((l) => l === "voice:A:va").length).toBeLessThan(5);
  });

  it("reports a missing voice instead of failing silently", async () => {
    const { project, a } = projectWithTwo();
    a.character!.voices = [];
    project.events = [
      {
        id: "e1",
        name: "novoice",
        triggerId: a.id,
        enabled: true,
        nextEventId: null,
        steps: [{ id: "s1", type: "playAudio", targetId: a.id }],
      },
    ];
    const log: string[] = [];
    const runner = new InteractionRunner(makeHooks(project, log));
    await runner.trigger(a.id);
    expect(log.some((line) => line.startsWith("error:"))).toBe(true);
  });

  it("cancels the previous run when the user taps again", async () => {
    const { project, a } = projectWithTwo();
    const resolvers: (() => void)[] = [];
    const log: string[] = [];
    const hooks = makeHooks(project, log);
    hooks.playVoice = (el: CanvasElement, clip: VoiceClip) =>
      new Promise<void>((resolve) => {
        log.push(`voice:${el.character?.name}:${clip.id}`);
        resolvers.push(resolve);
      });
    project.events = [
      {
        id: "e1",
        name: "long",
        triggerId: a.id,
        enabled: true,
        nextEventId: null,
        steps: [
          { id: "s1", type: "playAudio", targetId: a.id },
          { id: "s2", type: "say", targetId: a.id, text: "after" },
        ],
      },
    ];
    const runner = new InteractionRunner(hooks);
    const first = runner.trigger(a.id);
    await Promise.resolve();
    const second = runner.trigger(a.id);
    await Promise.resolve();
    for (const resolve of resolvers) resolve();
    await Promise.all([first, second]);
    expect(log.filter((l) => l === "voice:A:va").length).toBeGreaterThanOrEqual(2);
    expect(log.filter((l) => l.startsWith("say:A:after")).length).toBeLessThanOrEqual(1);
  });

  it("cycles through multiple voices when the same character is tapped again", async () => {
    const { project, a } = projectWithTwo();
    a.character!.voices = [
      { id: "v1", name: "v1", url: "/v1.wav", duration: 0.1, volume: 1, line: "第一句" },
      { id: "v2", name: "v2", url: "/v2.wav", duration: 0.1, volume: 1, line: "第二句" },
    ];
    const log: string[] = [];
    const runner = new InteractionRunner(makeHooks(project, log));
    await runner.trigger(a.id);
    await runner.trigger(a.id);
    await runner.trigger(a.id);
    expect(log.filter((line) => line.startsWith("voice:A:"))).toEqual([
      "voice:A:v1",
      "voice:A:v2",
      "voice:A:v1",
    ]);
    expect(log).toContain("say:A:第一句");
    expect(log).toContain("say:A:第二句");
  });

  it("plays the exact clip chosen by an interaction step", async () => {
    const { project, a } = projectWithTwo();
    a.character!.voices = [
      { id: "v1", name: "v1", url: "/v1.wav", duration: 0.1, volume: 1 },
      { id: "v2", name: "v2", url: "/v2.wav", duration: 0.1, volume: 1 },
    ];
    project.events = [
      {
        id: "e1",
        name: "pick second",
        triggerId: a.id,
        enabled: true,
        nextEventId: null,
        steps: [{ id: "s1", type: "playAudio", targetId: a.id, clipId: "v2" }],
      },
    ];
    const log: string[] = [];
    const runner = new InteractionRunner(makeHooks(project, log));
    await runner.trigger(a.id);
    expect(log.filter((line) => line.startsWith("voice:A:"))).toEqual(["voice:A:v2"]);
  });

  it("pickEvent ignores disabled events", () => {
    const { project, a } = projectWithTwo();
    project.events = [
      {
        id: "e1",
        name: "off",
        triggerId: a.id,
        enabled: false,
        nextEventId: null,
        steps: [{ id: "s1", type: "say", targetId: a.id, text: "x" }],
      },
    ];
    expect(pickEvent(project, a.id)).toBeNull();
  });
});
