import { useMemo, useRef, useState } from "react";
import { useEditor } from "../../store/editor";
import { useAssets } from "../../store/assets";
import { Button, IconButton, Select, TextInput, cn, toast } from "../ui";
import { Icon } from "../Icon";
import { ANIMATION_LABELS, ANIMATIONS, makeCue, makePerformance } from "../../lib/defaults";
import { parseScript, stringifyScript, SCRIPT_TEMPLATE } from "../../lib/script";
import { usePlayback } from "../../store/playback";
import type { AnimationName, CueEffect, PerformanceCue } from "../../lib/types";

const EFFECT_ANCHORS: { id: CueEffect["anchor"]; label: string }[] = [
  { id: "center", label: "中间" },
  { id: "top", label: "头顶" },
  { id: "bottom", label: "脚下" },
  { id: "left", label: "左侧" },
  { id: "right", label: "右侧" },
  { id: "top-left", label: "左上" },
  { id: "top-right", label: "右上" },
];

export function ScriptPanel({ onTest }: { onTest: () => void }) {
  const project = useEditor((s) => s.project);
  const mutate = useEditor((s) => s.mutate);
  const characters = useMemo(
    () => project.elements.filter((el) => el.type === "character"),
    [project.elements],
  );
  const performance = project.performances?.[0] ?? null;
  const assets = useAssets((s) => s.items);
  const animAssets = assets.filter((a) => a.kind === "image");
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);
  const playbackState = usePlayback((s) => s.state);
  const playbackIndex = usePlayback((s) => s.index);

  const createPerformance = () => {
    if (characters.length === 0) {
      toast("先导入人物再写剧本", "info");
      return;
    }
    const pf = makePerformance("小品剧本");
    pf.cues = characters.slice(0, 4).map((el) => makeCue(el.id, { waitAfter: 260 }));
    mutate((draft) => {
      draft.performances = [pf];
    });
    toast("剧本已创建，按顺序填台词即可", "success");
  };

  const updateCue = (index: number, patch: Partial<PerformanceCue>) => {
    mutate((draft) => {
      const pf = draft.performances?.[0];
      if (!pf) return;
      const cue = pf.cues[index];
      if (cue) Object.assign(cue, patch);
    }, true, `cue:${performance?.cues[index]?.id}:${Object.keys(patch).join(",")}`);
  };

  const moveCue = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || !performance || target >= performance.cues.length) return;
    mutate((draft) => {
      const pf = draft.performances?.[0];
      if (!pf) return;
      const [item] = pf.cues.splice(index, 1);
      pf.cues.splice(target, 0, item);
    });
  };

  const removeCue = (index: number) => {
    mutate((draft) => {
      const pf = draft.performances?.[0];
      if (!pf) return;
      pf.cues.splice(index, 1);
    });
  };

  const addCue = () => {
    if (!performance) return;
    const actor = characters[0];
    if (!actor) return;
    mutate((draft) => {
      draft.performances?.[0]?.cues.push(makeCue(actor.id, { waitAfter: 260 }));
    });
  };

  const applyImport = (text: string) => {
    const result = parseScript(text, characters);
    if (result.errors.length > 0 && result.cues.length === 0) {
      toast(result.errors[0], "error");
      return;
    }
    const pf = makePerformance(result.name || "导入的剧本");
    pf.cues = result.cues;
    mutate((draft) => {
      draft.performances = [pf];
    });
    setImportOpen(false);
    setImportText("");
    toast(
      result.errors.length > 0
        ? `已导入 ${result.cues.length} 行，${result.errors.length} 行有问题：${result.errors[0]}`
        : `已导入 ${result.cues.length} 行台词`,
      result.errors.length > 0 ? "info" : "success",
    );
  };

  const exportScript = () => {
    if (!performance) return;
    const text = stringifyScript(performance, project.elements);
    const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${performance.name || "script"}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  if (!performance) {
    return (
      <div className="grid h-full place-items-center px-6">
        <div className="max-w-md text-center">
          <div className="font-display text-lg">还没有剧本</div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-mute">
            剧本让三四个人物按顺序自动说话：一句话接一句话，像小品一样自己演。
            点下面的按钮会用当前人物生成一个空剧本。
          </p>
          <div className="mt-3 flex flex-wrap justify-center gap-1.5">
            <Button size="sm" variant="primary" icon="sparkles" onClick={createPerformance}>
              创建剧本
            </Button>
            <Button size="sm" variant="secondary" icon="upload" onClick={() => setImportOpen(true)}>
              导入 CSV / JSON
            </Button>
          </div>
        </div>
        {importOpen ? (
          <ImportBox
            value={importText}
            onChange={setImportText}
            onClose={() => setImportOpen(false)}
            onApply={applyImport}
            onFile={() => fileRef.current?.click()}
          />
        ) : null}
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.txt,.json,text/csv,application/json"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.currentTarget.value = "";
            if (!file) return;
            setImportText(await file.text());
          }}
        />
      </div>
    );
  }

  const totalMs = performance.cues.reduce((sum, cue) => {
    const el = project.elements.find((item) => item.id === cue.actorId);
    const clip = el?.character?.voices.find((v) => v.id === cue.clipId) ?? el?.character?.voices[0];
    const audioMs = ((clip?.duration ?? 0) / (clip?.rate ?? 1)) * 1000;
    return sum + (cue.waitBefore ?? 0) + Math.max(audioMs, cue.text ? 1200 : 0) + (cue.waitAfter ?? 260);
  }, 0);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line/60 px-2 py-1.5">
        <TextInput
          value={performance.name}
          className="h-7 w-40 text-[11px]"
          aria-label="剧本名称"
          onChange={(e) =>
            mutate((draft) => {
              const pf = draft.performances?.[0];
              if (pf) pf.name = e.target.value;
            }, true, "script-name")
          }
        />
        <span className="text-[10px] text-mute">
          {performance.cues.length} 行 · 约 {Math.round(totalMs / 1000)}s
        </span>
        <label className="flex items-center gap-1 text-[10px] text-mute">
          <input
            type="checkbox"
            checked={performance.loop}
            className="accent-[#b6ff3c]"
            onChange={(e) =>
              mutate((draft) => {
                const pf = draft.performances?.[0];
                if (pf) pf.loop = e.target.checked;
              })
            }
          />
          循环
        </label>
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="primary" icon="play" onClick={onTest}>
            试演
          </Button>
          <Button size="sm" variant="secondary" icon="plus" onClick={addCue} disabled={characters.length === 0}>
            加一行
          </Button>
          <Button size="sm" variant="ghost" icon="upload" onClick={() => setImportOpen(true)}>
            导入
          </Button>
          <Button size="sm" variant="ghost" icon="download" onClick={exportScript}>
            导出
          </Button>
        </div>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-2">
        {performance.cues.length === 0 ? (
          <div className="grid h-full place-items-center text-[11px] text-mute">
            剧本是空的，点「加一行」开始写。
          </div>
        ) : (
          <div className="space-y-1.5">
            {performance.cues.map((cue, index) => {
              const actor = project.elements.find((el) => el.id === cue.actorId);
              const voices = actor?.character?.voices ?? [];
              const clip = voices.find((v) => v.id === cue.clipId);
              const speaking = playbackState !== "idle" && playbackIndex === index;
              return (
                <div
                  key={cue.id}
                  className={cn(
                    "rounded-md border bg-ink/60 p-1.5 transition-colors",
                    speaking ? "border-neon/70 bg-neon/5" : "border-line",
                  )}
                  data-testid="script-cue"
                  data-speaking={speaking ? "true" : undefined}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded bg-ink-3 text-[10px] font-bold text-neon">
                      {index + 1}
                    </span>
                    <Select
                      value={cue.actorId}
                      className="h-6 w-28 text-[10.5px]"
                      aria-label={`第 ${index + 1} 行人物`}
                      onChange={(e) => updateCue(index, { actorId: e.target.value, clipId: undefined })}
                    >
                      {characters.map((el) => (
                        <option key={el.id} value={el.id}>
                          {el.character?.name || "未命名"}
                        </option>
                      ))}
                    </Select>
                    <Select
                      value={cue.clipId ?? ""}
                      className="h-6 w-32 text-[10.5px]"
                      aria-label={`第 ${index + 1} 行语音`}
                      onChange={(e) => {
                        const clipId = e.target.value || undefined;
                        const picked = voices.find((v) => v.id === clipId);
                        updateCue(index, {
                          clipId,
                          ...(picked?.line ? { text: picked.line } : {}),
                        });
                      }}
                    >
                      <option value="">自动（下一条）</option>
                      {voices.map((v, i) => (
                        <option key={v.id} value={v.id}>
                          {i + 1}. {v.name.slice(0, 16)}
                        </option>
                      ))}
                    </Select>
                    <Select
                      value={cue.animation ?? ""}
                      className="h-6 w-24 text-[10.5px]"
                      aria-label={`第 ${index + 1} 行动作`}
                      onChange={(e) =>
                        updateCue(index, {
                          animation: (e.target.value || undefined) as AnimationName | undefined,
                        })
                      }
                    >
                      <option value="">无动作</option>
                      {ANIMATIONS.map((anim) => (
                        <option key={anim} value={anim}>
                          {ANIMATION_LABELS[anim]}
                        </option>
                      ))}
                    </Select>
                    <label className="flex items-center gap-1 text-[9.5px] text-mute" title="说话时其他人物变暗">
                      <input
                        type="checkbox"
                        checked={!!cue.spotlight}
                        className="accent-[#b6ff3c]"
                        onChange={(e) => updateCue(index, { spotlight: e.target.checked })}
                      />
                      聚光
                    </label>
                    <label className="flex items-center gap-1 text-[9.5px] text-mute" title="嘴部开合">
                      <input
                        type="checkbox"
                        checked={!!cue.lipFlap}
                        className="accent-[#b6ff3c]"
                        onChange={(e) => updateCue(index, { lipFlap: e.target.checked })}
                      />
                      口型
                    </label>
                    <div className="ml-auto flex">
                      <IconButton
                        icon="chevron-up"
                        label="上移"
                        size={12}
                        className="h-5 w-5"
                        disabled={index === 0}
                        onClick={() => moveCue(index, -1)}
                      />
                      <IconButton
                        icon="chevron-down"
                        label="下移"
                        size={12}
                        className="h-5 w-5"
                        disabled={index === performance.cues.length - 1}
                        onClick={() => moveCue(index, 1)}
                      />
                      <IconButton
                        icon="close"
                        label="删除这一行"
                        size={12}
                        className="h-5 w-5 hover:text-hot"
                        onClick={() => removeCue(index)}
                      />
                    </div>
                  </div>

                  <div className="mt-1 flex items-center gap-1.5">
                    <input
                      value={cue.text ?? ""}
                      maxLength={280}
                      placeholder={clip?.line || "这一行的台词（留空则用语音自带的台词）"}
                      aria-label={`第 ${index + 1} 行台词`}
                      className="h-6 min-w-0 flex-1 rounded border border-line bg-ink-2 px-1.5 text-[10.5px] outline-none focus:border-neon/50"
                      onChange={(e) => updateCue(index, { text: e.target.value })}
                    />
                    <label className="flex shrink-0 items-center gap-0.5 text-[9px] text-mute">
                      停
                      <input
                        type="number"
                        min={0}
                        max={20000}
                        step={50}
                        value={cue.waitAfter ?? 260}
                        aria-label={`第 ${index + 1} 行停顿`}
                        className="h-5 w-12 rounded border border-line bg-ink-2 px-1 text-[9.5px] tabular-nums outline-none focus:border-neon/50"
                        onChange={(e) => updateCue(index, { waitAfter: Number(e.target.value) })}
                      />
                      ms
                    </label>
                  </div>

                  <CueEffects
                    cue={cue}
                    index={index}
                    animAssets={animAssets}
                    onChange={(effects) => updateCue(index, { effects })}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {importOpen ? (
        <ImportBox
          value={importText}
          onChange={setImportText}
          onClose={() => setImportOpen(false)}
          onApply={applyImport}
          onFile={() => fileRef.current?.click()}
        />
      ) : null}
      <input
        ref={fileRef}
        type="file"
        accept=".csv,.txt,.json,text/csv,application/json"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.currentTarget.value = "";
          if (!file) return;
          setImportText(await file.text());
          setImportOpen(true);
        }}
      />
    </div>
  );
}

function CueEffects({
  cue,
  index,
  animAssets,
  onChange,
}: {
  cue: PerformanceCue;
  index: number;
  animAssets: { id: string; name: string; url: string; mime: string }[];
  onChange: (effects: CueEffect[]) => void;
}) {
  const effects = cue.effects ?? [];
  const [open, setOpen] = useState(false);

  const add = (asset: { url: string; mime: string; name: string }) => {
    if (effects.length >= 6) return;
    const kind: CueEffect["kind"] = asset.mime.includes("mp4")
      ? "mp4"
      : asset.mime.includes("webp")
        ? "webp"
        : "gif";
    onChange([
      ...effects,
      {
        id: `fx_${Math.random().toString(36).slice(2, 8)}`,
        url: asset.url,
        kind,
        anchor: "top-right",
        size: 160,
        duration: 1200,
        loop: kind === "gif",
        muted: true,
      },
    ]);
  };

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-[9.5px] text-mute hover:text-paper"
      >
        <Icon name="sparkles" size={10} />
        特效 {effects.length > 0 ? `(${effects.length})` : ""}
      </button>
      {open ? (
        <div className="mt-1 space-y-1 rounded border border-line/60 bg-ink-2/60 p-1.5">
          {effects.length === 0 ? (
            <p className="text-[9.5px] text-mute">这一行还没有特效图。先上传 GIF / WebP / MP4 到素材库。</p>
          ) : null}
          {effects.map((fx, fxIndex) => (
            <div key={fx.id} className="flex flex-wrap items-center gap-1">
              <span className="text-[9px] text-mute">{fxIndex + 1}.</span>
              <Select
                value={fx.anchor}
                className="h-5 w-20 text-[9.5px]"
                aria-label={`第 ${index + 1} 行特效 ${fxIndex + 1} 位置`}
                onChange={(e) =>
                  onChange(
                    effects.map((item) =>
                      item.id === fx.id ? { ...item, anchor: e.target.value as CueEffect["anchor"] } : item,
                    ),
                  )
                }
              >
                {EFFECT_ANCHORS.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </Select>
              <input
                type="number"
                min={40}
                max={900}
                step={10}
                value={fx.size}
                aria-label={`第 ${index + 1} 行特效 ${fxIndex + 1} 大小`}
                className="h-5 w-12 rounded border border-line bg-ink px-1 text-[9.5px] tabular-nums outline-none"
                onChange={(e) =>
                  onChange(
                    effects.map((item) =>
                      item.id === fx.id ? { ...item, size: Number(e.target.value) } : item,
                    ),
                  )
                }
              />
              <input
                type="number"
                min={200}
                max={20000}
                step={100}
                value={fx.duration}
                aria-label={`第 ${index + 1} 行特效 ${fxIndex + 1} 时长`}
                className="h-5 w-14 rounded border border-line bg-ink px-1 text-[9.5px] tabular-nums outline-none"
                onChange={(e) =>
                  onChange(
                    effects.map((item) =>
                      item.id === fx.id ? { ...item, duration: Number(e.target.value) } : item,
                    ),
                  )
                }
              />
              <span className="text-[8.5px] text-mute">ms</span>
              <IconButton
                icon="close"
                label="移除特效"
                size={10}
                className="h-4 w-4 hover:text-hot"
                onClick={() => onChange(effects.filter((item) => item.id !== fx.id))}
              />
            </div>
          ))}
          {animAssets.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {animAssets.slice(0, 12).map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  onClick={() => add(asset)}
                  className="flex items-center gap-1 rounded border border-line px-1 py-0.5 text-[9px] text-mute hover:border-neon/50 hover:text-paper"
                  title={asset.name}
                >
                  <img src={asset.url} alt="" className="h-4 w-4 rounded object-cover" />
                  {asset.name.slice(0, 10)}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-[9px] text-mute">素材库里还没有图片类素材。</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ImportBox({
  value,
  onChange,
  onClose,
  onApply,
  onFile,
}: {
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onApply: (text: string) => void;
  onFile: () => void;
}) {
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-lg border border-line bg-ink-2 p-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1.5 flex items-center gap-2">
          <div className="text-[12px] font-bold">导入剧本</div>
          <Button size="sm" variant="ghost" onClick={onFile}>
            选择文件
          </Button>
          <IconButton icon="close" label="关闭" className="ml-auto" onClick={onClose} />
        </div>
        <p className="mb-1.5 text-[10px] leading-relaxed text-mute">
          CSV 表头：<code>order,actor,line,audio,action,waitAfter,spotlight</code>；也支持 JSON
          <code>{`{"name":"小品","cues":[{"actor":"人物名","text":"台词"}]}`}</code>。
          人物按名字匹配。
        </p>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={SCRIPT_TEMPLATE}
          className="scroll-thin h-40 w-full rounded border border-line bg-ink px-2 py-1.5 font-mono text-[10.5px] leading-relaxed outline-none focus:border-neon/50"
          aria-label="剧本内容"
        />
        <div className="mt-2 flex justify-end gap-1.5">
          <Button size="sm" variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button size="sm" variant="primary" icon="check" onClick={() => onApply(value)}>
            导入并替换剧本
          </Button>
        </div>
      </div>
    </div>
  );
}
