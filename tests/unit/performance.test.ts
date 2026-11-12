import { describe, expect, it, vi } from "vitest";
import { PerformanceRunner, type PerformanceState } from "../../src/lib/performance";
import type { Performance, VoiceClip } from "../../src/lib/types";

const clip = (id: string, duration = 0.3, line = ""): VoiceClip => ({
  id,
  name: id,
  url: `/api/files/${id}`,
  duration,
  volume: 1,
  line,
});

function makeHooks(cuesByActor: Record<string, VoiceClip[]>) {
  const log: string[] = [];
  const effects: string[] = [];
  const hooks = {
    log,
    effects,
    getProject: () => ({
      elements: Object.keys(cuesByActor).map((id) => ({
        id,
        character: { voices: cuesByActor[id], name: id },
      })),
    }),
    resolveClip: (actorId: string, clipId?: string) => {
      const voices = cuesByActor[actorId] ?? [];
      return clipId ? voices.find((v) => v.id === clipId) ?? null : voices[0] ?? null;
    },
    playVoice: async (actorId: string, played: VoiceClip) => {
      log.push(`play:${actorId}:${played.id}`);
      await new Promise((r) => setTimeout(r, 20));
    },
    stopAudio: () => log.push("stop"),
    pauseAudio: () => log.push("pause-audio"),
    resumeAudio: () => log.push("resume-audio"),
    showBubble: (actorId: string, text: string) => log.push(`bubble:${actorId}:${text}`),
    hideBubble: () => undefined,
    animate: (actorId: string, anim: string) => log.push(`anim:${actorId}:${anim}`),
    moveBy: () => undefined,
    spotlight: () => undefined,
    playEffect: (_actorId: string, fx: { id: string }) => {
      effects.push(fx.id);
      return () => log.push(`fx-end:${fx.id}`);
    },
    clearEffects: () => log.push("clear-effects"),
    lipFlap: () => undefined,
    wait: (ms: number) => new Promise<void>((r) => setTimeout(r, Math.min(ms, 15))),
  };
  return hooks;
}

const perf = (cues: Performance["cues"]): Performance => ({
  id: "pf1",
  name: "小品",
  cues,
  loop: false,
});

describe("PerformanceRunner", () => {
  it("plays cues in script order and reports state", async () => {
    const hooks = makeHooks({ a: [clip("a1", 0.2, "第一句")], b: [clip("b1", 0.2, "第二句")] });
    const states: PerformanceState[] = [];
    const runner = new PerformanceRunner({ ...hooks, onState: (s) => states.push(s) });
    await runner.play(
      perf([
        { id: "c1", actorId: "a", waitAfter: 0 },
        { id: "c2", actorId: "b", waitAfter: 0 },
      ]),
    );
    expect(hooks.log.filter((l) => l.startsWith("play:"))).toEqual(["play:a:a1", "play:b:b1"]);
    expect(states).toEqual(["playing", "finished"]);
  });

  it("honours per-cue animation, spotlight bubbles and effects", async () => {
    const hooks = makeHooks({ a: [clip("a1", 0.2, "台词")] });
    const runner = new PerformanceRunner(hooks);
    await runner.play(
      perf([
        {
          id: "c1",
          actorId: "a",
          animation: "shake",
          spotlight: true,
          waitAfter: 0,
        },
      ]),
    );
    expect(hooks.log).toContain("anim:a:shake");
    expect(hooks.log).toContain("bubble:a:台词");
  });

  it("stops mid-run without playing the remaining cues", async () => {
    const hooks = makeHooks({ a: [clip("a1", 5, "长句")], b: [clip("b1", 0.2, "不该出现")] });
    const runner = new PerformanceRunner(hooks);
    const run = runner.play(
      perf([
        { id: "c1", actorId: "a", waitAfter: 0 },
        { id: "c2", actorId: "b", waitAfter: 0 },
      ]),
    );
    // stop while cue 1 is still playing (playVoice takes ~20ms)
    await new Promise((r) => setTimeout(r, 5));
    runner.stop();
    await run;
    expect(hooks.log.some((l) => l === "play:b:b1")).toBe(false);
    expect(runner.currentState).toBe("idle");
  });

  it("pause keeps the position and resume finishes the script", async () => {
    const hooks = makeHooks({ a: [clip("a1", 0.2, "一")], b: [clip("b1", 0.2, "二")] });
    const runner = new PerformanceRunner(hooks);
    const run = runner.play(
      perf([
        { id: "c1", actorId: "a", waitAfter: 400 },
        { id: "c2", actorId: "b", waitAfter: 0 },
      ]),
    );
    await new Promise((r) => setTimeout(r, 40));
    runner.pause();
    expect(runner.currentState).toBe("paused");
    await new Promise((r) => setTimeout(r, 40));
    runner.resume();
    await run;
    expect(runner.currentState).toBe("finished");
    expect(hooks.log.filter((l) => l.startsWith("play:")).length).toBeGreaterThanOrEqual(1);
  });

  it("pause suspends audio instead of restarting the clip", async () => {
    const hooks = makeHooks({ a: [clip("a1", 5, "长句")] });
    // a real clip blocks until it ends; the shared helper resolves after 20ms,
    // so this case needs its own slow playback
    hooks.playVoice = async (actorId: string, played: VoiceClip) => {
      hooks.log.push(`play:${actorId}:${played.id}`);
      await new Promise((r) => setTimeout(r, 400));
    };
    const runner = new PerformanceRunner(hooks);
    const run = runner.play(perf([{ id: "c1", actorId: "a", waitAfter: 0 }]));
    await new Promise((r) => setTimeout(r, 60));
    expect(runner.currentState).toBe("playing");
    runner.pause();
    // suspended in place: the engine is told to pause, never to stop
    expect(runner.currentState).toBe("paused");
    expect(hooks.log).toContain("pause-audio");
    await new Promise((r) => setTimeout(r, 200));
    runner.resume();
    await run;
    expect(hooks.log).toContain("resume-audio");
    // the cue ran once: pausing must not restart it
    expect(hooks.log.filter((l) => l === "play:a:a1")).toHaveLength(1);
  });

  it("skips a cue that was deleted while the script is running", async () => {
    // slow clip so the deletion lands while cue 1 is still on stage
    const hooks = makeHooks({ a: [clip("a1", 2, "一")], b: [clip("b1", 0.2, "二")] });
    const live = perf([
      { id: "c1", actorId: "a", waitAfter: 0 },
      { id: "c2", actorId: "b", waitAfter: 0 },
    ]);
    const runner = new PerformanceRunner({ ...hooks, getPerformance: () => live });
    const run = runner.play(live);
    await new Promise((r) => setTimeout(r, 5));
    // the editor removes the second line while the first still plays
    live.cues = live.cues.filter((cue) => cue.id !== "c2");
    runner.stop();
    await run;
    expect(hooks.log.filter((l) => l.startsWith("play:"))).toEqual(["play:a:a1"]);
  });

  it("keeps running the surviving cues after a deletion", async () => {
    const hooks = makeHooks({
      a: [clip("a1", 2, "一")],
      b: [clip("b1", 0.2, "二")],
      c: [clip("c1", 0.2, "三")],
    });
    const live = perf([
      { id: "c1", actorId: "a", waitAfter: 0 },
      { id: "c2", actorId: "b", waitAfter: 0 },
      { id: "c3", actorId: "c", waitAfter: 0 },
    ]);
    const runner = new PerformanceRunner({ ...hooks, getPerformance: () => live });
    const run = runner.play(live);
    await new Promise((r) => setTimeout(r, 5));
    // remove the middle line only
    live.cues = live.cues.filter((cue) => cue.id !== "c2");
    await run;
    expect(hooks.log.filter((l) => l.startsWith("play:"))).toEqual(["play:a:a1", "play:c:c1"]);
    expect(runner.currentState).toBe("finished");
  });

  it("rejects an empty performance with a readable error", async () => {
    const hooks = makeHooks({});
    const onError = vi.fn();
    const runner = new PerformanceRunner({ ...hooks, onError });
    await runner.play(perf([]));
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("还没有台词"));
  });

  it("falls back to bubble-only cues when the actor has no audio", async () => {
    const hooks = makeHooks({ a: [] });
    const onError = vi.fn();
    const runner = new PerformanceRunner({ ...hooks, onError });
    await runner.play(perf([{ id: "c1", actorId: "a", text: "静音台词", waitAfter: 0 }]));
    expect(hooks.log).toContain("bubble:a:静音台词");
    expect(hooks.log.some((l) => l.startsWith("play:"))).toBe(false);
  });

  it("loops when loop is enabled and stop breaks out", async () => {
    const hooks = makeHooks({ a: [clip("a1", 0.1, "循环")] });
    const runner = new PerformanceRunner(hooks);
    const looped = { ...perf([{ id: "c1", actorId: "a", waitAfter: 0 }]), loop: true };
    const run = runner.play(looped);
    await new Promise((r) => setTimeout(r, 120));
    runner.stop();
    await run;
    expect(hooks.log.filter((l) => l === "play:a:a1").length).toBeGreaterThan(1);
    expect(runner.currentState).toBe("idle");
  });
});
