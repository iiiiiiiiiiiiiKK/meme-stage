/**
 * Text-to-sticker panel.
 *
 * The only place a MEME STAGE byte leaves the browser on purpose. It is gated on
 * a verified server capability, states the cost model in plain words, and never
 * shows a placeholder when the provider fails.
 *
 * The generated image is stored server-side as a normal asset, then downloaded
 * once into the local sticker library so it can be cut, outlined and published
 * exactly like a locally-produced sticker.
 */
import { useCallback, useEffect, useState } from "react";
import { Button, Field, Select, Spinner, TextArea, cn, toast } from "../../components/ui";
import { Icon } from "../../components/Icon";
import { aiApi, usageSummary } from "./ai";
import { aiReady, useAiCapabilities } from "./useAiCapabilities";
import { decodeToCanvas } from "./engine/image";
import { putSource, putMask, putVariant } from "./repository";
import { thumbnail } from "./processor";
import { DEFAULT_OUTLINE, type StickerVariant } from "./types";

const PROMPT_PRESETS: { id: string; label: string; prompt: string }[] = [
  {
    id: "sticker",
    label: "表情贴纸",
    prompt: "a single cartoon sticker of a cheerful character head, bold black outline, flat colors, plain transparent background, centered, no text",
  },
  {
    id: "prop",
    label: "道具物件",
    prompt: "a single cartoon sticker of a coffee cup, bold black outline, flat colors, plain transparent background, centered, no text",
  },
  {
    id: "animal",
    label: "动物角色",
    prompt: "a single cartoon sticker of a smug cat, bold black outline, flat colors, plain transparent background, centered, no text",
  },
  {
    id: "scene",
    label: "背景板",
    prompt: "a simple flat illustration background of a night city rooftop, comic style, no characters, no text",
  },
];

export function AiGeneratePanel({
  onSaved,
}: {
  /** called after the result has been written into the local library */
  onSaved: (variant: StickerVariant) => void;
}) {
  const { caps, loading: capsLoading, canRetry, refresh: refreshCaps } = useAiCapabilities();
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState(PROMPT_PRESETS[0].id);
  const [custom, setCustom] = useState("");
  const [model, setModel] = useState("");
  // Measured against the live gateway: asking the model for a transparent
  // background reliably ends in a ~196s upstream timeout, while the same prompt
  // without it finishes in ~15s. Transparency is therefore opt-in, and the normal
  // path is: generate on a plain background, then cut it out locally (free, fast,
  // and far more accurate than asking the model).
  const [transparent, setTransparent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [lastAsset, setLastAsset] = useState<{ url: string; name: string } | null>(null);

  // Default the model picker once the probe reports what the account can use.
  useEffect(() => {
    const first = caps?.models[0]?.id;
    if (first) setModel((current) => current || first);
  }, [caps]);

  const previewUrl = lastAsset?.url ?? null;
  useEffect(() => {
    setPreview(previewUrl);
  }, [previewUrl]);

  const generate = useCallback(async () => {
    const active = PROMPT_PRESETS.find((item) => item.id === preset);
    const prompt = custom.trim() || active?.prompt || "";
    if (!prompt) {
      toast("先写一点提示词", "info");
      return;
    }
    setBusy(true);
    setUsage(null);
    try {
      const result = await aiApi.generate({
        prompt,
        model: model || undefined,
        size: "1024x1024",
        // Transparency is what makes it usable as a sticker; the server retries
        // without it when the gateway times out, so this is not a hard failure.
        background: transparent ? "transparent" : undefined,
        name: `AI ${active?.label ?? "生成"}`,
      });
      setUsage(usageSummary(result.usage));
      setLastAsset({ url: result.asset.url, name: result.asset.name });
      toast("已生成，可以直接保存到本机素材", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "生成失败", "error");
    } finally {
      setBusy(false);
    }
  }, [custom, model, preset, transparent]);

  const saveLocally = useCallback(async () => {
    if (!lastAsset) return;
    setBusy(true);
    try {
      const response = await fetch(lastAsset.url);
      if (!response.ok) throw new Error("无法读取生成的图片");
      const blob = await response.blob();
      const canvas = await decodeToCanvas(blob, 1600);
      const source = await putSource({
        name: `${lastAsset.name}.png`,
        mime: blob.type || "image/png",
        width: canvas.width,
        height: canvas.height,
        blob,
      });
      // A generated image has no person matte; the full alpha plane keeps the
      // outline and export path identical to a locally cut sticker.
      const alpha = new Uint8ClampedArray(canvas.width * canvas.height).fill(255);
      const mask = await putMask({
        sourceId: source.id,
        width: canvas.width,
        height: canvas.height,
        algorithm: "fallback",
        alpha,
        coverage: 1,
      });
      const thumb = await thumbnail(canvas, 320);
      const variant = await putVariant({
        sourceId: source.id,
        maskId: mask.id,
        kind: "ai-generate",
        name: lastAsset.name.slice(0, 50),
        width: canvas.width,
        height: canvas.height,
        mime: blob.type === "image/webp" ? "image/webp" : "image/png",
        outline: { ...DEFAULT_OUTLINE, thickness: 10, secondThickness: 4 },
        mode: "head",
        warnings: [],
        blob,
        thumb,
      });
      toast(`已存入本机素材：${variant.name}`, "success");
      onSaved(variant);
      setLastAsset(null);
    } catch (error) {
      toast(error instanceof Error ? error.message : "保存失败", "error");
    } finally {
      setBusy(false);
    }
  }, [lastAsset, onSaved]);

  if (!caps || (capsLoading && !caps)) {
    return (
      <div className="flex items-center gap-1.5 text-[10px] text-mute">
        <Spinner size={10} /> 读取图像服务…
      </div>
    );
  }

  // Configured but unusable: a revoked key, a rate-limited gateway or a network
  // hiccup. Say which, and offer a retry instead of looking permanently disabled.
  if (!aiReady(caps)) {
    const configured = caps.configured;
    return (
      <div className="rounded border border-line/70 bg-ink px-2 py-1.5 text-[9.5px] leading-relaxed text-mute">
        <div className="mb-0.5 flex items-center gap-1 font-semibold text-paper">
          <Icon name="sparkles" size={10} /> 文字生成贴纸（{configured ? "暂时不可用" : "未启用"}）
        </div>
        {caps.reason ?? (configured ? "图像服务暂时不可用" : "服务端没有配置图像生成服务")}
        {canRetry ? (
          <button
            type="button"
            onClick={refreshCaps}
            disabled={capsLoading}
            className="mt-1 rounded border border-line px-1.5 py-0.5 text-[9px] text-mute hover:text-paper disabled:opacity-50"
          >
            {capsLoading ? "检查中…" : "重新检查"}
          </button>
        ) : null}
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
        <Icon name="sparkles" size={10} /> 文字生成贴纸
        <span className="ml-auto text-[9px] font-normal text-mute">{open ? "收起" : "展开"}</span>
      </button>

      {open ? (
        <div className="mt-1.5 space-y-1.5">
          <Field label="题材">
            <Select
              value={preset}
              aria-label="生成题材"
              className="h-7 text-[11px]"
              onChange={(e) => setPreset(e.target.value)}
            >
              {PROMPT_PRESETS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="提示词（英文更准，可留空用预设）">
            <TextArea
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              rows={3}
              placeholder="例如：a cartoon cat wearing sunglasses, thick white outline"
              className="text-[10.5px]"
            />
          </Field>
          <Field label="模型">
            <Select
              value={model}
              aria-label="生成模型"
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
          <label className="flex items-center gap-1.5 text-[9.5px] text-mute">
            <input
              type="checkbox"
              checked={transparent}
              onChange={(e) => setTransparent(e.target.checked)}
              className="h-3 w-3 accent-[#b6ff3c]"
            />
            让模型直接给透明背景（较慢，容易超时；一般不需要，生成后本机抠图更准）
          </label>

          <Button
            size="sm"
            variant="secondary"
            icon="sparkles"
            className="w-full"
            disabled={busy}
            onClick={() => void generate()}
          >
            {busy ? <Spinner size={11} /> : null}
            {busy ? "生成中…" : "生成"}
          </Button>

          <p className="text-[9px] leading-relaxed text-mute">
            提示词会发送到外部模型服务，按 token 计费。典型 15–40 秒。
          </p>
          {usage ? <div className="text-[9px] text-mute">用量：{usage}</div> : null}

          {preview ? (
            <div className="space-y-1">
              <div className="checker overflow-hidden rounded border border-line bg-ink-3">
                {/* eslint-disable-next-line jsx-a11y/alt-text */}
                <img src={preview} alt="生成结果预览" className="h-32 w-full object-contain" />
              </div>
              <Button
                size="sm"
                variant="primary"
                icon="check"
                className={cn("w-full")}
                disabled={busy}
                onClick={() => void saveLocally()}
              >
                保存到本机素材
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
