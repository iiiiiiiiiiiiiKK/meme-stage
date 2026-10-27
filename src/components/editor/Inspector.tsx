import { useEffect, useRef, useState } from "react";
import { useEditor } from "../../store/editor";
import { useAssets } from "../../store/assets";
import { Icon } from "../Icon";
import {
  Button,
  ColorInput,
  Field,
  IconButton,
  NumberInput,
  Section,
  Select,
  Slider,
  Switch,
  TextArea,
  TextInput,
  cn,
  toast,
} from "../ui";
import { BubbleStyleEditor } from "./BubbleStyleEditor";
import { CANVAS_PRESETS } from "../../lib/layout";
import type { CanvasElement, ProjectData } from "../../lib/types";
import { audioDuration, loadImage } from "../../lib/image";
import { audioEngine } from "../../lib/audio";
import { api } from "../../lib/api";
import { estimateTextHeight } from "../canvas/ElementNode";
import { canvasPresetFor } from "../../lib/export";

export function Inspector() {
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  const elements = project.elements.filter((el) => selection.includes(el.id));

  if (elements.length > 1) return <MultiInspector elements={elements} />;
  if (elements.length === 1) {
    const el = elements[0];
    return el.type === "text" ? <TextInspector el={el} /> : <CharacterInspector el={el} />;
  }
  return <ProjectInspector project={project} />;
}

function PanelShell({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-line px-3 py-2.5">
        <div className="truncate text-[13px] font-bold">{title}</div>
        {subtitle ? <div className="mt-0.5 text-[10px] leading-tight text-mute">{subtitle}</div> : null}
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto pb-6">{children}</div>
    </div>
  );
}

function ProjectInspector({ project }: { project: ProjectData }) {
  const mutate = useEditor((s) => s.mutate);
  const fit = useEditor((s) => s.requestFit);
  const preset = canvasPresetFor(project.width, project.height);
  const [uploading, setUploading] = useState(false);
  const bgInput = useRef<HTMLInputElement | null>(null);

  const setSize = (width: number, height: number) => {
    mutate((draft) => {
      draft.width = width;
      draft.height = height;
    });
    setTimeout(fit, 30);
  };

  return (
    <PanelShell title="作品设置" subtitle="没有选中对象时，这里调整整张画布">
      <Section title="画布">
        <div className="grid grid-cols-2 gap-1.5">
          {CANVAS_PRESETS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSize(item.width, item.height)}
              className={cn(
                "rounded-md border px-2 py-1.5 text-left transition-colors",
                preset === item.id
                  ? "border-neon/60 bg-neon/10"
                  : "border-line bg-ink hover:border-paper/30",
              )}
            >
              <div className="text-[11px] font-semibold">{item.label}</div>
              <div className="text-[9px] text-mute">{item.hint}</div>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="宽度" hint="px">
            <NumberInput
              value={project.width}
              min={320}
              max={8000}
              step={10}
              onChange={(width) => mutate((draft) => void (draft.width = width), true, "canvas:w")}
            />
          </Field>
          <Field label="高度" hint="px">
            <NumberInput
              value={project.height}
              min={320}
              max={8000}
              step={10}
              onChange={(height) => mutate((draft) => void (draft.height = height), true, "canvas:h")}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <Button
            size="sm"
            variant={project.mode === "preset" ? "primary" : "secondary"}
            onClick={() => mutate((draft) => void (draft.mode = "preset"))}
          >
            固定画幅
          </Button>
          <Button
            size="sm"
            variant={project.mode === "free" ? "primary" : "secondary"}
            onClick={() => mutate((draft) => void (draft.mode = "free"))}
          >
            自由画布
          </Button>
        </div>
        <p className="text-[10px] leading-relaxed text-mute">
          自由画布允许元素跑到画幅之外；发布时访客会看到完整画幅，超出部分会被裁掉。
        </p>
      </Section>

      <Section title="背景">
        <Field label="纯色背景">
          <ColorInput
            value={project.background.color}
            onChange={(color) =>
              mutate((draft) => {
                draft.background = { type: "color", color };
              }, true, "bg:color")
            }
            label="画布背景色"
          />
        </Field>
        <input
          ref={bgInput}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.currentTarget.value = "";
            if (!file) return;
            setUploading(true);
            try {
              const asset = await api.uploadAsset(file, { kind: "image", name: "背景" });
              const img = await loadImage(asset.url);
              mutate((draft) => {
                draft.background = {
                  type: "image",
                  color: draft.background.color,
                  url: asset.url,
                  assetId: asset.id,
                };
              });
              toast(`背景已设置为 ${img.width}×${img.height}`, "success");
            } catch (error) {
              toast(error instanceof Error ? error.message : "背景上传失败", "error");
            } finally {
              setUploading(false);
            }
          }}
        />
        <div className="grid grid-cols-2 gap-1.5">
          <Button size="sm" icon="image" disabled={uploading} onClick={() => bgInput.current?.click()}>
            {uploading ? "上传中…" : "背景图片"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={project.background.type !== "image"}
            onClick={() =>
              mutate((draft) => {
                draft.background = { type: "color", color: draft.background.color };
              })
            }
          >
            移除图片
          </Button>
        </div>
      </Section>

      <Section title="声音">
        <Field label="播放策略">
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => mutate((draft) => void (draft.settings.audioMode = "single"))}
              className={cn(
                "rounded-md border px-2 py-1.5 text-left",
                project.settings.audioMode === "single" ? "border-neon/60 bg-neon/10" : "border-line",
              )}
            >
              <div className="text-[11px] font-semibold">单音频</div>
              <div className="text-[9px] text-mute">新声音打断旧声音</div>
            </button>
            <button
              type="button"
              onClick={() => mutate((draft) => void (draft.settings.audioMode = "mix"))}
              className={cn(
                "rounded-md border px-2 py-1.5 text-left",
                project.settings.audioMode === "mix" ? "border-neon/60 bg-neon/10" : "border-line",
              )}
            >
              <div className="text-[11px] font-semibold">混音</div>
              <div className="text-[9px] text-mute">允许同时说话</div>
            </button>
          </div>
        </Field>
        <Switch
          label="点击反馈动画"
          hint="弹跳 / 抖动，尊重系统减少动态设置"
          checked={project.settings.reactions}
          onChange={(reactions) => mutate((draft) => void (draft.settings.reactions = reactions))}
        />
        <Field label="访客提示语">
          <TextInput
            value={project.settings.soundHint}
            maxLength={40}
            onChange={(e) =>
              mutate((draft) => void (draft.settings.soundHint = e.target.value), true, "hint")
            }
          />
        </Field>
      </Section>

      <Section title="发布信息" defaultOpen={false}>
        <Field label="简介" hint={`${project.description.length}/600`}>
          <TextArea
            value={project.description}
            maxLength={600}
            onChange={(e) =>
              mutate((draft) => void (draft.description = e.target.value), true, "desc")
            }
            placeholder="这张图是什么梗？点谁会发生什么？"
          />
        </Field>
        <Field label="作者署名">
          <TextInput
            value={project.settings.authorName}
            maxLength={40}
            placeholder="留空则不显示"
            onChange={(e) =>
              mutate((draft) => void (draft.settings.authorName = e.target.value), true, "author")
            }
          />
        </Field>
        <Switch
          label="显示作者"
          checked={project.settings.showAuthor}
          onChange={(value) => mutate((draft) => void (draft.settings.showAuthor = value))}
        />
        <Switch
          label="允许别人 Remix"
          hint="访客可以复制一份到自己的编辑器"
          checked={project.settings.allowRemix}
          onChange={(value) => mutate((draft) => void (draft.settings.allowRemix = value))}
        />
      </Section>
    </PanelShell>
  );
}

function CharacterInspector({ el }: { el: CanvasElement }) {
  const project = useEditor((s) => s.project);
  const updateElement = useEditor((s) => s.updateElement);
  const updateCharacter = useEditor((s) => s.updateCharacter);
  const moveLayer = useEditor((s) => s.moveLayer);
  const duplicate = useEditor((s) => s.duplicateSelected);
  const remove = useEditor((s) => s.removeSelected);
  const assets = useAssets((s) => s.items);
  const loadAssets = useAssets((s) => s.load);
  const character = el.character!;
  const [previewing, setPreviewing] = useState(false);
  const voiceInput = useRef<HTMLInputElement | null>(null);
  const [binding, setBinding] = useState(false);

  useEffect(() => {
    void loadAssets();
  }, [loadAssets]);

  const audioAssets = assets.filter((a) => a.kind === "audio");

  const bindAudio = async (file: File) => {
    setBinding(true);
    try {
      const duration = await audioDuration(file);
      const asset = await api.uploadAsset(file, { kind: "audio", name: file.name, duration });
      updateCharacter(el.id, (c) => {
        c.voice = {
          id: asset.id,
          name: file.name,
          url: asset.url,
          duration: asset.duration ?? duration,
          volume: 1,
        };
      });
      toast("语音已绑定", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "语音上传失败", "error");
    } finally {
      setBinding(false);
    }
  };

  return (
    <PanelShell
      title={character.name || "未命名人物"}
      subtitle={`${Math.round(el.width)} × ${Math.round(el.height)} · 图层 ${el.z}`}
    >
      <div className="flex gap-2 border-b border-line/70 px-3 py-2.5">
        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-line bg-ink-3 checker">
          <img
            src={character.thumbUrl || character.imageUrl}
            alt=""
            className="h-full w-full object-contain"
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <TextInput
            value={character.name}
            maxLength={40}
            onChange={(e) =>
              updateCharacter(el.id, (c) => void (c.name = e.target.value), true, `name:${el.id}`)
            }
            aria-label="人物名称"
          />
          <div className="flex gap-1">
            <Button size="sm" variant="secondary" icon="flip" className="flex-1" onClick={() => updateElement(el.id, { flipX: !el.flipX })}>
              翻转
            </Button>
            <IconButton
              icon={el.locked ? "lock" : "unlock"}
              label={el.locked ? "解锁" : "锁定"}
              active={el.locked}
              onClick={() => updateElement(el.id, { locked: !el.locked })}
            />
            <IconButton
              icon={el.hidden ? "eye-off" : "eye"}
              label={el.hidden ? "显示" : "隐藏"}
              onClick={() => updateElement(el.id, { hidden: !el.hidden })}
            />
          </div>
        </div>
      </div>

      <Section title="声音" action={<span className="text-[9px] text-mute">{character.voice ? "已绑定" : "未绑定"}</span>}>
        <input
          ref={voiceInput}
          type="file"
          accept="audio/mpeg,audio/wav,audio/x-wav,audio/ogg,audio/mp4,.mp3,.wav,.m4a,.ogg"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.currentTarget.value = "";
            if (file) void bindAudio(file);
          }}
        />
        {character.voice ? (
          <div className="rounded-lg border border-neon/30 bg-neon/5 p-2">
            <div className="flex items-center gap-1.5">
              <Icon name="music" size={12} className="text-neon" />
              <span className="min-w-0 flex-1 truncate text-[11px]">{character.voice.name}</span>
              <span className="text-[9px] text-mute">{character.voice.duration.toFixed(1)}s</span>
            </div>
            <div className="mt-1.5 flex gap-1">
              <Button
                size="sm"
                variant="secondary"
                icon={previewing ? "pause" : "play"}
                className="flex-1"
                onClick={async () => {
                  if (previewing) {
                    audioEngine.stop();
                    setPreviewing(false);
                    return;
                  }
                  setPreviewing(true);
                  await audioEngine.play(character.voice!, "single");
                  setPreviewing(false);
                }}
              >
                {previewing ? "停止" : "试听"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => voiceInput.current?.click()}>
                替换
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() =>
                  updateCharacter(el.id, (c) => {
                    c.voice = null;
                  })
                }
              >
                删除
              </Button>
            </div>
            <div className="mt-2">
              <Field label="音量" hint={`${Math.round(character.voice.volume * 100)}%`}>
                <Slider
                  value={character.voice.volume}
                  min={0}
                  max={1}
                  onChange={(volume) =>
                    updateCharacter(
                      el.id,
                      (c) => {
                        if (c.voice) c.voice.volume = volume;
                      },
                      true,
                      `vol:${el.id}`,
                    )
                  }
                  label={`${Math.round(character.voice.volume * 100)}`}
                />
              </Field>
            </div>
          </div>
        ) : (
          <Button
            size="sm"
            variant="outline"
            icon="upload"
            className="w-full"
            disabled={binding}
            onClick={() => voiceInput.current?.click()}
          >
            {binding ? "上传中…" : "上传语音（MP3 / WAV / M4A / OGG）"}
          </Button>
        )}

        {audioAssets.length > 0 ? (
          <Field label="从素材库绑定">
            <Select
              value={character.voice?.id ?? ""}
              onChange={(e) => {
                const asset = audioAssets.find((a) => a.id === e.target.value);
                if (!asset) return;
                updateCharacter(el.id, (c) => {
                  c.voice = {
                    id: asset.id,
                    name: asset.name,
                    url: asset.url,
                    duration: asset.duration ?? 0,
                    volume: 1,
                  };
                });
              }}
            >
              <option value="">选择已上传的音频…</option>
              {audioAssets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.name} {asset.duration ? `(${asset.duration.toFixed(1)}s)` : ""}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        <Field label="默认台词" hint="点击人物时显示">
          <TextArea
            value={character.line}
            maxLength={280}
            placeholder="例如：兄弟们，这波真的不亏。"
            onChange={(e) =>
              updateCharacter(el.id, (c) => void (c.line = e.target.value), true, `line:${el.id}`)
            }
          />
        </Field>
      </Section>

      <Section title="气泡样式" defaultOpen={false}>
        <BubbleStyleEditor
          style={character.bubble}
          onChange={(patch) =>
            updateCharacter(
              el.id,
              (c) => {
                c.bubble = { ...c.bubble, ...patch };
              },
              true,
              `bubble:${el.id}:${Object.keys(patch).join(",")}`,
            )
          }
        />
      </Section>

      <Section title="特效" defaultOpen={false}>
        <Field label="白色贴纸描边" hint={`${character.effects.outline}px`}>
          <Slider
            value={character.effects.outline}
            min={0}
            max={10}
            step={1}
            label={`${character.effects.outline}`}
            onChange={(outline) =>
              updateCharacter(el.id, (c) => void (c.effects.outline = outline), true, `outline:${el.id}`)
            }
          />
        </Field>
        <Switch
          label="投影"
          checked={character.effects.shadow}
          onChange={(shadow) => updateCharacter(el.id, (c) => void (c.effects.shadow = shadow))}
        />
        <Switch
          label="荧光"
          checked={!!character.effects.glow}
          onChange={(value) =>
            updateCharacter(el.id, (c) => void (c.effects.glow = value ? "#b6ff3c" : null))
          }
        />
        {character.effects.glow ? (
          <ColorInput
            value={character.effects.glow}
            onChange={(glow) => updateCharacter(el.id, (c) => void (c.effects.glow = glow), true, `glow:${el.id}`)}
            label="荧光颜色"
          />
        ) : null}
      </Section>

      <Section title="位置与尺寸">
        <div className="grid grid-cols-2 gap-2">
          <Field label="X">
            <NumberInput
              value={el.x}
              onChange={(x) => updateElement(el.id, { x }, true, `x:${el.id}`)}
            />
          </Field>
          <Field label="Y">
            <NumberInput
              value={el.y}
              onChange={(y) => updateElement(el.id, { y }, true, `y:${el.id}`)}
            />
          </Field>
          <Field label="宽">
            <NumberInput
              value={el.width}
              min={20}
              onChange={(width) => updateElement(el.id, { width }, true, `w:${el.id}`)}
            />
          </Field>
          <Field label="高">
            <NumberInput
              value={el.height}
              min={20}
              onChange={(height) => updateElement(el.id, { height }, true, `h:${el.id}`)}
            />
          </Field>
          <Field label="旋转" hint="°">
            <NumberInput
              value={el.rotation}
              step={1}
              onChange={(rotation) => updateElement(el.id, { rotation }, true, `rot:${el.id}`)}
            />
          </Field>
          <Field label="透明度" hint={`${Math.round(el.opacity * 100)}%`}>
            <Slider
              value={el.opacity}
              min={0.05}
              max={1}
              onChange={(opacity) => updateElement(el.id, { opacity }, true, `op:${el.id}`)}
              label={`${Math.round(el.opacity * 100)}`}
            />
          </Field>
        </div>
      </Section>

      <Section title="图层与操作" defaultOpen={false}>
        <div className="grid grid-cols-4 gap-1">
          <Button size="sm" variant="secondary" onClick={() => moveLayer(el.id, "back")} title="置于底层">
            底
          </Button>
          <Button size="sm" variant="secondary" onClick={() => moveLayer(el.id, "down")} title="下移一层">
            ↓
          </Button>
          <Button size="sm" variant="secondary" onClick={() => moveLayer(el.id, "up")} title="上移一层">
            ↑
          </Button>
          <Button size="sm" variant="secondary" onClick={() => moveLayer(el.id, "front")} title="置于顶层">
            顶
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <Button size="sm" icon="copy" onClick={duplicate}>
            复制一份
          </Button>
          <Button size="sm" variant="danger" icon="trash" onClick={remove}>
            删除
          </Button>
        </div>
        <div className="text-[10px] leading-relaxed text-mute">
          画幅 {project.width}×{project.height} · 拖动人物可自由摆放，按住 Shift 多选，Alt 临时关闭吸附。
        </div>
      </Section>
    </PanelShell>
  );
}

function TextInspector({ el }: { el: CanvasElement }) {
  const updateElement = useEditor((s) => s.updateElement);
  const moveLayer = useEditor((s) => s.moveLayer);
  const duplicate = useEditor((s) => s.duplicateSelected);
  const remove = useEditor((s) => s.removeSelected);
  const text = el.text!;

  return (
    <PanelShell title="文字 / 气泡" subtitle={`${Math.round(el.width)} × ${Math.round(el.height)} · 图层 ${el.z}`}>
      <Section title="内容">
        <TextArea
          value={text.content}
          maxLength={280}
          onChange={(e) => {
            const content = e.target.value;
            updateElement(
              el.id,
              { text: { ...text, content } },
              true,
              `text:${el.id}`,
            );
          }}
          placeholder="输入台词…"
        />
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant="secondary"
            className="flex-1"
            onClick={() =>
              updateElement(el.id, {
                height: estimateTextHeight(text.content, el.width, text.style.fontSize, text.style.padding),
              })
            }
          >
            适应文字高度
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              const width = el.width;
              updateElement(el.id, {
                height: estimateTextHeight(text.content, width, text.style.fontSize, text.style.padding),
              });
            }}
          >
            重新排版
          </Button>
        </div>
      </Section>

      <Section title="样式">
        <BubbleStyleEditor
          style={text.style}
          onChange={(patch) =>
            updateElement(
              el.id,
              { text: { ...text, style: { ...text.style, ...patch } } },
              true,
              `tstyle:${el.id}:${Object.keys(patch).join(",")}`,
            )
          }
        />
        <Field label="展示时长" hint="秒">
          <NumberInput
            value={text.duration}
            min={0}
            max={30}
            step={0.1}
            onChange={(duration) => updateElement(el.id, { text: { ...text, duration } })}
          />
        </Field>
      </Section>

      <Section title="位置与尺寸">
        <div className="grid grid-cols-2 gap-2">
          <Field label="X">
            <NumberInput value={el.x} onChange={(x) => updateElement(el.id, { x }, true, `x:${el.id}`)} />
          </Field>
          <Field label="Y">
            <NumberInput value={el.y} onChange={(y) => updateElement(el.id, { y }, true, `y:${el.id}`)} />
          </Field>
          <Field label="宽">
            <NumberInput
              value={el.width}
              min={40}
              onChange={(width) => updateElement(el.id, { width }, true, `w:${el.id}`)}
            />
          </Field>
          <Field label="高">
            <NumberInput
              value={el.height}
              min={30}
              onChange={(height) => updateElement(el.id, { height }, true, `h:${el.id}`)}
            />
          </Field>
        </div>
        <Field label="旋转" hint="°">
          <NumberInput
            value={el.rotation}
            onChange={(rotation) => updateElement(el.id, { rotation }, true, `rot:${el.id}`)}
          />
        </Field>
      </Section>

      <Section title="图层与操作" defaultOpen={false}>
        <div className="grid grid-cols-4 gap-1">
          <Button size="sm" variant="secondary" onClick={() => moveLayer(el.id, "back")}>底</Button>
          <Button size="sm" variant="secondary" onClick={() => moveLayer(el.id, "down")}>↓</Button>
          <Button size="sm" variant="secondary" onClick={() => moveLayer(el.id, "up")}>↑</Button>
          <Button size="sm" variant="secondary" onClick={() => moveLayer(el.id, "front")}>顶</Button>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <Button size="sm" icon="copy" onClick={duplicate}>复制一份</Button>
          <Button size="sm" variant="danger" icon="trash" onClick={remove}>删除</Button>
        </div>
      </Section>
    </PanelShell>
  );
}

function MultiInspector({ elements }: { elements: CanvasElement[] }) {
  const align = useEditor((s) => s.alignSelection);
  const equalize = useEditor((s) => s.equalizeSelection);
  const duplicate = useEditor((s) => s.duplicateSelected);
  const remove = useEditor((s) => s.removeSelected);
  return (
    <PanelShell title={`已选中 ${elements.length} 个对象`} subtitle="批量移动、对齐、复制或删除">
      <Section title="对齐">
        <div className="grid grid-cols-3 gap-1">
          <Button size="sm" variant="secondary" onClick={() => align("left")}>左对齐</Button>
          <Button size="sm" variant="secondary" onClick={() => align("hcenter")}>水平居中</Button>
          <Button size="sm" variant="secondary" onClick={() => align("right")}>右对齐</Button>
          <Button size="sm" variant="secondary" onClick={() => align("top")}>顶部对齐</Button>
          <Button size="sm" variant="secondary" onClick={() => align("vcenter")}>垂直居中</Button>
          <Button size="sm" variant="secondary" onClick={() => align("bottom")}>底部对齐</Button>
        </div>
        <Button size="sm" variant="outline" className="w-full" onClick={equalize}>
          统一尺寸（以第一个为基准）
        </Button>
      </Section>
      <Section title="批量操作">
        <div className="grid grid-cols-2 gap-1.5">
          <Button size="sm" icon="copy" onClick={duplicate}>复制</Button>
          <Button size="sm" variant="danger" icon="trash" onClick={remove}>删除</Button>
        </div>
        <p className="text-[10px] leading-relaxed text-mute">
          拖动任意一个选中对象，其他对象会一起移动。按住 Shift 点击可增减选择。
        </p>
      </Section>
    </PanelShell>
  );
}
