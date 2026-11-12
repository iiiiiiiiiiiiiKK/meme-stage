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
  /**
   * Live script lookup. The editor can add / delete / reorder cues while a
   * performance runs, so each step resolves its cue by id against the current
   * document instead of a stale array index.
   */
  getPerformance?(): Performance | null;
  /** resolves the clip for a cue (explicit id or rotation) */
  resolveClip(actorId: string, clipId?: string): VoiceClip | null;
  playVoice(actorId: string, clip: VoiceClip): Promise<void>;
  stopAudio(): void;
  /** suspend the current clip in place (keeps its position) */
  pauseAudio(): void;
  /** continue a suspended clip from where it stopped */
  resumeAudio(): void;
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
  private currentLipFlap: string | null = null;
  private lipFlapActor: string | null = null;

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
    this.currentLipFlap = null;
    this.lipFlapActor = null;
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
    // suspend instead of stop: the clip keeps its position, so resume() continues
    // the same sentence rather than replaying it from the start
    this.hooks.pauseAudio();
    this.lipFlapActor = this.currentLipFlap;
    this.hooks.lipFlap(null);
  }

  resume(): void {
    if (this.state !== "paused") return;
    this.paused = false;
    this.setState("playing");
    this.hooks.resumeAudio();
    if (this.lipFlapActor) this.hooks.lipFlap(this.lipFlapActor);
    this.lipFlapActor = null;
    this.releaseWaiters();
  }

  private releaseWaiters() {
    const waiters = this.resumeWaiters;
    this.resumeWaiters = [];
    for (const resolve of waiters) resolve();
  }

  /** blocks while paused; also aborts when the run token changes */
  private async waitWhilePaused(myRun: number): Promise<boolean> {
    while (this.paused) {
      if (myRun !== this.token) return false;
      await new Promise<void>((resolve) => {
        this.resumeWaiters.push(resolve);
        setTimeout(resolve, 250);
      });
    }
    return myRun === this.token;
  }

  /**
   * Sleep that freezes while paused and aborts on stop. Plain setTimeout would
   * keep counting down during a pause and cut the cue short on resume.
   */
  private async sleep(ms: number, myRun: number): Promise<boolean> {
    let remaining = ms;
    while (remaining > 0) {
      if (myRun !== this.token) return false;
      if (this.paused) {
        if (!(await this.waitWhilePaused(myRun))) return false;
        continue;
      }
      const slice = Math.min(remaining, 60);
      await new Promise<void>((resolve) => setTimeout(resolve, slice));
      if (!this.paused && myRun === this.token) remaining -= slice;
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
    // Anchor progress on cue ids, not array indexes: adding, deleting or
    // reordering lines while it plays then never skips or repeats a cue.
    const queue = performance.cues.slice(fromIndex).map((cue) => cue.id);
    this.index = fromIndex;
    this.paused = false;
    this.setState("playing");

    const live = () => this.hooks.getPerformance?.() ?? performance;
    let round = 0;
    do {
      const ids = round === 0 ? queue : live().cues.map((cue) => cue.id);
      for (const cueId of ids) {
        if (myRun !== this.token) return;
        if (!(await this.waitWhilePaused(myRun))) return;
        const cues = live().cues;
        const position = cues.findIndex((cue) => cue.id === cueId);
        if (position < 0) continue; // the line was deleted mid-performance
        this.index = position;
        this.hooks.onCue?.(position, cues[position]);
        await this.runCue(cues[position], myRun);
        if (myRun !== this.token) return;
      }
      round += 1;
    } while ((this.hooks.getPerformance?.() ?? performance).loop && myRun === this.token);

    if (myRun === this.token) {
      this.hooks.spotlight(null);
      this.hooks.clearEffects();
      this.setState("finished");
    }
  }

  private async runCue(cue: PerformanceCue, myRun: number): Promise<void> {
    if (cue.waitBefore && cue.waitBefore > 0) {
      if (!(await this.sleep(cue.waitBefore, myRun))) return;
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

    const cleanup = () => {
      effects.forEach((item) => item.cancel());
      this.currentLipFlap = null;
      this.lipFlapActor = null;
      this.hooks.lipFlap(null);
    };

    if (cue.lipFlap) {
      this.currentLipFlap = cue.actorId;
      this.hooks.lipFlap(cue.actorId);
    }

    if (clip) {
      const audioMs = Math.max(0, ((clip.duration || 0) / (clip.rate ?? 1)) * 1000);
      if (text && cue.showBubble !== false) {
        this.hooks.showBubble(cue.actorId, text, Math.max(1, audioMs / 1000 + 0.4));
      }
      const pending = this.hooks.playVoice(cue.actorId, clip);
      const holdMs = cue.holdMs && cue.holdMs > 0 ? cue.holdMs : Math.max(audioMs, 400);
      // both branches are pause-aware: while paused the clip is suspended in
      // place and the hold timer stops counting, so resume continues the line
      const winner = await Promise.race([
        pending.then(() => "audio" as const),
        this.sleep(holdMs, myRun).then((ok) => (ok ? ("hold" as const) : ("abort" as const))),
      ]);
      if (winner === "abort" || myRun !== this.token) {
        cleanup();
        return;
      }
    } else if (text) {
      const holdMs = cue.holdMs && cue.holdMs > 0 ? cue.holdMs : 1800;
      if (cue.showBubble !== false) this.hooks.showBubble(cue.actorId, text, Math.max(1, holdMs / 1000));
      if (!(await this.sleep(holdMs, myRun))) {
        cleanup();
        return;
      }
    } else {
      this.hooks.onError?.(`「${actor.character?.name ?? "该人物"}」还没有语音或台词`);
      if (!(await this.sleep(120, myRun))) {
        cleanup();
        return;
      }
    }

    cleanup();
    if (cue.waitAfter && cue.waitAfter > 0) await this.sleep(cue.waitAfter, myRun);
  }
}
