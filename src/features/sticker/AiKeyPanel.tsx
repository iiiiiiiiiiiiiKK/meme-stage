/**
 * API key settings.
 *
 * Deliberately plain: paste, verify, and the key stays in this browser. There is no
 * server-side key any more, so this panel is the only way AI gets enabled — and it
 * is the place that explains who pays for what.
 */
import { useEffect, useState } from "react";
import { Button, Field, Spinner, TextInput, cn, toast } from "../../components/ui";
import { Icon } from "../../components/Icon";
import { aiReady, useAiKey, useAiKeyStore } from "./useAiKey";

export function AiKeyPanel({ compact = false }: { compact?: boolean }) {
  const ai = useAiKey();
  const hydrate = useAiKeyStore((s) => s.hydrate);
  const [draft, setDraft] = useState("");
  const [reveal, setReveal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(!ai.key);

  // Probe a previously stored key once, whoever mounts first.
  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const submit = async () => {
    if (!draft.trim()) {
      toast("先粘贴你的密钥", "info");
      return;
    }
    setSaving(true);
    const ok = await ai.setKey(draft);
    setSaving(false);
    if (ok && ai.verified !== false) {
      setDraft("");
      setOpen(false);
      toast("密钥已验证，可以开始生成", "success");
    }
  };

  if (compact && ai.key && aiReady(ai)) {
    return (
      <div className="flex items-center gap-1.5 rounded border border-line/70 bg-ink px-2 py-1 text-[9.5px] text-mute">
        <Icon name="check" size={10} className="text-neon" />
        使用你自己的密钥（{ai.models.length || "?"} 个模型可用）
        <button
          type="button"
          className="ml-auto underline decoration-dotted hover:text-paper"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "收起" : "更换"}
        </button>
      </div>
    );
  }

  return (
    <div className="rounded border border-line/70 bg-ink px-2 py-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1 text-[10px] font-semibold text-paper"
      >
        <Icon name="lock" size={10} /> 我的 AI 密钥
        {ai.key ? (
          <span className={cn("ml-1 text-[9px] font-normal", aiReady(ai) ? "text-neon" : "text-amber-300")}>
            {aiReady(ai) ? "已就绪" : "需要检查"}
          </span>
        ) : (
          <span className="ml-1 text-[9px] font-normal text-mute">未设置</span>
        )}
        <span className="ml-auto text-[9px] font-normal text-mute">{open ? "收起" : "展开"}</span>
      </button>

      {open ? (
        <div className="mt-1.5 space-y-1.5">
          <p className="text-[9px] leading-relaxed text-mute">
            密钥只保存在你自己的浏览器（localStorage），请求直接从你的浏览器发往图像服务，不经过本站服务器，也不会上传或写入任何数据库。费用由你的账号承担。
          </p>

          {ai.key ? (
            <div className="flex items-center gap-1 rounded border border-line/60 bg-ink-2 px-1.5 py-1 text-[10px]">
              <Icon name="lock" size={10} className="text-neon" />
              <span className="min-w-0 flex-1 truncate font-mono">
                {reveal ? ai.key : `${ai.key.slice(0, 6)}${"•".repeat(10)}${ai.key.slice(-4)}`}
              </span>
              <button
                type="button"
                className="shrink-0 text-[9px] text-mute hover:text-paper"
                onClick={() => setReveal((v) => !v)}
              >
                {reveal ? "隐藏" : "显示"}
              </button>
              <button
                type="button"
                className="shrink-0 text-[9px] text-mute hover:text-hot"
                onClick={() => {
                  ai.forget();
                  toast("已从本机删除密钥", "info");
                }}
              >
                删除
              </button>
            </div>
          ) : null}

          <Field label={ai.key ? "更换密钥" : "粘贴密钥"}>
            <div className="flex gap-1">
              <TextInput
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="sk-..."
                autoComplete="off"
                spellCheck={false}
                className="h-7 flex-1 font-mono text-[10.5px]"
                aria-label="AI 密钥"
              />
              <Button
                size="sm"
                variant="secondary"
                disabled={saving || !draft.trim()}
                onClick={() => void submit()}
              >
                {saving ? <Spinner size={11} /> : null}
                验证并保存
              </Button>
            </div>
          </Field>

          {ai.probing ? (
            <div className="flex items-center gap-1 text-[9px] text-mute">
              <Spinner size={10} /> 正在验证…
            </div>
          ) : null}

          {ai.error ? (
            <div className="text-[9px] leading-relaxed text-amber-300">
              {ai.error}
              {ai.retryable ? (
                <button
                  type="button"
                  onClick={ai.retry}
                  className="ml-1 rounded border border-line px-1 py-0.5 text-[9px] text-mute hover:text-paper"
                >
                  重试
                </button>
              ) : null}
            </div>
          ) : null}

          {ai.models.length > 0 ? (
            <div className="text-[9px] text-mute">可用模型：{ai.models.slice(0, 4).join(" / ")}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
