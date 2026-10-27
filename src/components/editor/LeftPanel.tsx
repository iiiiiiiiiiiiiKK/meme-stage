import { useEffect, useMemo, useRef, useState } from "react";
import { useEditor } from "../../store/editor";
import { useAssets, uploadImagePair } from "../../store/assets";
import { Icon } from "../Icon";
import { Button, EmptyState, IconButton, TextInput, cn, toast } from "../ui";
import type { CanvasElement } from "../../lib/types";
import { audioEngine } from "../../lib/audio";
import { audioDuration, formatBytes, prepareImage } from "../../lib/image";
import { api } from "../../lib/api";
import { buildCharacterElement, buildDemoElement, buildText, placeSize } from "../../lib/characters";
import { DEMO_CHARACTERS } from "../../data/demoAssets";

type Tab = "characters" | "assets";

export function LeftPanel({ onOpenImport }: { onOpenImport: () => void }) {
  const [tab, setTab] = useState<Tab>("characters");
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  const [query, setQuery] = useState("");

  const characters = useMemo(
    () =>
      project.elements
        .filter((el) => el.type === "character")
        .sort((a, b) => b.z - a.z),
    [project.elements],
  );

  const filtered = characters.filter((el) =>
    (el.character?.name ?? "").toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-ink-2">
      <div className="flex shrink-0 border-b border-line">
        {(
          [
            { id: "characters" as Tab, label: "人物", icon: "users" as const, count: characters.length },
            { id: "assets" as Tab, label: "素材", icon: "image" as const, count: null },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={cn(
              "relative flex flex-1 items-center justify-center gap-1.5 py-2.5 text-[12px] font-semibold transition-colors",
              tab === item.id ? "text-paper" : "text-mute hover:text-paper",
            )}
          >
            <Icon name={item.icon} size={14} />
            {item.label}
            {item.count ? <span className="text-[10px] text-mute">{item.count}</span> : null}
            {tab === item.id ? <span className="absolute inset-x-3 bottom-0 h-0.5 bg-neon" /> : null}
          </button>
        ))}
      </div>

      {tab === "characters" ? (
        <>
          <div className="shrink-0 space-y-2 p-3">
            <Button variant="primary" size="sm" icon="plus" className="w-full" onClick={onOpenImport}>
              批量导入人物
            </Button>
            <div className="relative">
              <Icon
                name="search"
                size={13}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-mute"
              />
              <TextInput
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索人物"
                className="h-8 pl-7 text-[12px]"
                aria-label="搜索人物"
              />
            </div>
          </div>

          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {filtered.length === 0 ? (
              <EmptyState
                icon="users"
                title={characters.length === 0 ? "还没有人物" : "没有匹配的人物"}
                description={
                  characters.length === 0
                    ? "一次选 20 张图，全部丢进画布，再给每个人配一条声音。"
                    : "换个关键词试试。"
                }
                action={
                  characters.length === 0 ? (
                    <Button size="sm" variant="outline" icon="upload" onClick={onOpenImport}>
                      导入图片
                    </Button>
                  ) : null
                }
              />
            ) : (
              <ul className="space-y-0.5">
                {filtered.map((el) => (
                  <CharacterRow
                    key={el.id}
                    el={el}
                    selected={selection.includes(el.id)}
                  />
                ))}
              </ul>
            )}
          </div>

          <div className="shrink-0 border-t border-line p-2">
            <div className="grid grid-cols-2 gap-2">
              <Button
                size="sm"
                icon="text"
                onClick={() => {
                  const el = buildText(project, "在这里输入你的台词");
                  useEditor.getState().addElements([el]);
                }}
              >
                加文字
              </Button>
              <Button
                size="sm"
                icon="sparkles"
                onClick={() => {
                  const demo = DEMO_CHARACTERS[Math.floor(Math.random() * DEMO_CHARACTERS.length)];
                  const el = buildDemoElement(project, demo);
                  useEditor.getState().addElements([el]);
                  toast(`已加入「${demo.name}」，点它试试声音`, "success");
                }}
              >
                随机熟人
              </Button>
            </div>
          </div>
        </>
      ) : (
        <AssetsTab />
      )}
    </div>
  );
}

function CharacterRow({ el, selected }: { el: CanvasElement; selected: boolean }) {
  const character = el.character;
  const select = useEditor((s) => s.select);
  const focusElement = useEditor((s) => s.focusElement);
  const toggleHidden = useEditor((s) => s.toggleHidden);
  const toggleLock = useEditor((s) => s.toggleLock);
  if (!character) return null;
  return (
    <li>
      <div
        className={cn(
          "group flex cursor-pointer items-center gap-2 rounded-md border border-transparent px-1.5 py-1.5 transition-colors",
          selected ? "border-neon/40 bg-neon/10" : "hover:bg-white/5",
        )}
        onClick={(e) => {
          if (e.shiftKey) select(el.id, true);
          else focusElement(el.id);
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") focusElement(el.id);
        }}
      >
        <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-md border border-line bg-ink-3">
          <img
            src={character.thumbUrl || character.imageUrl}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
            draggable={false}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <span className="truncate text-[12px] font-semibold">{character.name || "未命名"}</span>
            {el.locked ? <Icon name="lock" size={10} className="shrink-0 text-mute" /> : null}
            {el.hidden ? <Icon name="eye-off" size={10} className="shrink-0 text-mute" /> : null}
          </div>
          <div className="flex items-center gap-1 text-[10px] text-mute">
            {character.voices.length > 0 ? (
              <>
                <Icon name="volume" size={9} className="text-neon" />
                <span className="truncate">
                  {character.voices.length} 条语音
                  {character.voiceMode === "random" ? " · 随机" : " · 轮换"}
                </span>
              </>
            ) : (
              <span className="text-mute/70">未配音 · 点开右侧添加</span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <IconButton
            icon={el.hidden ? "eye-off" : "eye"}
            label={el.hidden ? "显示" : "隐藏"}
            size={13}
            className="h-6 w-6"
            onClick={(e) => {
              e.stopPropagation();
              toggleHidden(el.id);
            }}
          />
          <IconButton
            icon={el.locked ? "lock" : "unlock"}
            label={el.locked ? "解锁" : "锁定"}
            size={13}
            className="h-6 w-6"
            onClick={(e) => {
              e.stopPropagation();
              toggleLock(el.id);
            }}
          />
        </div>
      </div>
    </li>
  );
}

function AssetsTab() {
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  const addElements = useEditor((s) => s.addElements);
  const updateCharacter = useEditor((s) => s.updateCharacter);
  const assets = useAssets((s) => s.items);
  const loadAssets = useAssets((s) => s.load);
  const addAsset = useAssets((s) => s.add);
  const removeAsset = useAssets((s) => s.remove);
  const [uploading, setUploading] = useState(false);
  const imageInput = useRef<HTMLInputElement | null>(null);
  const audioInput = useRef<HTMLInputElement | null>(null);

  const selectedCharacter = project.elements.find(
    (el) => el.id === selection[0] && el.type === "character",
  );

  useEffectOnce(() => {
    void loadAssets();
  });
  const uploadImages = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    let added = 0;
    for (const file of Array.from(files)) {
      try {
        if (!file.type.startsWith("image/")) {
          toast(`${file.name} 不是图片`, "error");
          continue;
        }
        const prepared = await prepareImage(file);
        const { url, thumbUrl, assetId, width, height } = await uploadImagePair(
          prepared.full,
          prepared.thumb,
          file.name,
          prepared.width,
          prepared.height,
        );
        const size = placeSize(project, width || prepared.width, height || prepared.height);
        const el = buildCharacterElement({
          project,
          name: file.name.replace(/\.[^.]+$/, "").slice(0, 20),
          imageUrl: url,
          thumbUrl,
          assetId,
          width: size.width,
          height: size.height,
        });
        addElements([el], false);
        added += 1;
        URL.revokeObjectURL(prepared.fullUrl);
        URL.revokeObjectURL(prepared.thumbUrl);
      } catch (error) {
        toast(error instanceof Error ? error.message : "上传失败", "error");
      }
    }
    setUploading(false);
    if (added > 0) toast(`已加入 ${added} 个人物`, "success");
  };

  const uploadAudio = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      try {
        if (!file.type.startsWith("audio/") && !/\.(mp3|wav|m4a|ogg)$/i.test(file.name)) {
          toast(`${file.name} 不是音频`, "error");
          continue;
        }
        const duration = await audioDuration(file);
        const asset = await api.uploadAsset(file, {
          kind: "audio",
          name: file.name,
          duration,
        });
        addAsset(asset);
        toast(`音频「${file.name}」已上传`, "success");
      } catch (error) {
        toast(error instanceof Error ? error.message : "音频上传失败", "error");
      }
    }
    setUploading(false);
  };

  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-3">
      <input
        ref={imageInput}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
        multiple
        className="hidden"
        onChange={(e) => {
          void uploadImages(e.target.files);
          e.currentTarget.value = "";
        }}
      />
      <input
        ref={audioInput}
        type="file"
        accept="audio/mpeg,audio/wav,audio/x-wav,audio/ogg,audio/mp4,.mp3,.wav,.m4a,.ogg"
        multiple
        className="hidden"
        onChange={(e) => {
          void uploadAudio(e.target.files);
          e.currentTarget.value = "";
        }}
      />

      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" icon="image" disabled={uploading} onClick={() => imageInput.current?.click()}>
          上传图片
        </Button>
        <Button size="sm" icon="music" disabled={uploading} onClick={() => audioInput.current?.click()}>
          上传音频
        </Button>
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[10px] font-bold uppercase tracking-[0.1em] text-mute">官方示例（原创素材）</h3>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {DEMO_CHARACTERS.map((demo) => (
            <button
              key={demo.id}
              type="button"
              onClick={() => {
                const el = buildDemoElement(project, demo);
                addElements([el]);
                toast(`已加入「${demo.name}」`, "success");
              }}
              className="group relative aspect-square overflow-hidden rounded-md border border-line bg-ink-3 transition-colors hover:border-neon/60"
              title={`加入 ${demo.name}（带语音）`}
            >
              <img
                src={demo.face}
                alt={demo.name}
                className="h-full w-full object-cover transition-transform group-hover:scale-105"
                loading="lazy"
              />
              <span className="absolute inset-x-0 bottom-0 bg-ink/85 py-0.5 text-center text-[9px] font-semibold">
                {demo.name}
              </span>
              {demo.voice ? (
                <Icon
                  name="volume"
                  size={10}
                  className="absolute right-1 top-1 text-neon drop-shadow"
                />
              ) : null}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <h3 className="mb-2 text-[10px] font-bold uppercase tracking-[0.1em] text-mute">我的素材</h3>
        {assets.length === 0 ? (
          <p className="rounded-md border border-dashed border-line px-2 py-3 text-center text-[10px] leading-relaxed text-mute">
            上传的图片和音频会出现在这里，可跨作品复用。
          </p>
        ) : (
          <ul className="space-y-1">
            {assets.map((asset) => (
              <li
                key={asset.id}
                className="flex items-center gap-2 rounded-md border border-line/60 bg-ink-3/60 p-1.5"
              >
                {asset.kind === "image" ? (
                  <img
                    src={asset.url}
                    alt=""
                    className="h-8 w-8 shrink-0 rounded border border-line object-cover"
                    loading="lazy"
                  />
                ) : (
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded border border-line bg-ink text-neon">
                    <Icon name="music" size={14} />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11px]">{asset.name}</div>
                  <div className="text-[9px] text-mute">
                    {formatBytes(asset.size)}
                    {asset.duration ? ` · ${asset.duration.toFixed(1)}s` : ""}
                  </div>
                </div>
                {asset.kind === "image" ? (
                  <IconButton
                    icon="plus"
                    label="加入画布"
                    size={14}
                    className="h-6 w-6"
                    onClick={() => {
                      const size = placeSize(project, asset.width ?? 600, asset.height ?? 800);
                      const el = buildCharacterElement({
                        project,
                        name: asset.name.replace(/\.[^.]+$/, "").slice(0, 20),
                        imageUrl: asset.url,
                        assetId: asset.id,
                        width: size.width,
                        height: size.height,
                      });
                      addElements([el]);
                    }}
                  />
                ) : (
                  <>
                    <IconButton
                      icon="play"
                      label="试听"
                      size={13}
                      className="h-6 w-6"
                      onClick={() => {
                        void audioEngine.preview(asset.url, 1, asset.name);
                      }}
                    />
                    <IconButton
                      icon="link"
                      label={selectedCharacter ? "添加到选中人物" : "先选中人物"}
                      size={13}
                      className="h-6 w-6"
                      onClick={() => {
                        if (!selectedCharacter) {
                          toast("先在画布或左侧列表里选中一个人物", "info");
                          return;
                        }
                        updateCharacter(selectedCharacter.id, (c) => {
                          if (c.voices.length >= 20) return;
                          c.voices = [
                            ...c.voices,
                            {
                              id: `${asset.id}-${Math.random().toString(36).slice(2, 6)}`,
                              name: asset.name,
                              url: asset.url,
                              duration: asset.duration ?? 0,
                              volume: 1,
                              line: "",
                            },
                          ];
                        });
                        toast(`已给 ${selectedCharacter.character?.name} 添加一条语音`, "success");
                      }}
                    />
                  </>
                )}
                <IconButton
                  icon="trash"
                  label="删除素材"
                  size={13}
                  className="h-6 w-6 hover:text-hot"
                  onClick={async () => {
                    if (!window.confirm(`删除素材「${asset.name}」？已引用它的作品会缺图。`)) return;
                    try {
                      await removeAsset(asset.id);
                      toast("素材已删除", "success");
                    } catch (error) {
                      toast(error instanceof Error ? error.message : "删除失败", "error");
                    }
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4 rounded-md border border-line bg-ink-3/60 p-2.5 text-[10px] leading-relaxed text-mute">
        <div className="mb-1 flex items-center gap-1 font-semibold text-paper">
          <Icon name="info" size={11} />
          关于素材
        </div>
        图片上传前会在浏览器里压缩成 WebP（长边 1500px），音频按原样存储。删除素材不会自动修复旧作品。
      </div>

      {selectedCharacter ? (
        <div className="mt-3 rounded-md border border-electric/40 bg-electric/10 px-2 py-1.5 text-[10px] text-paper">
          当前选中：{selectedCharacter.character?.name} —— 点音频右侧的链接图标即可绑定。
        </div>
      ) : null}
    </div>
  );
}

/** tiny effect helper to avoid an extra import in this file */
function useEffectOnce(fn: () => void) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(fn, []);
}
