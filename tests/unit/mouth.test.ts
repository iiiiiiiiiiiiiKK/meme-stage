import { describe, expect, it } from "vitest";
import { defaultMouth, mouthOf } from "../../src/lib/defaults";
import { mouthScreenShape, mouthWorldPoint } from "../../src/lib/mouth";
import { normalizeProject } from "../../src/lib/schema";
import { createCharacter, createProject } from "../../src/lib/defaults";
import type { CanvasElement } from "../../src/lib/types";
import type { Viewport } from "../../src/lib/geometry";

const base = (over: Partial<CanvasElement> = {}): CanvasElement => ({
  ...createCharacter({ name: "甲", imageUrl: "/api/files/a.webp", width: 320, height: 400 }),
  ...over,
});

const viewport: Viewport = { x: 100, y: 50, scale: 2 };

describe("mouth anchor", () => {
  it("derives a lower mouth for tall pictures and a higher one for wide ones", () => {
    const tall = defaultMouth(300, 900);
    const wide = defaultMouth(1600, 700);
    expect(tall.y).toBeGreaterThan(wide.y);
    // both stay inside the picture
    expect(tall.y).toBeLessThan(0.6);
    expect(wide.y).toBeGreaterThan(0.2);
  });

  it("falls back to the aspect default when a character has no anchor", () => {
    const el = base({ width: 300, height: 900 });
    expect(mouthOf(el.character, el.width, el.height).y).toBe(defaultMouth(300, 900).y);
  });

  it("clamps a hand-placed anchor into the picture", () => {
    const el = base();
    el.character!.mouth = { x: 1.6, y: -3, size: 5, custom: true };
    const mouth = mouthOf(el.character, el.width, el.height);
    expect(mouth.x).toBeLessThanOrEqual(0.98);
    expect(mouth.y).toBeGreaterThanOrEqual(0.02);
    expect(mouth.size).toBeLessThanOrEqual(0.6);
  });

  it("places the mouth where the author clicked", () => {
    const el = base({ x: 100, y: 200, width: 400, height: 400, rotation: 0 });
    el.character!.mouth = { x: 0.5, y: 0.25, size: 0.2, custom: true };
    const point = mouthWorldPoint(el);
    // centre x = 300, and 25% down a 400px box = 100px from the top → y = 300
    expect(Math.round(point.x)).toBe(300);
    expect(Math.round(point.y)).toBe(300);
    expect(Math.round(point.width)).toBe(80);
  });

  it("mirrors the anchor when the picture is flipped", () => {
    const el = base({ x: 0, y: 0, width: 400, height: 400 });
    el.character!.mouth = { x: 0.2, y: 0.5, size: 0.1, custom: true };
    const normal = mouthWorldPoint(el).x;
    el.flipX = true;
    const flipped = mouthWorldPoint(el).x;
    expect(Math.round(normal)).toBe(80);
    expect(Math.round(flipped)).toBe(320);
  });

  it("rotates the anchor with the picture", () => {
    const el = base({ x: 0, y: 0, width: 400, height: 400, rotation: 90 });
    el.character!.mouth = { x: 0.5, y: 0.1, size: 0.2, custom: true };
    const point = mouthWorldPoint(el);
    // 90° clockwise: a point above the centre moves to the right of it
    expect(Math.round(point.x)).toBe(360);
    expect(Math.round(point.y)).toBe(200);
    expect(point.rotation).toBe(90);
  });

  it("converts world to screen with the viewport scale", () => {
    const el = base({ x: 100, y: 100, width: 400, height: 400 });
    el.character!.mouth = { x: 0.5, y: 0.5, size: 0.2, custom: true };
    const shape = mouthScreenShape(el, viewport);
    // world centre (300, 300) → screen (300*2+100, 300*2+50)
    expect(Math.round(shape.cx)).toBe(700);
    expect(Math.round(shape.cy)).toBe(650);
    expect(Math.round(shape.width)).toBe(160);
  });

  it("survives a schema round-trip and rejects junk", () => {
    const project = createProject();
    const el = base();
    el.character!.mouth = { x: 0.42, y: 0.31, size: 0.18, custom: true };
    project.elements = [el];
    const normalized = normalizeProject(project);
    expect(normalized.elements[0].character?.mouth).toEqual({
      x: 0.42,
      y: 0.31,
      size: 0.18,
      custom: true,
    });

    const broken = createProject();
    const junk = base();
    (junk.character as unknown as Record<string, unknown>).mouth = { x: "no", y: null };
    broken.elements = [junk];
    expect(normalizeProject(broken).elements[0].character?.mouth).toBeUndefined();
  });
});
