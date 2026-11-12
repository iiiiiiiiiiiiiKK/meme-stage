import { describe, expect, it } from "vitest";
import { groupAudioByCharacter, parseFileName } from "../../src/lib/importName";
import { runPool } from "../../src/lib/uploadPool";

describe("filename conventions", () => {
  it("uses the basename when there is no separator", () => {
    expect(parseFileName("cat.png")).toEqual({ name: "cat", base: "cat" });
    expect(parseFileName("老板-final.png").name).toBe("老板-final");
  });

  it("splits name / line / index", () => {
    expect(parseFileName("cat--我听不懂但是喵.png")).toMatchObject({
      name: "cat",
      line: "我听不懂但是喵",
    });
    expect(parseFileName("cat--喵--2.png")).toMatchObject({ name: "cat", line: "喵", index: 2 });
  });

  it("accepts the double-underscore separator", () => {
    expect(parseFileName("老K__这波不亏.png")).toMatchObject({ name: "老K", line: "这波不亏" });
  });

  it("extracts a trailing voice index", () => {
    expect(parseFileName("老K-01.wav")).toMatchObject({ name: "老K", index: 1 });
    expect(parseFileName("老K 12.wav")).toMatchObject({ name: "老K", index: 12 });
  });

  it("never throws on odd input", () => {
    expect(parseFileName("").name).toBe("未命名");
    expect(parseFileName("--.png").name).toBe("--");
  });});

describe("audio grouping", () => {
  it("groups and orders clips per character", () => {
    const files = [
      { name: "老K-02.wav" },
      { name: "老K-01.wav" },
      { name: "猫猫头-01.wav" },
    ];
    const groups = groupAudioByCharacter(files);
    expect([...groups.keys()].sort()).toEqual(["猫猫头", "老k"]);
    expect(groups.get("老k")?.map((f) => f.name)).toEqual(["老K-01.wav", "老K-02.wav"]);
  });
});

describe("runPool", () => {
  it("runs every task and reports progress", async () => {
    const progress: number[] = [];
    const result = await runPool(
      Array.from({ length: 7 }, (_, i) => ({
        label: String(i),
        run: async () => {
          await new Promise((r) => setTimeout(r, 5));
          return i * 2;
        },
      })),
      { concurrency: 3, onProgress: (done) => progress.push(done) },
    );
    expect(result.ok.sort((a, b) => a - b)).toEqual([0, 2, 4, 6, 8, 10, 12]);
    expect(result.failed).toEqual([]);
    expect(progress[progress.length - 1]).toBe(7);
  });

  it("never exceeds the concurrency limit", async () => {
    let active = 0;
    let peak = 0;
    await runPool(
      Array.from({ length: 10 }, () => ({
        label: "t",
        run: async () => {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 8));
          active -= 1;
        },
      })),
      { concurrency: 4 },
    );
    expect(peak).toBeLessThanOrEqual(4);
  });

  it("collects failures without stopping the batch", async () => {
    const result = await runPool(
      [
        { label: "ok-1", run: async () => 1 },
        { label: "bad", run: async () => Promise.reject(new Error("boom")) },
        { label: "ok-2", run: async () => 2 },
      ],
      { concurrency: 2 },
    );
    expect(result.ok).toHaveLength(2);
    expect(result.failed).toEqual([{ label: "bad", error: "boom" }]);
  });

  it("stops scheduling when aborted and counts the skipped ones", async () => {
    const controller = new AbortController();
    const started: number[] = [];
    const result = await runPool(
      Array.from({ length: 10 }, (_, i) => ({
        label: String(i),
        run: async () => {
          started.push(i);
          if (i === 0) controller.abort();
          await new Promise((r) => setTimeout(r, 5));
          return i;
        },
      })),
      { concurrency: 1, signal: controller.signal },
    );
    expect(started.length).toBeLessThan(10);
    expect(result.skipped).toBeGreaterThan(0);
  });
});
