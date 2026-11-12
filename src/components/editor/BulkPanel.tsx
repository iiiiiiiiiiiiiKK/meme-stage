import { useMemo, useRef, useState } from "react";
import { useEditor } from "../../store/editor";
import { Button, Field, Select, Slider, TextInput, cn, toast } from "../ui";
import { Icon } from "../Icon";
import { BUBBLE_PRESETS, makeBubble } from "../../lib/defaults";
import { LAYOUT_LABELS, layoutElements, type LayoutMode } from "../../lib/layout";
import { estimateSpeechSeconds } from "../../lib/deviceSpeech";
import { buildRecipes, RECIPE_LABELS, type RecipeId } from "../../lib/recipes";
import { applyCharacterRows, parseCharacterList } from "../../lib/characterList";
import type { BubblePreset } from "../../lib/types";

type SortKey = "z" | "name" | "voices";

/** 批量工作台：在画布内直接编辑几十个角色，不跳转到别的页面 */
export function BulkPanel() {
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  const mutate = useEditor((s) => s.mutate);
  const selectMany = useEditor((s) => s.selectMany);
  const focusElement = useEditor((s) => s.focusElement);

  const [sort, setSort] = useState<SortKey>("z");
  const [namePrefix, setNamePrefix] = useState("");
  const [lineText, setLineText] = useState("");
  const [bubblePreset, setBubblePreset] = useState<BubblePreset>("comic");
  const [volume, setVolume] = useState(1);
  const [height, setHeight] = useState(0);
  const [layout, setLayout] = useState<LayoutMode>("grid");
  const [recipe, setRecipe] = useState<RecipeId>("everyoneSpeaks");
  const [filter, setFilter] = useState("");
  const [listOpen, setListOpen] = useState(false);
  const [listText, setListText] = useState("");
  const listFileRef = useRef<HTMLInputElement | null>(null);

  const importCharacterList = (text: string) => {
    const parsed = parseCharacterList(text);
    if (parsed.rows.length === 0) {
      toast(parsed.errors[0] ?? "没有可用的行", "error");
      return;
    }
    let missed: string[] = [];
    mutate((draft) => {
      missed = applyCharacterRows(draft.elements, parsed.rows);
    }, true, "bulk-list-import");
    setListOpen(false);
    setListText("");
    const applied = parsed.rows.length - missed.length;
    toast(
      missed.length > 0
        ? `已更新 ${applied} 个人物，${missed.length} 个没匹配到：${missed[0]}`
        : `已按清单更新 ${applied} 个人物`,
      missed.length > 0 ? "info" : "success",
    );
  };

  const characters = useMemo(() => {
    const list = project.elements.filter((el) => el.type === "character");
    const needle = filter.trim().toLowerCase();
    const filtered = needle
      ? list.filter((el) => (el.character?.name ?? "").toLowerCase().includes(needle))
      : list;
    return [...filtered].sort((a, b) => {
      if (sort === "name") return (a.character?.name ?? "").localeCompare(b.character?.name ?? "");
      if (sort === "voices") return (b.character?.voices.length ?? 0) - (a.character?.voices.length ?? 0);
      return a.z - b.z;
    });
  }, [project.elements, sort, filter]);

  const selectedIds = selection.length > 0 ? selection : characters.map((el) => el.id);
  const selectedCount = selectedIds.length;
  const missingVoice = characters.filter((el) => (el.character?.voices.length ?? 0) === 0).length;

  const applyToSelection = (
    fn: (character: NonNullable<(typeof characters)[number]["character"]>, index: number) => void,
    key: string,
  ) => {
    if (selectedCount === 0) {
      toast("先选中要修改的人物", "info");
      return;
    }
    const ids = new Set(selectedIds);
    mutate((draft) => {
      let index = 0;
      for (const el of draft.elements) {
        if (ids.has(el.id) && el.character) {
          fn(el.character, index);
          index += 1;
        }
      }
    }, true, key);
  };

  const applyNamePrefix = () => {
    if (!namePrefix.trim()) return;
    const prefix = namePrefix.trim();
    applyToSelection((character, index) => {
      character.name = `${prefix}${character.name || index + 1}`;
    }, "bulk-name");
    toast(`已给 ${selectedCount} 个人物加前缀`, "success");
  };

  const applyLine = () => {
    if (!lineText.trim()) return;
    applyToSelection((character) => {
      character.line = lineText.trim();
      // also fill the first voice clip so single-voice characters speak it
      if (character.voices[0] && !character.voices[0].line) character.voices[0].line = lineText.trim();
    }, "bulk-line");
    toast("台词已写入选中人物", "success");
  };

  const applyBubble = () => {
    applyToSelection((character) => {
      character.bubble = { ...makeBubble(bubblePreset), bg: character.bubble.bg };
    }, "bulk-bubble");
    toast("气泡样式已统一", "success");
  };

  const applyVolume = () => {
    applyToSelection((character) => {
      for (const clip of character.voices) clip.volume = volume;
    }, "bulk-volume");
  };

  const applyHeight = () => {
    if (!height || height < 20) return;
    const ids = new Set(selectedIds);
    mutate((draft) => {
      for (const el of draft.elements) {
        if (!ids.has(el.id) || !el.width) continue;
        const ratio = el.width / Math.max(1, el.height);
        el.height = height;
        el.width = Math.round(height * ratio);
      }
    }, true, "bulk-height");
    toast(`已统一为 ${height}px 高`, "success");
  };

  const applyLayout = () => {
    if (characters.length === 0) return;
    const rects = layoutElements(
      characters.map((el) => ({ width: el.width, height: el.height })),
      { width: project.width, height: project.height },
      { mode: layout, baseHeight: 260, gap: 20, seed: 11 },
    );
    const order = new Map(characters.map((el, i) => [el.id, rects[i]]));
    mutate((draft) => {
      for (const el of draft.elements) {
        const rect = order.get(el.id);
        if (!rect) continue;
        el.x = Math.round(rect.x);
        el.y = Math.round(rect.y);
        el.width = Math.round(rect.width);
        el.height = Math.round(rect.height);
      }
    }, true, "bulk-layout");
    toast(`已按「${LAYOUT_LABELS.find((m) => m.mode === layout)?.label}」重新排布`, "success");
  };

  const applyRecipe = () => {
    const events = buildRecipes(recipe, project.elements);
    if (events.length === 0) {
      toast("这个配方需要至少一个人物", "info");
      return;
    }
    mutate((draft) => {
      draft.events = [...draft.events, ...events];
    });
    toast(`已生成 ${events.length} 条互动`, "success");
  };

  const addTestVoice = () => {
    applyToSelection((character) => {
      if (character.voices.length >= 20) return;
      const text = character.line || `${character.name || "角色"}：啊啊啊`;
      character.voices = [
        ...character.voices,
        {
          id: `dev_${Math.random().toString(36).slice(2, 9)}`,
          name: `设备朗读 · ${character.name || "角色"}`.slice(0, 40),
          url: "",
          duration: estimateSpeechSeconds(text),
          volume: 1,
          line: text,
          source: "device",
          text,
          lang: "zh-CN",
        },
      ];
    }, "bulk-device-voice");
    toast("已给选中人物补一条浏览器朗读", "success");
  };

  return (
    <div className="flex h-full min-h-0">
      <div className="scroll-thin w-[240px] shrink-0 space-y-1.5 overflow-y-auto border-r border-line/60 p-2">
        <div className="flex items-center gap-1">
          <TextInput
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="搜索人物"
            className="h-7 text-[11px]"
            aria-label="搜索人物"
          />
          <Select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="h-7 w-[70px] text-[10px]"
            aria-label="排序"
          >
            <option value="z">图层</option>
            <option value="name">名字</option>
            <option value="voices">语音</option>
          </Select>
        </div>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="flex-1"
            onClick={() => selectMany(characters.map((el) => el.id))}
          >
            全选
          </Button>
          <Button size="sm" variant="ghost" className="flex-1" onClick={() => selectMany([])}>
            清空
          </Button>
        </div>
        <div className="rounded border border-line/60 bg-ink/60 px-2 py-1.5 text-[10px] leading-relaxed text-mute">
          {characters.length} 个人物 · 选中 {selectedCount}
          {missingVoice > 0 ? <span className="text-warn"> · {missingVoice} 个没语音</span> : null}
        </div>

        <Field label="统一命名前缀">
          <div className="flex gap-1">
            <TextInput
              value={namePrefix}
              onChange={(e) => setNamePrefix(e.target.value)}
              placeholder="如 角色"
              className="h-7 text-[11px]"
              aria-label="命名前缀"
            />
            <Button size="sm" variant="secondary" onClick={applyNamePrefix}>
              应用
            </Button>
          </div>
        </Field>

        <Field label="批量台词">
          <div className="space-y-1">
            <TextInput
              value={lineText}
              onChange={(e) => setLineText(e.target.value)}
              placeholder="写进所有选中人物"
              className="h-7 text-[11px]"
              aria-label="批量台词"
            />
            <Button size="sm" variant="secondary" className="w-full" onClick={applyLine}>
              写入台词
            </Button>
          </div>
        </Field>

        <Field label="统一气泡">
          <div className="flex gap-1">
            <Select
              value={bubblePreset}
              onChange={(e) => setBubblePreset(e.target.value as BubblePreset)}
              className="h-7 text-[10px]"
              aria-label="气泡预设"
            >
              {(Object.keys(BUBBLE_PRESETS) as BubblePreset[]).map((preset) => (
                <option key={preset} value={preset}>
                  {preset}
                </option>
              ))}
            </Select>
            <Button size="sm" variant="secondary" onClick={applyBubble}>
              统一
            </Button>
          </div>
        </Field>

        <Field label={`统一音量 ${Math.round(volume * 100)}%`}>
          <div className="flex items-center gap-1">
            <Slider
              value={volume}
              min={0}
              max={1}
              onChange={(value) => setVolume(value)}
              label={`${Math.round(volume * 100)}`}
            />
            <Button size="sm" variant="secondary" onClick={applyVolume}>
              应用
            </Button>
          </div>
        </Field>

        <Field label="统一高度">
          <div className="flex gap-1">
            <TextInput
              value={height ? String(height) : ""}
              onChange={(e) => setHeight(Number(e.target.value) || 0)}
              placeholder="px"
              className="h-7 text-[11px]"
              aria-label="统一高度"
            />
            <Button size="sm" variant="secondary" onClick={applyHeight}>
              应用
            </Button>
          </div>
        </Field>

        <Field label="重新排布">
          <div className="flex gap-1">
            <Select
              value={layout}
              onChange={(e) => setLayout(e.target.value as LayoutMode)}
              className="h-7 text-[10px]"
              aria-label="排布方式"
            >
              {LAYOUT_LABELS.map((item) => (
                <option key={item.mode} value={item.mode}>
                  {item.label}
                </option>
              ))}
            </Select>
            <Button size="sm" variant="secondary" onClick={applyLayout}>
              排布
            </Button>
          </div>
        </Field>

        <Field label="互动配方">
          <div className="space-y-1">
            <Select
              value={recipe}
              onChange={(e) => setRecipe(e.target.value as RecipeId)}
              className="h-7 text-[10px]"
              aria-label="互动配方"
            >
              {(Object.keys(RECIPE_LABELS) as RecipeId[]).map((id) => (
                <option key={id} value={id}>
                  {RECIPE_LABELS[id]}
                </option>
              ))}
            </Select>
            <Button size="sm" variant="secondary" className="w-full" onClick={applyRecipe}>
              一键生成互动
            </Button>
          </div>
        </Field>

        <Button size="sm" variant="outline" icon="music" className="w-full" onClick={addTestVoice}>
          补一条设备朗读
        </Button>

        <Button
          size="sm"
          variant="secondary"
          icon="upload"
          className="w-full"
          onClick={() => setListOpen(true)}
        >
          导入人物清单（CSV / JSON）
        </Button>
        <input
          ref={listFileRef}
          type="file"
          accept=".csv,.txt,.json,text/csv,application/json"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.currentTarget.value = "";
            if (!file) return;
            setListText(await file.text());
            setListOpen(true);
          }}
        />
      </div>

      <div className="scroll-thin min-w-0 flex-1 overflow-auto p-2">
        {characters.length === 0 ? (
          <div className="grid h-full place-items-center text-[11px] text-mute">
            画布上还没有人物，先导入图片。
          </div>
        ) : (
          <table className="w-full border-separate border-spacing-y-1 text-[10.5px]">
            <thead>
              <tr className="text-left text-[9px] uppercase tracking-wider text-mute">
                <th className="w-7 px-1" />
                <th className="w-8 px-1">图</th>
                <th className="px-1">人物名</th>
                <th className="w-24 px-1">语音</th>
                <th className="w-20 px-1">台词</th>
                <th className="w-16 px-1">图层</th>
              </tr>
            </thead>
            <tbody>
              {characters.map((el) => {
                const character = el.character!;
                const active = selection.includes(el.id);
                return (
                  <tr
                    key={el.id}
                    className={cn(
                      "cursor-pointer rounded",
                      active ? "bg-neon/5" : "hover:bg-white/5",
                    )}
                    onClick={() => focusElement(el.id)}
                  >
                    <td className="px-1">
                      <input
                        type="checkbox"
                        checked={active}
                        aria-label={`选择 ${character.name}`}
                        className="accent-[#b6ff3c]"
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => {
                          selectMany(
                            active
                              ? selection.filter((id) => id !== el.id)
                              : [...selection, el.id],
                          );
                        }}
                      />
                    </td>
                    <td className="px-1">
                      <img
                        src={character.thumbUrl || character.imageUrl}
                        alt=""
                        className="h-6 w-6 rounded border border-line object-cover"
                        loading="lazy"
                      />
                    </td>
                    <td className="px-1">
                      <input
                        value={character.name}
                        aria-label={`${character.name} 名称`}
                        className="h-6 w-full min-w-[90px] rounded border border-transparent bg-transparent px-1 text-[10.5px] outline-none hover:border-line focus:border-neon/50"
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          const value = e.target.value;
                          useEditor.getState().updateCharacter(
                            el.id,
                            (c) => void (c.name = value),
                            true,
                            `bulk-name:${el.id}`,
                          );
                        }}
                      />
                    </td>
                    <td className="px-1">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded px-1 py-0.5",
                          character.voices.length === 0 ? "bg-warn/15 text-warn" : "bg-ink-3 text-mute",
                        )}
                      >
                        <Icon name="volume" size={9} />
                        {character.voices.length}
                      </span>
                    </td>
                    <td className="max-w-[120px] truncate px-1 text-mute">
                      {character.line || character.voices.find((v) => v.line)?.line || "—"}
                    </td>
                    <td className="px-1 tabular-nums text-mute">{el.z}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {listOpen ? (
        <div
          className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setListOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-lg border border-line bg-ink-2 p-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1.5 flex items-center gap-2">
              <div className="text-[12px] font-bold">导入人物清单</div>
              <Button size="sm" variant="ghost" onClick={() => listFileRef.current?.click()}>
                选择文件
              </Button>
            </div>
            <p className="mb-1.5 text-[10px] leading-relaxed text-mute">
              按名字匹配画布上已有的人物，只更新清单里写到的字段：
              <code>name,line,voicemode,bubble,volume,height</code>。不会新增或删除人物。
            </p>
            <textarea
              value={listText}
              onChange={(e) => setListText(e.target.value)}
              placeholder={"name,line,bubble,volume,height\n老K,这波真的不亏,comic,1,360"}
              aria-label="人物清单内容"
              className="scroll-thin h-36 w-full rounded border border-line bg-ink px-2 py-1.5 font-mono text-[10.5px] leading-relaxed outline-none focus:border-neon/50"
            />
            <div className="mt-2 flex justify-end gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => setListOpen(false)}>
                取消
              </Button>
              <Button
                size="sm"
                variant="primary"
                icon="check"
                onClick={() => importCharacterList(listText)}
              >
                按清单更新
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
