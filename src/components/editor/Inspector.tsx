import { useEffect, useRef, useState } from "react";
import { useEditor } from "../../store/editor";
import { useAssets } from "../../store/assets";
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
import { RecordDialog } from "./RecordDialog";
import { CANVAS_PRESETS } from "../../lib/layout";
import type { CanvasElement, ProjectData } from "../../lib/types";
import { audioDuration, loadImage } from "../../lib/image";
import { audioEngine } from "../../lib/audio";
import { api } from "../../lib/api";
import { estimateTextHeight } from "../canvas/ElementNode";
import { canvasPresetFor } from "../../lib/export";
import { DEFAULT_BUBBLE_PLACEMENT, createText } from "../../lib/defaults";
import { AZURE_STYLE_LABELS, AZURE_VOICES, findAzureVoice } from "../../lib/azureVoices";
import {
  estimateSpeechSeconds,
  isDeviceSpeechSupported,
  listDeviceVoices,
} from "../../lib/deviceSpeech";
import type { BubblePlacement, VoiceClip } from "../../lib/types";

const BUBBLE_ANCHORS: { id: BubblePlacement["anchor"]; label: string }[] = [
  { id: "auto", label: "自动" },
  { id: "top", label: "上方" },
  { id: "bottom", label: "下方" },
  { id: "left", label: "左侧" },
  { id: "right", label: "右侧" },
];

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
  const placement = character.bubblePlacement ?? DEFAULT_BUBBLE_PLACEMENT;
  const updatePlacement = (patch: Partial<BubblePlacement>, key: string) =>
    updateCharacter(
      el.id,
      (c) => {
        c.bubblePlacement = { ...(c.bubblePlacement ?? DEFAULT_BUBBLE_PLACEMENT), ...patch };
      },
      true,
      `bubblepos:${el.id}:${key}`,
    );
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const voiceInput = useRef<HTMLInputElement | null>(null);
  const [binding, setBinding] = useState(false);
  const [ttsOpen, setTtsOpen] = useState(false);
  const [ttsText, setTtsText] = useState(character.line || "");
  const [ttsLang, setTtsLang] = useState("zh");
  const [ttsSpeed, setTtsSpeed] = useState(1);
  const [ttsBusy, setTtsBusy] = useState(false);
  const [ttsProvider, setTtsProvider] = useState<"melotts" | "azure" | "device">("melotts");
  const [azureVoiceId, setAzureVoiceId] = useState("zh-CN-XiaoxiaoNeural");
  const [azureStyle, setAzureStyle] = useState("general");
  const [ttsConfig, setTtsConfig] = useState<{ melotts: boolean; azure: boolean } | null>(null);
  const deviceSupported = isDeviceSpeechSupported();
  const [deviceVoices, setDeviceVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [deviceVoiceURI, setDeviceVoiceURI] = useState("");
  const [devicePitch, setDevicePitch] = useState(1);
  const [recordOpen, setRecordOpen] = useState(false);

  useEffect(() => {
    void api
      .ttsConfig()
      .then(setTtsConfig)
      .catch(() => setTtsConfig({ melotts: true, azure: false }));
  }, []);

  useEffect(() => {
    if (!deviceSupported) return;
    const synth = window.speechSynthesis;
    const load = () => {
      const voices = listDeviceVoices();
      setDeviceVoices(voices);
      setDeviceVoiceURI((current) => {
        if (current) return current;
        const preferred = voices.find((voice) => voice.lang.toLowerCase().startsWith("zh")) ?? voices[0];
        return preferred?.voiceURI ?? "";
      });
    };
    load();
    synth.addEventListener?.("voiceschanged", load);
    return () => synth.removeEventListener?.("voiceschanged", load);
  }, [deviceSupported]);

  useEffect(() => {
    void api
      .ttsConfig()
      .then(setTtsConfig)
      .catch(() => setTtsConfig({ melotts: true, azure: false }));
  }, []);

  const azureVoice = findAzureVoice(azureVoiceId);

  useEffect(() => {
    void loadAssets();
  }, [loadAssets]);

  const audioAssets = assets.filter((a) => a.kind === "audio");

  const appendClip = (clip: NonNullable<typeof character.voices>[number], history = false) => {
    updateCharacter(
      el.id,
      (c) => {
        if (c.voices.length >= 20) return;
        c.voices = [...c.voices, clip];
      },
      history,
    );
  };

  const uploadVoices = async (files: File[]) => {    if (files.length === 0) return;
    setBinding(true);
    let added = 0;
    try {
      for (const file of files) {
        const duration = await audioDuration(file);
        const asset = await api.uploadAsset(file, { kind: "audio", name: file.name, duration });
        appendClip({
          id: asset.id,
          name: file.name.replace(/\.[^.]+$/, "").slice(0, 40),
          url: asset.url,
          duration: asset.duration ?? duration,
          volume: 1,
          line: "",
        });
        added += 1;
      }
      toast(`已添加 ${added} 条语音，点人物会按顺序轮换`, "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "语音上传失败", "error");
    } finally {
      setBinding(false);
    }
  };

  const generateSpeech = async () => {
    const text = ttsText.trim();
    if (!text) {
      toast("先输入要朗读的文字", "info");
      return;
    }
    setTtsBusy(true);
    try {
      if (ttsProvider === "device") {
        const voice = deviceVoices.find((item) => item.voiceURI === deviceVoiceURI);
        const clip: VoiceClip = {
          id: `dev_${Math.random().toString(36).slice(2, 10)}`,
          name: `设备朗读 · ${text.slice(0, 12)}`,
          url: "",
          duration: estimateSpeechSeconds(text, ttsSpeed),
          volume: 1,
          line: text,
          source: "device",
          text,
          lang: voice?.lang ?? "zh-CN",
          rate: ttsSpeed,
          pitch: devicePitch,
          ...(voice ? { voiceURI: voice.voiceURI } : {}),
        };
        appendClip(clip, true);
        toast("已添加浏览器朗读语音（由访客设备发声）", "success");
        setPreviewingId(clip.id);
        await audioEngine.play(clip, "single");
        setPreviewingId((current) => (current === clip.id ? null : current));
        return;
      }

      const asset =
        ttsProvider === "azure"
          ? await api.tts({
              provider: "azure",
              text,
              voice: azureVoiceId,
              style: azureStyle,
              speed: ttsSpeed,
            })
          : await api.tts({ provider: "melotts", text, lang: ttsLang, speed: ttsSpeed });
      const clip: VoiceClip = {
        id: asset.id,
        name: asset.name,
        url: asset.url,
        duration: asset.duration ?? 0,
        volume: 1,
        line: text,
        source: "tts",
        lang: ttsProvider === "azure" ? azureVoice?.locale : ttsLang,
        // Azure bakes the speed into the audio; MeloTTS applies it at playback.
        ...(ttsProvider === "melotts" && ttsSpeed !== 1 ? { rate: ttsSpeed } : {}),
      };
      appendClip(clip, true);
      toast("语音已生成并添加，正在试听", "success");
      setPreviewingId(asset.id);
      await audioEngine.play(clip, "single");
      setPreviewingId((current) => (current === asset.id ? null : current));
    } catch (error) {
      toast(error instanceof Error ? error.message : "语音生成失败", "error");
    } finally {
      setTtsBusy(false);
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

      <Section
        title="声音"
        action={
          <span className="text-[9px] text-mute">
            {character.voices.length > 0 ? `${character.voices.length} 条` : "未绑定"}
          </span>
        }
      >
        <input
          ref={voiceInput}
          type="file"
          multiple
          accept="audio/mpeg,audio/wav,audio/x-wav,audio/ogg,audio/mp4,.mp3,.wav,.m4a,.ogg"
          className="hidden"
          onChange={(e) => {
            const files = e.target.files ? Array.from(e.target.files) : [];
            e.currentTarget.value = "";
            if (files.length) void uploadVoices(files);
          }}
        />

        {character.voices.length === 0 ? (
          <p className="rounded-md border border-dashed border-line px-2 py-2 text-[10px] leading-relaxed text-mute">
            还没有语音。一次可以上传多条，点击人物会按顺序换着播；每条都可以配自己的台词。
          </p>
        ) : (
          <div className="space-y-1.5">
            {character.voices.map((clip, index) => (
              <div key={clip.id} className="space-y-1.5 rounded-lg border border-line bg-ink p-2">
                <div className="flex items-center gap-1">
                  <span className="w-3 shrink-0 text-center text-[9px] tabular-nums text-mute">
                    {index + 1}
                  </span>
                  <TextInput
                    value={clip.name}
                    maxLength={40}
                    aria-label={`语音 ${index + 1} 名称`}
                    className="h-7 min-w-0 flex-1 text-[11px]"
                    onChange={(e) =>
                      updateCharacter(
                        el.id,
                        (c) => {
                          const target = c.voices.find((v) => v.id === clip.id);
                          if (target) target.name = e.target.value;
                        },
                        true,
                        `vname:${clip.id}`,
                      )
                    }
                  />
                  {clip.source === "tts" ? (
                    <span className="shrink-0 rounded bg-electric/20 px-1 text-[8px] font-semibold text-electric">
                      TTS
                    </span>
                  ) : clip.source === "device" ? (
                    <span className="shrink-0 rounded bg-neon/15 px-1 text-[8px] font-semibold text-neon">
                      设备
                    </span>
                  ) : clip.source === "record" ? (
                    <span className="shrink-0 rounded bg-hot/20 px-1 text-[8px] font-semibold text-hot">
                      录音
                    </span>
                  ) : null}
                  {clip.rate && clip.rate !== 1 ? (
                    <span className="shrink-0 text-[8px] text-mute">{clip.rate}x</span>
                  ) : null}
                  <span className="shrink-0 text-[9px] text-mute">{clip.duration.toFixed(1)}s</span>
                  <IconButton
                    icon={previewingId === clip.id ? "pause" : "play"}
                    label={previewingId === clip.id ? "停止试听" : "试听"}
                    size={12}
                    className="h-6 w-6"
                    onClick={async () => {
                      if (previewingId === clip.id) {
                        audioEngine.stop();
                        setPreviewingId(null);
                        return;
                      }
                      setPreviewingId(clip.id);
                      await audioEngine.play(clip, "single");
                      setPreviewingId((current) => (current === clip.id ? null : current));
                    }}
                  />
                  <IconButton
                    icon="trash"
                    label="删除这条语音"
                    size={12}
                    className="h-6 w-6 hover:text-hot"
                    onClick={() =>
                      updateCharacter(el.id, (c) => {
                        c.voices = c.voices.filter((v) => v.id !== clip.id);
                      })
                    }
                  />
                </div>
                <input
                  value={clip.line ?? ""}
                  maxLength={280}
                  placeholder="这段的台词（可选，播放时显示）"
                  aria-label={`语音 ${index + 1} 台词`}
                  className="h-7 w-full rounded border border-line bg-ink-2 px-1.5 text-[10.5px] text-paper outline-none focus:border-neon/50"
                  onChange={(e) =>
                    updateCharacter(
                      el.id,
                      (c) => {
                        const target = c.voices.find((v) => v.id === clip.id);
                        if (target) target.line = e.target.value;
                      },
                      true,
                      `vline:${clip.id}`,
                    )
                  }
                />
                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-mute">音量</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.02}
                    value={clip.volume}
                    aria-label={`语音 ${index + 1} 音量`}
                    className="h-1 w-full cursor-pointer appearance-none rounded-full bg-line"
                    onChange={(e) =>
                      updateCharacter(
                        el.id,
                        (c) => {
                          const target = c.voices.find((v) => v.id === clip.id);
                          if (target) target.volume = Number(e.target.value);
                        },
                        false,
                        `vvol:${clip.id}`,
                      )
                    }
                  />
                  <span className="w-7 shrink-0 text-right text-[9px] tabular-nums text-mute">
                    {Math.round(clip.volume * 100)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-1.5">
          <Button
            size="sm"
            variant="outline"
            icon="upload"
            disabled={binding || character.voices.length >= 20}
            onClick={() => voiceInput.current?.click()}
          >
            {binding ? "上传中…" : "添加音频"}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon="music"
            disabled={character.voices.length >= 20}
            onClick={() => setRecordOpen(true)}
          >
            录音
          </Button>
        </div>
        {character.voices.length >= 20 ? (
          <p className="text-[9px] text-mute">每个人物最多 20 条语音</p>
        ) : null}

        <Button
          size="sm"
          variant={ttsOpen ? "secondary" : "primary"}
          icon="sparkles"
          className="w-full"
          onClick={() => {
            if (!ttsOpen && !ttsText.trim()) setTtsText(character.line || "");
            setTtsOpen((open) => !open);
          }}
        >
          文字生成语音（不用录音）
        </Button>

        {ttsOpen ? (
          <div className="space-y-2 rounded-lg border border-electric/40 bg-electric/5 p-2">
            <TextArea
              value={ttsText}
              maxLength={300}
              onChange={(e) => setTtsText(e.target.value)}
              placeholder="输入这句台词，例如：兄弟们，这波真的不亏。"
              className="min-h-[64px] text-[12px]"
              aria-label="要朗读的文字"
            />
            <Field label="语音引擎">
              <Select
                value={ttsProvider}
                onChange={(e) =>
                  setTtsProvider(
                    e.target.value === "azure"
                      ? "azure"
                      : e.target.value === "device"
                        ? "device"
                        : "melotts",
                  )
                }
              >
                <option value="melotts">Cloudflare MeloTTS · 免费</option>
                <option value="azure" disabled={!ttsConfig?.azure}>
                  Microsoft Azure{ttsConfig?.azure ? " · 官方免费额度" : " · 未配置"}
                </option>
                <option value="device" disabled={!deviceSupported}>
                  浏览器自带{deviceSupported ? " · 免费" : " · 当前浏览器不支持"}
                </option>
              </Select>
            </Field>

            {ttsProvider === "azure" ? (
              <>
                <Field label="微软音色">
                  <Select
                    value={azureVoiceId}
                    onChange={(e) => {
                      setAzureVoiceId(e.target.value);
                      setAzureStyle("general");
                    }}
                  >
                    {AZURE_VOICES.map((voice) => (
                      <option key={voice.id} value={voice.id}>
                        {voice.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="情绪 / 风格">
                    <Select value={azureStyle} onChange={(e) => setAzureStyle(e.target.value)}>
                      {(azureVoice?.styles ?? ["general"]).map((style) => (
                        <option key={style} value={style}>
                          {AZURE_STYLE_LABELS[style] ?? style}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="语速">
                    <Select value={String(ttsSpeed)} onChange={(e) => setTtsSpeed(Number(e.target.value))}>
                      <option value="0.8">0.8x 慢</option>
                      <option value="1">1.0x 正常</option>
                      <option value="1.2">1.2x 快</option>
                      <option value="1.5">1.5x 很快</option>
                    </Select>
                  </Field>
                </div>
                <p className="text-[9px] leading-relaxed text-mute">
                  微软官方免费 F0：50 万字符/月。需要在 Pages 配置 AZURE_SPEECH_KEY / AZURE_SPEECH_REGION。
                </p>
              </>
            ) : ttsProvider === "device" ? (
              <>
                <Field label="系统音色" hint="取决于访客设备">
                  <Select value={deviceVoiceURI} onChange={(e) => setDeviceVoiceURI(e.target.value)}>
                    {deviceVoices.length === 0 ? <option value="">使用系统默认声音</option> : null}
                    {deviceVoices.map((voice) => (
                      <option key={voice.voiceURI} value={voice.voiceURI}>
                        {voice.name} ({voice.lang})
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="语速">
                    <Select value={String(ttsSpeed)} onChange={(e) => setTtsSpeed(Number(e.target.value))}>
                      <option value="0.8">0.8x 慢</option>
                      <option value="1">1.0x 正常</option>
                      <option value="1.2">1.2x 快</option>
                      <option value="1.5">1.5x 很快</option>
                    </Select>
                  </Field>
                  <Field label="音调">
                    <Select value={String(devicePitch)} onChange={(e) => setDevicePitch(Number(e.target.value))}>
                      <option value="0.8">0.8 低</option>
                      <option value="1">1.0 正常</option>
                      <option value="1.2">1.2 高</option>
                    </Select>
                  </Field>
                </div>
                <p className="text-[9px] leading-relaxed text-mute">
                  由访客浏览器朗读，完全免费、不占存储。音色会因手机/电脑不同而不同，适合“能听见就行”的场景。
                </p>
              </>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="语言 / 口音">
                    <Select value={ttsLang} onChange={(e) => setTtsLang(e.target.value)}>
                      <option value="zh">中文</option>
                      <option value="en">English</option>
                      <option value="jp">日本語</option>
                      <option value="kr">한국어</option>
                      <option value="fr">Français</option>
                      <option value="es">Español</option>
                    </Select>
                  </Field>
                  <Field label="语速">
                    <Select value={String(ttsSpeed)} onChange={(e) => setTtsSpeed(Number(e.target.value))}>
                      <option value="0.8">0.8x 慢</option>
                      <option value="1">1.0x 正常</option>
                      <option value="1.2">1.2x 快</option>
                      <option value="1.5">1.5x 很快</option>
                    </Select>
                  </Field>
                </div>
                <p className="text-[9px] leading-relaxed text-mute">
                  Cloudflare MeloTTS · 6 种语言 · 生成真实 WAV，所有访客听到的一致。
                </p>
              </>
            )}
            <div className="flex gap-1.5">
              <Button
                size="sm"
                variant="primary"
                icon="sparkles"
                className="flex-1"
                disabled={
                  ttsBusy ||
                  !ttsText.trim() ||
                  (ttsProvider === "azure" && !ttsConfig?.azure) ||
                  (ttsProvider === "device" && !deviceSupported)
                }
                onClick={() => void generateSpeech()}
              >
                {ttsBusy ? "生成中…" : "生成并添加"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setTtsOpen(false)}>
                收起
              </Button>
            </div>
            <p className="text-[9px] leading-relaxed text-mute">
              最多 300 字 · 文字会作为这段语音的台词 · 生成的是真实音频文件
            </p>
          </div>
        ) : null}

        <Field label="播放方式">
          <Select
            value={character.voiceMode}
            onChange={(e) =>
              updateCharacter(
                el.id,
                (c) => void (c.voiceMode = e.target.value === "random" ? "random" : "cycle"),
              )
            }
          >
            <option value="cycle">按顺序轮换（点一次换一条）</option>
            <option value="random">随机（尽量不重复上一条）</option>
          </Select>
        </Field>

        {audioAssets.length > 0 ? (
          <Field label="从素材库添加">
            <Select
              value=""
              onChange={(e) => {
                const asset = audioAssets.find((a) => a.id === e.target.value);
                if (!asset) return;
                appendClip(
                  {
                    id: `${asset.id}-${Math.random().toString(36).slice(2, 6)}`,
                    name: asset.name.replace(/\.[^.]+$/, "").slice(0, 40),
                    url: asset.url,
                    duration: asset.duration ?? 0,
                    volume: 1,
                    line: "",
                  },
                  true,
                );
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

        <Field label="默认台词" hint="当前语音没有单独台词时显示">
          <TextArea
            value={character.line}
            maxLength={280}
            placeholder="例如：兄弟们，这波真的不亏。"
            onChange={(e) =>
              updateCharacter(el.id, (c) => void (c.line = e.target.value), true, `line:${el.id}`)
            }
          />
        </Field>
        <Button
          size="sm"
          variant="outline"
          icon="text"
          className="w-full"
          onClick={() => {
            const content =
              character.line ||
              character.voices.find((clip) => clip.line?.trim())?.line ||
              "在这里输入台词";
            const width = Math.min(520, Math.max(240, placement.maxWidth));
            const textEl = createText({
              content,
              width,
              height: estimateTextHeight(content, width, character.bubble.fontSize, character.bubble.padding),
              x: Math.round(el.x + el.width / 2 - width / 2),
              y: Math.round(el.y - 24 - estimateTextHeight(content, width, character.bubble.fontSize, character.bubble.padding)),
              z: el.z + 1,
            });
            if (textEl.text) textEl.text.style = { ...character.bubble };
            useEditor.getState().addElements([textEl]);
            toast("已生成文字层，可以像人物一样自由拖动", "success");
          }}
        >
          把台词放到画布（可自由拖动）
        </Button>
      </Section>

      <Section title="气泡位置">
        <div className="flex flex-wrap gap-1">
          {BUBBLE_ANCHORS.map((anchor) => (
            <button
              key={anchor.id}
              type="button"
              onClick={() => updatePlacement({ anchor: anchor.id }, "anchor")}
              className={cn(
                "rounded-md border px-2 py-1 text-[10px] font-semibold transition-colors",
                placement.anchor === anchor.id
                  ? "border-neon/60 bg-neon/15 text-neon"
                  : "border-line bg-ink text-mute hover:text-paper",
              )}
            >
              {anchor.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="X 偏移" hint="画布像素">
            <NumberInput
              value={placement.offsetX}
              min={-3000}
              max={3000}
              step={10}
              onChange={(offsetX) => updatePlacement({ offsetX }, "x")}
            />
          </Field>
          <Field label="Y 偏移" hint="画布像素">
            <NumberInput
              value={placement.offsetY}
              min={-3000}
              max={3000}
              step={10}
              onChange={(offsetY) => updatePlacement({ offsetY }, "y")}
            />
          </Field>
        </div>
        <Field label="气泡最大宽度" hint={`${placement.maxWidth}px`}>
          <Slider
            value={placement.maxWidth}
            min={140}
            max={640}
            step={10}
            label={`${placement.maxWidth}`}
            onChange={(maxWidth) => updatePlacement({ maxWidth }, "w")}
          />
        </Field>
        <Button
          size="sm"
          variant="ghost"
          className="w-full"
          onClick={() => {
            updatePlacement({ anchor: "auto", offsetX: 0, offsetY: 0, maxWidth: 300 }, "reset");
            toast("气泡位置已重置", "info");
          }}
        >
          重置气泡位置
        </Button>
        <p className="rounded-md border border-electric/30 bg-electric/5 px-2 py-1.5 text-[10px] leading-relaxed text-paper">
          更直观的方式：点顶部「预览」，点一下人物让气泡出现，然后<b>直接拖动气泡</b>到想要的位置，松手即保存。
        </p>
      </Section>

      <Section title="气泡样式" defaultOpen={false}>        <BubbleStyleEditor
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

      {recordOpen ? (
        <RecordDialog
          onClose={() => setRecordOpen(false)}
          onSave={async ({ blob, duration, line }) => {
            const stamp = new Date().toLocaleTimeString("zh-CN", {
              hour: "2-digit",
              minute: "2-digit",
            });
            const name = `录音 · ${stamp}`;
            const file = new File([blob], `${name}.wav`, { type: "audio/wav" });
            const asset = await api.uploadAsset(file, { kind: "audio", name, duration });
            appendClip(
              {
                id: asset.id,
                name,
                url: asset.url,
                duration: asset.duration ?? duration,
                volume: 1,
                line,
                source: "record",
              },
              true,
            );
            toast("录音已保存到人物", "success");
          }}
        />
      ) : null}
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
