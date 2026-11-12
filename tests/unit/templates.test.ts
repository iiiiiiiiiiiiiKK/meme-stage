import { describe, expect, it } from "vitest";
import {
  BUILTIN_TEMPLATES,
  applyTemplate,
  captureTemplate,
  type Template,
} from "../../src/lib/templates";
import { createCharacter, createProject } from "../../src/lib/defaults";

function project() {
  const p = createProject();
  const a = createCharacter({ name: "甲", imageUrl: "/api/files/a.webp", width: 300, height: 400 });
  const b = createCharacter({ name: "乙", imageUrl: "/api/files/b.webp", width: 200, height: 400 });
  a.character!.voices = [{ id: "va", name: "va", url: "/api/files/va.wav", duration: 1, volume: 1 }];
  b.character!.voices = [{ id: "vb", name: "vb", url: "/api/files/vb.wav", duration: 1, volume: 1 }];
  p.elements = [a, b];
  return p;
}

describe("templates", () => {
  it("ships five built-in stages", () => {
    expect(BUILTIN_TEMPLATES).toHaveLength(5);
    const names = BUILTIN_TEMPLATES.map((t) => t.name);
    expect(names.join("|")).toContain("全员开麦");
    for (const tpl of BUILTIN_TEMPLATES) {
      expect(tpl.settings.width).toBeGreaterThan(300);
      expect(tpl.settings.characterHeight).toBeGreaterThan(100);
    }
  });

  it("captures canvas structure without elements or voices", () => {
    const src = project();
    src.width = 900;
    src.height = 1600;
    const tpl = captureTemplate(src, "竖屏模板");
    expect(tpl.name).toBe("竖屏模板");
    expect(tpl.settings.width).toBe(900);
    expect(tpl.settings.characterHeight).toBe(400);
    // nothing content-bearing leaked into the template
    expect(JSON.stringify(tpl)).not.toContain("/api/files/a.webp");
    expect(JSON.stringify(tpl)).not.toContain("va.wav");
  });

  it("applies a template without dropping characters or voices", () => {
    const src = project();
    const portrait = BUILTIN_TEMPLATES.find((t) => t.id === "builtin-chat") as Template;
    const next = applyTemplate(src, portrait);
    expect(next.width).toBe(900);
    expect(next.height).toBe(1600);
    expect(next.elements).toHaveLength(2);
    expect(next.elements[0].character?.voices).toHaveLength(1);
    // aspect ratio is preserved while the height is unified
    for (const el of next.elements) {
      expect(el.height).toBe(portrait.settings.characterHeight);
    }
    expect(next.elements[0].width).toBe(Math.round(420 * (300 / 400)));
  });

  it("can change the stage without resizing the cast", () => {
    const src = project();
    const poster = BUILTIN_TEMPLATES.find((t) => t.id === "builtin-poster") as Template;
    const next = applyTemplate(src, poster, false);
    expect(next.elements[0].height).toBe(400);
    expect(next.settings.audioMode).toBe("mix");
  });

  it("keeps bubbles and placement in sync with the template", () => {
    const src = project();
    const duet = BUILTIN_TEMPLATES.find((t) => t.id === "builtin-duet") as Template;
    const next = applyTemplate(src, duet);
    expect(next.elements[0].character?.bubble.preset).toBe(duet.settings.bubble.preset);
    expect(next.elements[0].character?.bubblePlacement.maxWidth).toBe(
      duet.settings.bubblePlacement.maxWidth,
    );
  });
});
