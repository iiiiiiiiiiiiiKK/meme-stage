import { describe, expect, it } from "vitest";
import {
  CUT_MODES,
  DEFAULT_OUTLINE,
  FACE_MODES,
  MODE_LABEL,
  modeUsesFace,
  type BatchItem,
  type OutlineSettings,
} from "../../src/features/sticker/types";

describe("sticker domain types", () => {
  it("offers every cut mode with a label and a hint", () => {
    expect(CUT_MODES).toHaveLength(7);
    for (const mode of CUT_MODES) {
      expect(mode.label.length).toBeGreaterThan(0);
      expect(mode.hint.length).toBeGreaterThan(0);
      // the menu label is short, the stored label is descriptive
      expect(MODE_LABEL[mode.id].length).toBeGreaterThan(1);
    }
  });

  it("marks only the face-dependent modes as needing detection", () => {
    expect(FACE_MODES).toEqual(["face", "head", "head-neck", "head-shoulders", "upper-body"]);
    expect(modeUsesFace("head")).toBe(true);
    expect(modeUsesFace("background")).toBe(false);
    expect(modeUsesFace("full")).toBe(false);
  });

  it("ships a two-layer default outline (white inside, black outside)", () => {
    const outline: OutlineSettings = DEFAULT_OUTLINE;
    expect(outline.enabled).toBe(true);
    expect(outline.layers).toBe(2);
    expect(outline.color).toBe("#ffffff");
    expect(outline.secondColor).toBe("#111111");
    expect(outline.thickness).toBeGreaterThan(outline.secondThickness / 2);
    // glow and shadow are opt-in, never on by default
    expect(outline.shadow).toBe(false);
    expect(outline.glow).toBe(false);
  });

  it("keeps the queue item shape honest about progress and errors", () => {
    const item: BatchItem = {
      id: "itm_1",
      sourceId: "src_1",
      name: "a.png",
      stage: "queued",
      progress: 0,
      attempt: 0,
      variantIds: [],
    };
    expect(item.progress).toBe(0);
    expect(item.error).toBeUndefined();
  });
});
