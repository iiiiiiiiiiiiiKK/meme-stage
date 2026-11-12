/**
 * Scripted performance runner: plays a list of cues in order, like a small skit.
 *
 * Design notes:
 * - a cue blocks until its audio finishes (or its hold time), then `waitAfter`
 * - `stop()` is authoritative: every await re-checks the run token
 * - pause/resume keep the position, so a long skit can be interrupted
 */
import type { AnimationName, CueEffect, Performance, PerformanceCue, VoiceClip } from "./types";

export type PerformanceState = "idle" | "playing" | "paused" | "finished";

export interface PerformanceHooks {
  getProject(): { elements: { id: string; character?: { voices: VoiceClip[]; name: string } }[] };
  /** resolves the clip for a cue (explicit id or rotation) */
  resolveClip(actorId: string, clipId?: string): VoiceClip | null;
  playVoice(actorId: string, clip: VoiceClip): Promise<void>;
  stopAudio(): void;
  showBubble(actorId: string, text: string, holdSeconds: number): void;
  hideBubble(actorId: string): void;
  animate(actorId: string, animation: AnimationName): void;
  moveBy(actorId: string, dx: number, dy: number): void;
  spotlight(actorId: string | null): void;
  /** start a sticker effect; returns a handle able to cancel it early */
  playEffect(actorId: string, effect: CueEffect): () => void;
  clearEffects(): void;
  lipFlap(actorId: string | null): void;
  wait(ms: number): Promise<void>;
  onCue?(index: number, cue: PerformanceCue): void;
  onState?(state: PerformanceState): void;
  onError?(message: string): void;
}

export class PerformanceRunner {
  private hooks: PerformanceHooks;
  private token = 0;
  private paused = false;
  private resumeWaiters: (() => void)[] = [];
  private state: PerformanceState = "idle";
  private index = 0;

  constructor(hooks: PerformanceHooks) {
    this.hooks = hooks;
  }

  get currentState(): PerformanceState {
    return this.state;
  }

  get currentIndex(): number {
    return this.index;
  }

  private setState(state: PerformanceState) {
    this.state = state;
    this.hooks.onState?.(state);
  }

  stop(): void {
    this.token += 1;
    this.paused = false;
    this.index = 0;
    this.releaseWaiters();
    this.hooks.stopAudio();
    this.hooks.clearEffects();
    this.hooks.lipFlap(null);
    this.hooks.spotlight(null);
    if (this.state !== "idle") this.setState("idle");
  }

  pause(): void {
    if (this.state !== "playing") return;
    this.paused = true;
    this.setState("paused");
    // stopping audio keeps the cue from advancing while paused
    this.hooks.stopAudio();
    this.hooks.lipFlap(null);
  }

  resume(): void {
    if (this.state !== "paused") return;
    this.paused = false;
    this.setState("playing");
    this.releaseWaiters();
  }

  private releaseWaiters() {
    const waiters = this.resumeWaiters;
    this.resumeWaiters = [];
    for (const resolve of waiters) resolve();
  }

  /** blocks while paused; also aborts when the run token changes */
  private async gate(myRun: number): Promise<boolean> {
    while (this.paused) {
      if (myRun !== this.token) return false;
      await new Promise<void>((resolve) => {
        this.resumeWaiters.push(resolve);
        setTimeout(resolve, 250);
      });
    }
    return myRun === this.token;
  }

  async play(performance: Performance, fromIndex = 0): Promise<void> {
    this.stop();
    if (!performance.cues.length) {
      this.hooks.onError?.("这个表演还没有台词，先添加几行");
      return;
    }
    const myRun = ++this.token;
    this.index = fromIndex;
    this.paused = false;
    this.setState("playing");

    do {
      for (let i = fromIndex; i < performance.cues.length; i++) {
        if (myRun !== this.token) return;
        if (!(await this.gate(myRun))) return;
        this.index = i;
        const cue = performance.cues[i];
        this.hooks.onCue?.(i, cue);
        await this.runCue(cue, myRun);
        if (myRun !== this.token) return;
      }
      fromIndex = 0;
    } while (performance.loop && myRun === this.token);

    if (myRun === this.token) {
      this.hooks.spotlight(null);
      this.hooks.clearEffects();
      this.setState("finished");
    }
  }

  private async runCue(cue: PerformanceCue, myRun: number): Promise<void> {
    if (cue.waitBefore && cue.waitBefore > 0) {
      await this.hooks.wait(cue.waitBefore);
      if (myRun !== this.token) return;
    }

    const project = this.hooks.getProject();
    const actor = project.elements.find((el) => el.id === cue.actorId);
    if (!actor) return;

    if (cue.spotlight) this.hooks.spotlight(cue.actorId);
    if (cue.animation) this.hooks.animate(cue.actorId, cue.animation);
    if (cue.moveX || cue.moveY) this.hooks.moveBy(cue.actorId, cue.moveX ?? 0, cue.moveY ?? 0);

    const effects = (cue.effects ?? []).map((fx) => ({ fx, cancel: this.hooks.playEffect(cue.actorId, fx) }));
    const clip = this.hooks.resolveClip(cue.actorId, cue.clipId);
    const text = (cue.text ?? clip?.line ?? "").trim();

    if (cue.lipFlap) this.hooks.lipFlap(cue.actorId);

    let audioMs = 0;
    if (clip) {
      audioMs = Math.max(0, ((clip.duration || 0) / (clip.rate ?? 1)) * 1000);
      if (text && cue.showBubble !== false) {
        this.hooks.showBubble(cue.actorId, text, Math.max(1, audioMs / 1000 + 0.4));
      }
      const pending = this.hooks.playVoice(cue.actorId, clip);
      // paused mid-cue: playback was stopped by pause(); bail out cleanly
      const finished = await Promise.race([
        pending.then(() => true),
        this.hooks.wait(cue.holdMs && cue.holdMs > 0 ? cue.holdMs : Math.max(audioMs, 400)).then(() => true),
        this.watchToken(myRun).then(() => false),
      ]);
      if (!finished || myRun !== this.token) {
        effects.forEach((item) => item.cancel());
        this.hooks.lipFlap(null);
        return;
      }
    } else if (text) {
      const holdMs = cue.holdMs && cue.holdMs > 0 ? cue.holdMs : 1800;
      if (cue.showBubble !== false) this.hooks.showBubble(cue.actorId, text, Math.max(1, holdMs / 1000));
      if (cue.animation) this.hooks.animate(cue.actorId, cue.animation);
      await this.hooks.wait(holdMs);
    } else {
      this.hooks.onError?.(`「${actor.character?.name ?? "该人物"}」还没有语音或台词`);
      await this.hooks.wait(120);
    }

    this.hooks.lipFlap(null);
    if (cue.waitAfter && cue.waitAfter > 0) await this.hooks.wait(cue.waitAfter);
    effects.forEach((item) => item.cancel());
  }

  private watchToken(myRun: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const tick = () => {
        if (myRun !== this.token || this.paused) resolve();
        else setTimeout(tick, 40);
      };
      setTimeout(tick, 40);
    });
  }
}
