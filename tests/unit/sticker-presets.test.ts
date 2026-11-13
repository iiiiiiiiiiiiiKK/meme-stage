import { describe, expect, it } from "vitest";
import { PERSON_COLORS, PERSON_COLOR_LABEL, OUTLINE_PRESETS, DEFAULT_OUTLINE } from "../../src/features/sticker/types";

describe("person colour presets", () => {
  it("offers the six documented treatments with labels and hints", () => {
    expect(PERSON_COLORS).toHaveLength(6);
    for (const item of PERSON_COLORS) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.hint.length).toBeGreaterThan(0);
      expect(PERSON_COLOR_LABEL[item.id]).toBeTruthy();
    }
  });

  it("keeps the original as the default option, first in the list", () => {
    // The task book is explicit: never recolour the person by default.
    expect(PERSON_COLORS[0].id).toBe("original");
    expect(PERSON_COLORS[0].label).toBe("原图彩色");
  });

  it("has a label for every id and no leftovers", () => {
    for (const item of PERSON_COLORS) {
      expect(PERSON_COLOR_LABEL[item.id]).toBe(item.label);
    }
    expect(Object.keys(PERSON_COLOR_LABEL)).toHaveLength(PERSON_COLORS.length);
  });
});

describe("outline presets", () => {
  it("covers none / thin / medium / thick / ultra / classic", () => {
    expect(OUTLINE_PRESETS.map((p) => p.id)).toEqual(["none", "thin", "medium", "thick", "ultra", "classic"]);
  });

  it("turning the preset off really disables the stroke", () => {
    const none = OUTLINE_PRESETS.find((p) => p.id === "none")!;
    expect(none.patch.enabled).toBe(false);
  });

  it("the single-layer presets zero out the second stroke", () => {
    for (const id of ["thin", "medium", "thick", "ultra"]) {
      const preset = OUTLINE_PRESETS.find((p) => p.id === id)!;
      expect(preset.patch.layers).toBe(1);
      expect(preset.patch.secondThickness).toBe(0);
    }
  });

  it("the classic preset matches the shipped default: white thick inside, black thin outside", () => {
    const classic = OUTLINE_PRESETS.find((p) => p.id === "classic")!;
    expect(classic.patch.color).toBe(DEFAULT_OUTLINE.color);
    expect(classic.patch.secondColor).toBe(DEFAULT_OUTLINE.secondColor);
    expect(classic.patch.layers).toBe(2);
    expect(classic.patch.thickness).toBe(DEFAULT_OUTLINE.thickness);
    expect(classic.patch.secondThickness).toBe(DEFAULT_OUTLINE.secondThickness);
    // the outer line must be visibly thinner than the inner one
    expect(classic.patch.secondThickness!).toBeLessThan(classic.patch.thickness!);
  });

  it("every preset only touches safe, overlay-level fields", () => {
    const allowed = new Set([
      "enabled",
      "thickness",
      "color",
      "layers",
      "secondColor",
      "secondThickness",
    ]);
    for (const preset of OUTLINE_PRESETS) {
      for (const key of Object.keys(preset.patch)) {
        expect(allowed.has(key)).toBe(true);
      }
    }
  });
});
