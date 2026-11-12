import { describe, expect, it } from "vitest";
import { parseScript, stringifyScript } from "../../src/lib/script";
import { normalizeProject } from "../../src/lib/schema";
import { createCharacter, createProject } from "../../src/lib/defaults";
import type { CanvasElement, Performance } from "../../src/lib/types";

function actors(): CanvasElement[] {
  const make = (name: string) => {
    const el = createCharacter({
      name,
      imageUrl: `/api/files/${name}.webp`,
      width: 300,
      height: 400,
    });
    el.character!.voices = [
      { id: `${name}-01`, name: `${name}-01`, url: `/api/files/${name}-01.wav`, duration: 1.4, volume: 1 },
      { id: `${name}-02`, name: `${name}-02`, url: `/api/files/${name}-02.wav`, duration: 2.1, volume: 1 },
    ];
    return el;
  };
  return [make("甲"), make("乙"), make("丙")];
}

describe("script import", () => {
  it("parses a CSV with header, matching actors by name and clips by name", () => {
    const els = actors();
    const csv = `order,actor,line,audio,action,waitAfter,spotlight
1,甲,你们看这个方案怎么样？,甲-01,,260,
2,乙,我觉得不太行。,乙-01,shake,300,
3,丙,你们两个先别吵。,丙-02,pop,300,1`;
    const result = parseScript(csv, els);
    expect(result.errors).toEqual([]);
    expect(result.cues).toHaveLength(3);
    expect(result.cues[0].actorId).toBe(els[0].id);
    expect(result.cues[0].text).toBe("你们看这个方案怎么样？");
    expect(result.cues[0].clipId).toBe("甲-01");
    expect(result.cues[1].animation).toBe("shake");
    expect(result.cues[2].spotlight).toBe(true);
    expect(result.cues[2].clipId).toBe("丙-02");
  });

  it("accepts headerless rows and Chinese action labels", () => {
    const els = actors();
    const csv = `1,甲,第一句,,点头,100,
2,乙,第二句,,弹跳,100,`;
    const result = parseScript(csv, els);
    expect(result.cues).toHaveLength(2);
    expect(result.cues[0].animation).toBe("nod");
    expect(result.cues[1].animation).toBe("bounce");
  });

  it("parses JSON cues, including effects", () => {
    const els = actors();
    const json = JSON.stringify({
      name: "办公室小品",
      cues: [
        { actor: "甲", text: "这个方案不行", action: "shake", lipFlap: true },
        {
          actor: "乙",
          text: "我也觉得",
          effects: [{ url: "/api/files/sweat.gif", kind: "gif", size: 120, duration: 900 }],
        },
      ],
    });
    const result = parseScript(json, els);
    expect(result.name).toBe("办公室小品");
    expect(result.cues).toHaveLength(2);
    expect(result.cues[0].lipFlap).toBe(true);
    expect(result.cues[1].effects?.[0].url).toBe("/api/files/sweat.gif");
  });

  it("reports unknown actors without dropping the rest", () => {
    const els = actors();
    const csv = `order,actor,line
1,甲,在
2,不存在的人,不在
3,乙,也在`;
    const result = parseScript(csv, els);
    expect(result.cues).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("不存在的人");
  });

  it("rejects empty input and broken JSON", () => {
    expect(parseScript("   ", actors()).errors[0]).toBe("内容是空的");
    expect(parseScript("{oops", actors()).errors[0]).toBe("JSON 格式不正确");
  });

  it("round-trips through export", () => {
    const els = actors();
    const perf: Performance = {
      id: "pf",
      name: "回味",
      loop: false,
      cues: [
        { id: "c1", actorId: els[0].id, clipId: "甲-01", text: "第一句", animation: "nod", waitAfter: 200 },
        { id: "c2", actorId: els[1].id, text: "第二句, 带逗号", spotlight: true, waitAfter: 0 },
      ],
    };
    const csv = stringifyScript(perf, els);
    expect(csv.split("\n")[0]).toContain("order,actor,line");
    const again = parseScript(csv, els);
    expect(again.cues).toHaveLength(2);
    expect(again.cues[0].clipId).toBe("甲-01");
    expect(again.cues[1].text).toBe("第二句, 带逗号");
    expect(again.cues[1].spotlight).toBe(true);
  });
});

describe("performance schema", () => {
  it("normalises a performance and drops cues for removed actors", () => {
    const els = actors();
    const project = createProject();
    project.elements = els;
    project.performances = [
      {
        id: "pf1",
        name: "小品",
        loop: true,
        cues: [
          { id: "c1", actorId: els[0].id, text: "一", animation: "jump" as const },
          { id: "c2", actorId: "ghost", text: "幽灵" },
          {
            id: "c3",
            actorId: els[1].id,
            text: "带特效",
            effects: [{ id: "e1", url: "/api/files/a.gif", kind: "gif", anchor: "top", size: 99, duration: 800 }],
          },
        ],
      },
    ];
    const normalized = normalizeProject(project);
    expect(normalized.performances).toHaveLength(1);
    const pf = normalized.performances![0];
    expect(pf.loop).toBe(true);
    expect(pf.cues).toHaveLength(2);
    expect(pf.cues[0].animation).toBe("jump");
    expect(pf.cues[1].effects?.[0].anchor).toBe("top");
    expect(pf.cues[1].effects?.[0].size).toBe(99);
  });

  it("rejects effect urls that escape the same origin", () => {
    const els = actors();
    const project = createProject();
    project.elements = els;
    project.performances = [
      {
        id: "pf1",
        name: "坏特效",
        loop: false,
        cues: [
          {
            id: "c1",
            actorId: els[0].id,
            effects: [
              { id: "e1", url: "javascript:alert(1)", kind: "gif", anchor: "center", size: 100, duration: 500 },
              { id: "e2", url: "/api/files/ok.gif", kind: "gif", anchor: "center", size: 100, duration: 500 },
            ],
          },
        ],
      },
    ];
    const pf = normalizeProject(project).performances![0];
    expect(pf.cues[0].effects).toHaveLength(1);
    expect(pf.cues[0].effects![0].url).toBe("/api/files/ok.gif");
  });

  it("keeps legacy projects without performances valid", () => {
    const project = createProject();
    delete (project as { performances?: unknown }).performances;
    const normalized = normalizeProject(project);
    expect(Array.isArray(normalized.performances)).toBe(true);
    expect(normalized.performances).toHaveLength(0);
  });
});
