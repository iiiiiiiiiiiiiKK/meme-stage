import { describe, expect, it } from "vitest";
import { applyCharacterRows, parseCharacterList } from "../../src/lib/characterList";
import { createCharacter } from "../../src/lib/defaults";

function cast() {
  const make = (name: string) => {
    const el = createCharacter({ name, imageUrl: `/api/files/${name}.webp`, width: 300, height: 400 });
    el.character!.voices = [
      { id: `${name}-1`, name: `${name}-1`, url: `/api/files/${name}-1.wav`, duration: 1, volume: 1 },
    ];
    return el;
  };
  return [make("老K"), make("猫猫头")];
}

describe("character list import", () => {
  it("parses CSV with a header", () => {
    const result = parseCharacterList(
      ["name,line,voicemode,bubble,volume,height", "老K,这波不亏,random,thought,0.8,320"].join("\n"),
    );
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      name: "老K",
      line: "这波不亏",
      voiceMode: "random",
      bubble: "thought",
      volume: 0.8,
      height: 320,
    });
  });

  it("parses JSON arrays and objects", () => {
    const list = parseCharacterList(
      JSON.stringify([{ name: "老K", line: "一句", volume: "0.5" }]),
    );
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0].volume).toBe(0.5);

    const wrapped = parseCharacterList(
      JSON.stringify({ characters: [{ name: "猫猫头", bubble: "caption" }] }),
    );
    expect(wrapped.rows[0].bubble).toBe("caption");
  });

  it("ignores unknown enum values instead of failing", () => {
    const result = parseCharacterList("name,bubble,voicemode\n老K,nope,weird");
    expect(result.rows[0].bubble).toBeUndefined();
    expect(result.rows[0].voiceMode).toBeUndefined();
  });

  it("reports rows without a name", () => {
    const result = parseCharacterList("name,line\n,空\n老K,有");
    expect(result.rows).toHaveLength(1);
    expect(result.errors[0]).toContain("第 1 行");
  });

  it("applies rows to matching characters and keeps aspect ratio", () => {
    const elements = cast();
    const rows = parseCharacterList(
      ["name,line,bubble,volume,height", "老k,第一句,caption,0.6,200"].join("\n"),
    ).rows;
    const missed = applyCharacterRows(elements, rows);
    expect(missed).toEqual([]);
    const target = elements[0].character!;
    expect(target.line).toBe("第一句");
    expect(target.bubble.preset).toBe("caption");
    expect(target.voices[0].volume).toBe(0.6);
    expect(elements[0].height).toBe(200);
    expect(elements[0].width).toBe(150);
  });

  it("reports names that are not on the canvas", () => {
    const elements = cast();
    const missed = applyCharacterRows(elements, [{ name: "不存在" }]);
    expect(missed).toEqual(["不存在"]);
  });

  it("applies a shared voice line to every clip", () => {
    const elements = cast();
    applyCharacterRows(elements, [{ name: "猫猫头", voiceLine: "统一台词" }]);
    expect(elements[1].character!.voices[0].line).toBe("统一台词");
  });

  it("rejects empty input and broken JSON", () => {
    expect(parseCharacterList("  ").errors[0]).toBe("内容是空的");
    expect(parseCharacterList("[oops").errors[0]).toBe("JSON 格式不正确");
  });
});
