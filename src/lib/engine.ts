import type {
  AnimationName,
  CanvasElement,
  EventDef,
  ProjectData,
  Step,
} from "./types";

export interface RuntimeHooks {
  getProject(): ProjectData;
  getElement(id: string): CanvasElement | undefined;
  playVoice(el: CanvasElement, clipId?: string): Promise<void>;
  showBubble(el: CanvasElement, text: string, holdSeconds: number): void;
  hideBubble(elId: string): void;
  animate(el: CanvasElement, animation: AnimationName): void;
  setHidden(el: CanvasElement, hidden: boolean): void;
  moveBy(el: CanvasElement, dx: number, dy: number): void;
  flash(): void;
  wait(ms: number): Promise<void>;
  onError?(message: string, el?: CanvasElement): void;
}

export function pickEvent(project: ProjectData, elementId: string): EventDef | null {
  return (
    project.events.find((ev) => ev.enabled && ev.triggerId === elementId && ev.steps.length > 0) ??
    project.events.find((ev) => ev.enabled && ev.triggerId === elementId) ??
    null
  );
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Sequential interaction runner. A new trigger cancels the previous run so
 * rapid tapping cannot interleave two scripts.
 */
export class InteractionRunner {
  private runId = 0;
  private hooks: RuntimeHooks;
  private maxDepth = 12;

  constructor(hooks: RuntimeHooks) {
    this.hooks = hooks;
  }

  stop(): void {
    this.runId += 1;
  }

  async trigger(elementId: string): Promise<void> {
    const project = this.hooks.getProject();
    const el = this.hooks.getElement(elementId);
    if (!el || el.hidden) return;
    const event = pickEvent(project, elementId);
    if (event && event.steps.length > 0) {
      await this.runEvent(event.id, 0, new Set());
      return;
    }
    await this.defaultReaction(el);
  }

  /** fallback behaviour when a character has no scripted event */
  async defaultReaction(el: CanvasElement): Promise<void> {
    if (el.type !== "character") {
      if (el.type === "text" && el.text) {
        this.hooks.showBubble(el, el.text.content, el.text.duration || 2.4);
      }
      return;
    }
    const project = this.hooks.getProject();
    const voice = el.character?.voice;
    const line = el.character?.line?.trim();
    const hold = Math.max(el.character?.bubble.hold ?? 2.4, voice?.duration ?? 0);
    const myRun = ++this.runId;

    if (project.settings.reactions) this.hooks.animate(el, "bounce");
    if (line || voice) {
      this.hooks.showBubble(el, line || "……", hold);
    }
    if (voice) {
      await this.hooks.playVoice(el);
      if (myRun !== this.runId) return;
      if (line) this.hooks.showBubble(el, line, hold);
    }
  }

  async runEvent(
    eventId: string,
    depth = 0,
    visited = new Set<string>(),
    ownerRun?: number,
  ): Promise<void> {
    if (depth > this.maxDepth) {
      this.hooks.onError?.("互动链太长，已停止执行（可能存在循环跳转）");
      return;
    }
    if (visited.has(eventId)) {
      this.hooks.onError?.("检测到循环互动，已停止执行");
      return;
    }
    const project = this.hooks.getProject();
    const event = project.events.find((e) => e.id === eventId);
    if (!event || !event.enabled) return;

    // nested runs (goto / next) share the token of the trigger that started them
    const myRun = ownerRun ?? ++this.runId;
    const alive = () => myRun === this.runId;
    const nextVisited = new Set(visited).add(eventId);
    const pending: Promise<void>[] = [];

    for (const step of event.steps) {
      if (!alive()) return;
      const task = this.runStep(step, depth, nextVisited, alive, myRun);
      if (step.parallel) pending.push(task);
      else await task;
      if (!alive()) {
        await Promise.allSettled(pending);
        return;
      }
    }
    if (pending.length > 0) await Promise.allSettled(pending);
    if (!alive()) return;

    if (event.nextEventId) {
      const next = project.events.find((e) => e.id === event.nextEventId && e.enabled);
      if (next) await this.runEvent(next.id, depth + 1, nextVisited, myRun);
    }
  }

  private async runStep(
    step: Step,
    depth: number,
    visited: Set<string>,
    alive: () => boolean,
    ownerRun: number,
  ): Promise<void> {
    const el = step.targetId ? this.hooks.getElement(step.targetId) : undefined;
    switch (step.type) {
      case "playAudio": {
        if (!el) {
          this.hooks.onError?.("这个动作没有指定人物");
          return;
        }
        if (el.type === "character" && el.character?.voice) {
          await this.hooks.playVoice(el, step.clipId);
        } else {
          this.hooks.onError?.(`「${el.character?.name ?? "该人物"}」还没有绑定语音`, el);
        }
        return;
      }
      case "say": {
        if (!el) return;
        const text = step.text?.trim() || el.character?.line || el.text?.content || "";
        if (!text) return;
        const hold = Math.max(1.2, Math.min(12, step.ms ? step.ms / 1000 : el.character?.bubble.hold ?? 2.6));
        this.hooks.showBubble(el, text, hold);
        const waitMs = step.ms && step.ms > 0 ? step.ms : hold * 1000;
        await this.hooks.wait(Math.min(waitMs, 12_000));
        if (alive()) this.hooks.hideBubble(el.id);
        return;
      }
      case "animate": {
        if (!el) return;
        this.hooks.animate(el, step.animation ?? "bounce");
        await this.hooks.wait(420);
        return;
      }
      case "show": {
        if (!el) return;
        this.hooks.setHidden(el, false);
        this.hooks.animate(el, "pop");
        await this.hooks.wait(220);
        return;
      }
      case "hide": {
        if (!el) return;
        this.hooks.setHidden(el, true);
        await this.hooks.wait(160);
        return;
      }
      case "move": {
        if (!el) return;
        this.hooks.moveBy(el, step.dx ?? 0, step.dy ?? -40);
        await this.hooks.wait(360);
        return;
      }
      case "wait": {
        await this.hooks.wait(Math.min(step.ms ?? 500, 20_000));
        return;
      }
      case "flash": {
        this.hooks.flash();
        await this.hooks.wait(260);
        return;
      }
      case "goto": {
        if (step.eventId) await this.runEvent(step.eventId, depth + 1, visited, ownerRun);
        return;
      }
      default:
        return;
    }
  }
}

/** used by the published page to warm up the first few clips */
export function collectVoices(project: ProjectData): string[] {
  const urls = new Set<string>();
  for (const el of project.elements) {
    if (el.character?.voice?.url) urls.add(el.character.voice.url);
  }
  return Array.from(urls);
}

export function eventFor(project: ProjectData, id: string): EventDef | undefined {
  return project.events.find((e) => e.id === id);
}

export { sleep };
