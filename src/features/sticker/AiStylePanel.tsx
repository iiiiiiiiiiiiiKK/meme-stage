/**
 * AI style panel.
 *
 * Deliberately opt-in and gated:
 *  - it renders nothing usable until the server reports a verified provider
 *  - it always states that the selected image will be sent to a third party
 *  - it shows the real usage numbers the provider returned, or says "unknown"
 *  - a failure never becomes a fake result: the original sticker stays untouched
 */
import { useCallback, useEffect, useState } from "react";
import { Button, Field, Select, Spinner, TextArea, cn, toast } from "../../components/ui";
import { Icon } from "../../components/Icon";
import { aiApi, usageSummary, type AiCapabilities } from "./ai";
import type { AssetRecord } from "../../lib/types";

const STYLE_PRESETS: { id: string; label: string; prompt: string }[] = [
  {
    id: "comic",
    label: "美式漫画",
    prompt:
      "restyle into a bold American comic sticker: flat cel shading, thick black ink outline, keep the exact same person, face, pose and clothing, transparent background, no text, no extra objects",
  },
  {
    id: "retro",
    label: "复古印刷",
    prompt:
      "restyle into a retro screen-print sticker: limited palette, halftone texture, keep the exact same face, pose and clothing, transparent background, no text",
  },
  {
    id: "pixel",
    label: "像素艺术",
    prompt:
      "restyle into clean pixel art sticker: crisp square pixels, limited palette, keep the same character and pose, transparent background, no text",
  },
  {
    id: "mono",
    label: "黑白颗粒",
    prompt:
      "restyle into high-contrast black and white film sticker: grainy texture, keep the exact same person and pose, transparent background, no text",
  },
  {
    id: "duotone",
    label: "双色调",
    prompt:
      "restyle into a two-tone sticker with a bold duotone palette, keep the same person and pose, transparent background, no text",
  },
];

export function AiStylePanel({
  variantId,
  variantName,
  sourceBlob,
  onResult,
}: {
  variantId: string;
  variantName: string;
  /** the sticker bytes to restyle; the original is never modified */
  sourceBlob: Blob | null;
  onResult: (asset: AssetRecord) => void;
}) {
  const [caps, setCaps] = useState<AiCapabilities | null>(null);
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState(STYLE_PRESETS[0].id);
  const [custom, setCustom] = useState("");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastUsage, setLastUsage] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    let alive = true;
    void aiApi
      .capabilities()
      .then((value) => {
        if (!alive) return;
        setCaps(value);
        if (value.models[0]) setModel((current) => current || value.models[0].id);
      })
      .catch(() => {
        if (alive) setCaps({ configured: false, models: [], sizes: [], reason: "无法读取图像服务状态" });
      });
    return () => {
      alive = false;
    };
  }, []);

  const run = useCallback(async () => {
    if (!sourceBlob) {
      toast("这张贴纸的本机文件已不在，无法转换", "error");
      return;
    }
    if (!confirmed) {
      toast("请先勾选确认，图像会发送给外部模型服务", "info");
      return;
    }
    const active = STYLE_PRESETS.find((item) => item.id === preset);
    const prompt = custom.trim() || active?.prompt || "";
    setBusy(true);
    setLastUsage(null);
    try {
      const result = await aiApi.edit({
        file: sourceBlob,
        name: variantName,
        prompt,
        model: model || undefined,
        size: "1024x1024",
        background: "transparent",
        idempotencyKey: `${variantId}:${Date.now()}`,
      });
      setLastUsage(usageSummary(result.usage));
      toast("风格版已生成，保存为独立版本", "success");
      onResult(result.asset);
    } catch (error) {
      toast(error instanceof Error ? error.message : "生成失败", "error");
    } finally {
      setBusy(false);
    }
  }, [confirmed, custom, model, onResult, preset, sourceBlob, variantId, variantName]);

  if (!caps) {
    return (
      <div className="flex items-center gap-1.5 text-[10px] text-mute">
        <Spinner size={10} /> 读取图像服务…
      </div>
    );
  }

  if (!caps.configured) {
    return (
      <div className="rounded border border-line/70 bg-ink px-2 py-1.5 text-[9.5px] leading-relaxed text-mute">
        <div className="mb-0.5 flex items-center gap-1 font-semibold text-paper">
          <Icon name="sparkles" size={10} /> AI 风格版（未启用）
        </div>
        {caps.reason ?? "服务端没有配置图像生成服务"}
        <div className="mt-1 text-[9px]">本机抠图与描边不受影响，可以继续使用。</div>
      </div>
    );
  }

  return (
    <div className="rounded border border-line/70 bg-ink px-2 py-1.5">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-1 text-[10px] font-semibold text-paper"
      >
        <Icon name="sparkles" size={10} /> AI 风格版
        <span className="ml-auto text-[9px] font-normal text-mute">{open ? "收起" : "展开"}</span>
      </button>

      {open ? (
        <div className="mt-1.5 space-y-1.5">
          <Field label="风格">
            <Select
              value={preset}
              aria-label="AI 风格"
              className="h-7 text-[11px]"
              onChange={(e) => setPreset(e.target.value)}
            >
              {STYLE_PRESETS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="模型">
            <Select
              value={model}
              aria-label="AI 模型"
              className="h-7 text-[11px]"
              onChange={(e) => setModel(e.target.value)}
            >
              {caps.models.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="自定义提示词（可选）">
            <TextArea
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="留空使用上面的风格预设"
              rows={2}
              className="text-[10.5px]"
            />
          </Field>

          <label className="flex items-start gap-1.5 text-[9px] leading-relaxed text-mute">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5 h-3 w-3 accent-[#b6ff3c]"
            />
            <span>
              我确认：当前贴纸会被发送到外部模型服务处理；生成结果另存为新版本，原图和本地抠图不会被覆盖。
            </span>
          </label>

          <Button
            size="sm"
            variant="secondary"
            icon="sparkles"
            className="w-full"
            disabled={busy || !confirmed}
            onClick={() => void run()}
          >
            {busy ? <Spinner size={11} /> : null}
            {busy ? "生成中…" : "生成风格版"}
          </Button>

          {lastUsage ? <div className="text-[9px] text-mute">用量：{lastUsage}</div> : null}
          {busy ? (
            <div className={cn("text-[9px] leading-relaxed text-mute")}>
              典型耗时 15–35 秒，期间请不要关闭页面。
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
