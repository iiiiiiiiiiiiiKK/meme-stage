import { describe, expect, it } from "vitest";
import { buildRecipes, RECIPE_LABELS, type RecipeId } from "../../src/lib/recipes";
import { createCharacter } from "../../src/lib/defaults";
import type { CanvasElement } from "../../src/lib/types";

function cast(count: number): CanvasElement[] {
  return Array.from({ length: count }, (_, i) => {
    const el = createCharacter({
      name: `角色${i + 1}`,
      imageUrl: `/api/files/c${i}.webp`,
      width: 300,
      height: 400,
    });
    el.character!.voices = [
      { id: `v${i}`, name: `v${i}`, url: `/api/files/v${i}.wav`, duration: 1, volume: 1 },
    ];
    return el;
  });
}

describe("interaction recipes", () => {
  it("exposes a label for every recipe", () => {
    const ids = Object.keys(RECIPE_LABELS) as RecipeId[];
    expect(ids).toHaveLength(5);
    for (const id of ids) expect(RECIPE_LABELS[id].length).toBeGreaterThan(1);
  });

  it("everyoneSpeaks creates one clickable event per actor", () => {
    const els = cast(3);
    const events = buildRecipes("everyoneSpeaks", els);
    expect(events).toHaveLength(3);
    expect(new Set(events.map((e) => e.triggerId)).size).toBe(3);
    for (const ev of events) {
      expect(ev.steps[0].type).toBe("playAudio");
      expect(ev.enabled).toBe(true);
    }
  });

  it("inOrder chains events with valid next ids", () => {
    const els = cast(4);
    const events = buildRecipes("inOrder", els);
    // returns the head of the chain only
    expect(events).toHaveLength(1);
    expect(events[0].nextEventId).toBeTruthy();
  });

  it("threeRound needs two actors and links A → B → A2", () => {
    expect(buildRecipes("threeRound", cast(1))).toEqual([]);
    const events = buildRecipes("threeRound", cast(2));
    expect(events).toHaveLength(1);
    expect(events[0].nextEventId).toBeTruthy();
    const anims = events[0].steps.filter((s) => s.type === "animate").map((s) => s.animation);
    expect(anims).toContain("nod");
  });

  it("allAtOnce marks every step parallel", () => {
    const events = buildRecipes("allAtOnce", cast(3));
    expect(events).toHaveLength(3);
    for (const ev of events) {
      expect(ev.steps).toHaveLength(3);
      expect(ev.steps.every((s) => s.parallel)).toBe(true);
    }
  });

  it("randomCall adds a second actor reaction", () => {
    const events = buildRecipes("randomCall", cast(3));
    expect(events).toHaveLength(3);
    for (const ev of events) {
      expect(ev.steps.filter((s) => s.type === "playAudio")).toHaveLength(2);
      expect(ev.steps.some((s) => s.type === "animate")).toBe(true);
    }
  });

  it("ignores characters without voices and empty projects", () => {
    const silent = createCharacter({ name: "哑巴", imageUrl: "/api/files/x.webp", width: 100, height: 100 });
    expect(buildRecipes("everyoneSpeaks", [silent])).toEqual([]);
    expect(buildRecipes("everyoneSpeaks", [])).toEqual([]);
  });
});
