import { useEffect, useState } from "react";
import { useEditor } from "../../store/editor";
import { api, absoluteUrl } from "../../lib/api";
import { composeCover, copyText, dataUrlToBlob } from "../../lib/export";
import { Button, Field, Modal, Spinner, Switch, TextArea, TextInput, toast } from "../ui";
import { Icon } from "../Icon";
import { persistNow } from "../../hooks/useAutosave";

export function PublishDialog({
  onClose,
  exportFrame,
}: {
  onClose: () => void;
  exportFrame: (targetWidth: number) => Promise<string>;
}) {
  const project = useEditor((s) => s.project);
  const projectId = useEditor((s) => s.projectId);
  const mutate = useEditor((s) => s.mutate);
  const [title, setTitle] = useState(project.title);
  const [description, setDescription] = useState(project.description);
  const [author, setAuthor] = useState(project.settings.authorName);
  const [cover, setCover] = useState<string | null>(null);
  const [coverError, setCoverError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [result, setResult] = useState<{ url: string; slug: string } | null>(null);
  const [wasPublished, setWasPublished] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const frame = await exportFrame(1200);
        const composed = await composeCover(frame, {
          title: title || "未命名作品",
          author,
        });
        if (alive) setCover(composed);
      } catch (error) {
        if (alive) setCoverError(error instanceof Error ? error.message : "封面生成失败");
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const publish = async () => {
    if (!title.trim()) {
      toast("先给作品起个名字", "info");
      return;
    }
    setPublishing(true);
    try {
      mutate((draft) => {
        draft.title = title.trim();
        draft.description = description.trim();
        draft.settings.authorName = author.trim();
      }, false);
      await persistNow(true);
      const id = useEditor.getState().projectId;
      if (!id) throw new Error("作品尚未同步到云端");
      const data = useEditor.getState().project;
      let coverDataUrl: string | undefined;
      if (cover) {
        try {
          const blob = await dataUrlToBlob(cover);
          if (blob.size < 1_500_000) {
            const reader = new FileReader();
            coverDataUrl = await new Promise<string>((resolve, reject) => {
              reader.onload = () => resolve(String(reader.result));
              reader.onerror = () => reject(new Error("封面读取失败"));
              reader.readAsDataURL(blob);
            });
          }
        } catch {
          coverDataUrl = undefined;
        }
      }
      const res = await api.publish(id, { data, coverDataUrl });
      setResult({ url: absoluteUrl(res.url), slug: res.slug });
      setWasPublished(true);
      useEditor.getState().markSaved(res.rev);
      toast("发布成功，链接已经可以分享", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "发布失败", "error");
    } finally {
      setPublishing(false);
    }
  };

  const unpublish = async () => {
    if (!projectId) return;
    if (!window.confirm("取消发布后，已分享的链接会立刻失效。确定吗？")) return;
    try {
      await api.unpublish(projectId);
      toast("已取消发布", "success");
      setResult(null);
      setWasPublished(false);
    } catch (error) {
      toast(error instanceof Error ? error.message : "操作失败", "error");
    }
  };

  const shareUrl = result?.url ?? "";

  return (
    <Modal
      title={result ? "已经上线" : "发布作品"}
      subtitle={
        result
          ? "把链接发到 X、微信群或任何地方，别人点开就能玩。"
          : "发布后生成一个公开链接，访客无需注册即可点击人物、听声音。"
      }
      onClose={onClose}
      wide
      footer={
        <div className="flex flex-wrap items-center gap-2">
          {result ? (
            <>
              <Button
                variant="primary"
                size="sm"
                icon="copy"
                onClick={async () => {
                  const ok = await copyText(shareUrl);
                  toast(ok ? "链接已复制" : "复制失败，请手动选择", ok ? "success" : "error");
                }}
              >
                复制链接
              </Button>
              <Button
                size="sm"
                icon="external"
                onClick={() =>
                  window.open(
                    `https://x.com/intent/tweet?text=${encodeURIComponent(`用 MEME STAGE 做了个会说话的梗图：${title}`)}&url=${encodeURIComponent(shareUrl)}`,
                    "_blank",
                    "noopener,noreferrer",
                  )
                }
              >
                分享到 X
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (navigator.share) {
                    void navigator.share({ title, text: "点开听听", url: shareUrl }).catch(() => undefined);
                  } else {
                    void copyText(shareUrl);
                    toast("链接已复制", "success");
                  }
                }}
              >
                系统分享
              </Button>
            </>
          ) : null}
          <div className="ml-auto flex gap-1.5">
            {wasPublished && !result ? (
              <Button size="sm" variant="danger" onClick={unpublish}>
                取消发布
              </Button>
            ) : null}
            {result ? (
              <Button size="sm" variant="secondary" onClick={onClose}>
                完成
              </Button>
            ) : (
              <>
                <Button size="sm" variant="ghost" onClick={onClose} disabled={publishing}>
                  取消
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  icon={publishing ? undefined : "bolt"}
                  disabled={publishing}
                  onClick={() => void publish()}
                >
                  {publishing ? (
                    <>
                      <Spinner size={13} /> 发布中…
                    </>
                  ) : (
                    "发布并获取链接"
                  )}
                </Button>
              </>
            )}
          </div>
        </div>
      }
    >
      {result ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-neon/40 bg-neon/5 p-3">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-neon">公开链接</div>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={shareUrl}
                className="min-w-0 flex-1 rounded-md border border-line bg-ink px-2 py-1.5 font-mono text-[11px] text-paper"
                onFocus={(e) => e.currentTarget.select()}
                aria-label="分享链接"
              />
              <Button
                size="sm"
                variant="secondary"
                icon="external"
                onClick={() => window.open(shareUrl, "_blank", "noopener,noreferrer")}
              >
                打开
              </Button>
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-mute">
              微信 / X 的链接预览会使用下面这张封面图。聊天软件里通常只能显示静态封面，真正的互动要点进链接。
            </p>
          </div>
          {cover ? (
            <img src={cover} alt="分享封面预览" className="w-full rounded-lg border border-line" />
          ) : null}
          <div className="grid grid-cols-2 gap-2 text-[11px] text-mute">
            <div className="rounded-md border border-line px-2 py-1.5">
              封面尺寸：1200 × 630（OG）
            </div>
            <div className="rounded-md border border-line px-2 py-1.5">
              链接 ID：<span className="font-mono">{result.slug}</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-[1fr_260px]">
          <div className="space-y-3">
            <Field label="作品标题" hint={`${title.length}/80`}>
              <TextInput
                value={title}
                maxLength={80}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例如：全员开麦：这波到底亏不亏"
              />
            </Field>
            <Field label="简介" hint={`${description.length}/600`}>
              <TextArea
                value={description}
                maxLength={600}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="这张图是什么梗？点谁会发生什么？"
              />
            </Field>
            <Field label="作者署名">
              <TextInput
                value={author}
                maxLength={40}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="@你的 X 账号"
              />
            </Field>

            <div className="space-y-1 rounded-lg border border-line bg-ink p-2">
              <Switch
                label="显示作者"
                checked={project.settings.showAuthor}
                onChange={(value) => mutate((draft) => void (draft.settings.showAuthor = value), false)}
              />
              <Switch
                label="允许访客 Remix"
                hint="别人可以复制一份继续改"
                checked={project.settings.allowRemix}
                onChange={(value) => mutate((draft) => void (draft.settings.allowRemix = value), false)}
              />
            </div>

            <div className="rounded-lg border border-line bg-ink p-2 text-[10px] leading-relaxed text-mute">
              <div className="mb-1 flex items-center gap-1 font-semibold text-paper">
                <Icon name="info" size={11} /> 发布前检查
              </div>
              访客页面会自动隐藏编辑工具栏；声音需要访客先点一下人物（浏览器禁止自动播放）。发布后仍可继续编辑并再次发布更新。
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-[10px] font-bold uppercase tracking-widest text-mute">分享封面</div>
            <div className="overflow-hidden rounded-lg border border-line bg-ink">
              {cover ? (
                <img src={cover} alt="分享封面预览" className="w-full" />
              ) : coverError ? (
                <div className="grid aspect-[1200/630] place-items-center p-3 text-center text-[10px] text-hot">
                  {coverError}
                </div>
              ) : (
                <div className="grid aspect-[1200/630] place-items-center">
                  <Spinner className="text-neon" />
                </div>
              )}
            </div>
            <p className="text-[10px] leading-relaxed text-mute">
              封面由当前画布自动生成，包含标题。重新发布会更新封面和内容。
            </p>
          </div>
        </div>
      )}
    </Modal>
  );
}
