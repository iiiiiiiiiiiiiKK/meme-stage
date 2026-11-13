/**
 * Text-to-sticker panel (bring-your-own-key).
 *
 * The request goes straight from this browser to the image provider using the key
 * the user stored locally — no server-side key exists, so a visitor cannot spend the
 * owner's credit. Nothing is uploaded anywhere until the user chooses "保存到本机素材",
 * which writes to the local sticker library; "加入画布" later publishes it normally.
 */
import { useCallback, useEffect, useState } from "react";
import { Button, Field, Select, Spinner, TextArea, toast } from "../../components/ui";
import { Icon } from "../../components/Icon";
import { AiKeyPanel } from "./AiKeyPanel";
import { aiReady, useAiKey, useAiKeyStore } from "./useAiKey";
import { downloadGenerated, generateImage, hostImage, usageSummary } from "./byok";
import { decodeToCanvas } from "./engine/image";
import { putSource, putMask, putVariant } from "./repository";
import { thumbnail } from "./processor";
import { DEFAULT_OUTLINE, type StickerVariant } from "./types";

const PROMPT_PRESETS: { id: string; label: string; prompt: string }[] = [
  {
    id: "sticker",
    label: "表情贴纸",
    prompt:
      "a single cartoon sticker of a cheerful character head, bold black outline, flat colors, plain background, centered, no text",
  },
  {
    id: "prop",
    label: "道具物件",
    prompt:
      "a single cartoon sticker of a coffee cup, bold black outline, flat colors, plain background, centered, no text",
  },
  {
    id: "animal",
    label: "动物角色",
    prompt:
      "a single cartoon sticker of a smug cat, bold black outline, flat colors, plain background, centered, no text",
  },
  {
    id: "scene",
    label: "背景板",
    prompt: "a simple flat illustration background of a night city rooftop, comic style, no characters, no text",
  },
];

export function AiGeneratePanel({ onSaved }: { onSaved: (variant: StickerVariant) => void }) {
  const ai = useAiKey();
  const hydrate = useAiKeyStore((s) => s.hydrate);
  useEffect(() => {
    hydrate();
  }, [hydrate]);
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState(PROMPT_PRESETS[0].id);
  const [custom, setCustom] = useState("");
  // Transparency is opt-in: this gateway times out on `background:"transparent"`
  // (measured ~196s), and the normal path is generate-then-cut-out-locally.
  const [transparent, setTransparent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<string | null>(null);
  const [lastBlob, setLastBlob] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [hostUrl, setHostUrl] = useState<string | null>(null);
  const [hosting, setHosting] = useState(false);

  // Object URLs must be revoked or a long session leaks every preview.
  useEffect(() => {
    if (!lastBlob) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(lastBlob);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [lastBlob]);

  const generate = useCallback(async () => {
    const active = PROMPT_PRESETS.find((item) => item.id === preset);
    const prompt = custom.trim() || active?.prompt || "";
    if (!prompt) {
      toast("先写一点提示词", "info");
      return;
    }
    if (!ai.key) {
      toast("先设置你自己的 AI 密钥", "info");
      return;
    }
    setBusy(true);
    setUsage(null);
    try {
      const result = await generateImage({
        key: ai.key,
        prompt,
        model: ai.model || undefined,
        size: "1024x1024",
        background: transparent ? "transparent" : undefined,
      });
      setUsage(usageSummary(result.usage));
      const blob = await downloadGenerated(result.sourceUrl);
      setLastBlob(blob);
      toast("已生成，可以保存到本机素材", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "生成失败", "error");
    } finally {
      setBusy(false);
    }
  }, [ai.key, ai.model, custom, preset, transparent]);

  /**
   * Park the finished image on the imgbb host instead of in this app's storage.
   * Useful when the sticker is only needed as a link (or to keep R2/D1 small).
   */
  const hostNow = useCallback(async () => {
    if (!lastBlob) return;
    setHosting(true);
    try {
      const hosted = await hostImage(lastBlob);
      setHostUrl(hosted.url);
      toast("已上传图床，链接可直接使用", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "上传图床失败", "error");
    } finally {
      setHosting(false);
    }
  }, [lastBlob]);

  const saveLocally = useCallback(async () => {
    if (!lastBlob) return;
    const active = PROMPT_PRESETS.find((item) => item.id === preset);
    const name = `AI ${active?.label ?? "生成"}`;
    setBusy(true);
    try {
      const canvas = await decodeToCanvas(lastBlob, 1600);
      const source = await putSource({
        name: `${name}.png`,
        mime: lastBlob.type || "image/png",
        width: canvas.width,
        height: canvas.height,
        blob: lastBlob,
      });
      // A generated image has no person matte; a full alpha plane keeps the outline
      // and export path identical to a locally cut sticker.
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
        name: name.slice(0, 50),
        width: canvas.width,
        height: canvas.height,
        mime: lastBlob.type === "image/webp" ? "image/webp" : "image/png",
        outline: { ...DEFAULT_OUTLINE, thickness: 10, secondThickness: 4 },
        mode: "head",
        warnings: [],
        blob: lastBlob,
        thumb,
      });
      toast(`已存入本机素材：${variant.name}`, "success");
      onSaved(variant);
      setLastBlob(null);
    } catch (error) {
      toast(error instanceof Error ? error.message : "保存失败", "error");
    } finally {
      setBusy(false);
    }
  }, [lastBlob, onSaved, preset]);

  return (
    <div className="space-y-1.5">
      <AiKeyPanel compact />

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
            {!aiReady(ai) ? (
              <p className="text-[9px] leading-relaxed text-amber-300">
                需要先在上面填入你自己的密钥才能生成。
              </p>
            ) : null}

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
                value={ai.model}
                aria-label="生成模型"
                className="h-7 text-[11px]"
                onChange={(e) => ai.setModel(e.target.value)}
              >
                {(ai.models.length > 0 ? ai.models : ["gpt-image-2.5"]).map((id) => (
                  <option key={id} value={id}>
                    {id}
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
              让模型直接给透明背景（较慢，容易超时；一般不需要）
            </label>

            <Button
              size="sm"
              variant="secondary"
              icon="sparkles"
              className="w-full"
              disabled={busy || !aiReady(ai)}
              onClick={() => void generate()}
            >
              {busy ? <Spinner size={11} /> : null}
              {busy ? "生成中…" : "生成"}
            </Button>

            <p className="text-[9px] leading-relaxed text-mute">
              请求从你的浏览器直连图像服务，费用计入你的账号。典型 15–40 秒。
            </p>
            {usage ? <div className="text-[9px] text-mute">用量：{usage}</div> : null}

            {preview ? (
              <div className="space-y-1">
                <div className="checker overflow-hidden rounded border border-line bg-ink-3">
                  <img src={preview} alt="生成结果预览" className="h-32 w-full object-contain" />
                </div>
                <Button
                  size="sm"
                  variant="primary"
                  icon="check"
                  className="w-full"
                  disabled={busy}
                  onClick={() => void saveLocally()}
                >
                  保存到本机素材
                </Button>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    icon="upload"
                    className="flex-1"
                    disabled={hosting || busy}
                    onClick={() => void hostNow()}
                  >
                    {hosting ? <Spinner size={10} /> : null}
                    传到图床
                  </Button>
                </div>
                {hostUrl ? (
                  <div className="space-y-0.5 rounded border border-line/60 bg-ink-2 px-1.5 py-1 text-[9px]">
                    <a href={hostUrl} target="_blank" rel="noreferrer" className="block break-all text-neon underline">
                      {hostUrl}
                    </a>
                    <button
                      type="button"
                      className="text-mute hover:text-paper"
                      onClick={async () => {
                        await navigator.clipboard.writeText(hostUrl).catch(() => undefined);
                        toast("链接已复制", "info");
                      }}
                    >
                      复制链接
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
