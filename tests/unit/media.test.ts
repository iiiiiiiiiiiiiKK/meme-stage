import { describe, expect, it } from "vitest";
import { normalizeProject } from "../../src/lib/schema";
import { createMedia, createProject } from "../../src/lib/defaults";

describe("animated media elements", () => {
  it("creates a gif element with the animated flag", () => {
    const el = createMedia({
      url: "/api/files/fx.gif",
      name: "爆炸.gif",
      animated: "gif",
      width: 200,
      height: 200,
      x: 40,
      y: 60,
    });
    expect(el.type).toBe("image");
    expect(el.image?.animated).toBe("gif");
    expect(el.image?.url).toBe("/api/files/fx.gif");
    expect(el.x).toBe(40);
  });

  it("keeps the animated flag through normalisation", () => {
    const project = createProject();
    project.elements = [
      createMedia({
        url: "/api/files/a.webp",
        name: "动图",
        animated: "webp",
        width: 120,
        height: 120,
      }),
      createMedia({
        url: "/api/files/b.mp4",
        name: "视频",
        animated: "mp4",
        width: 320,
        height: 180,
      }),
    ];
    const normalized = normalizeProject(project);
    expect(normalized.elements[0].image?.animated).toBe("webp");
    expect(normalized.elements[1].image?.animated).toBe("mp4");
  });

  it("drops unknown animated values instead of trusting them", () => {
    const project = createProject();
    project.elements = [
      {
        id: "el_1",
        type: "image",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
        z: 1,
        opacity: 1,
        locked: false,
        hidden: false,
        flipX: false,
        flipY: false,
        image: { url: "/api/files/x.png", name: "x", animated: "svg" as never },
      },
    ];
    expect(normalizeProject(project).elements[0].image?.animated).toBeUndefined();
  });

  it("still rejects non same-origin media urls", () => {
    const project = createProject();
    project.elements = [
      {
        id: "el_bad",
        type: "image",
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        rotation: 0,
        z: 1,
        opacity: 1,
        locked: false,
        hidden: false,
        flipX: false,
        flipY: false,
        image: { url: "http://evil.test/a.gif", name: "坏图", animated: "gif" },
      },
    ];
    expect(() => normalizeProject(project)).toThrow(/有效地址/);
  });
});
