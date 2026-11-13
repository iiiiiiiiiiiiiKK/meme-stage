/**
 * Batch AI restyle.
 *
 * Deliberately a separate panel rather than another stage in the queue: generation
 * costs the user money, so it is explicit, counted, and cancellable, and it never
 * mutates the queue's own state machine. Results are saved as new variants, so the
 * local cutout stays untouched and recoverable.
 */
import { useCallback, useState } from "react";
import { Button, Field, Select, Spinner, cn, toast } from "../../components/ui";
import { Icon } from "../../components/Icon";
import { AiKeyPanel } from "./AiKeyPanel";
import { aiReady, useAiKey } from "./useAiKey";
import { downloadGenerated, restyleImage } from "./byok";
import { getVariantBlob, putVariant } from "./repository";
import { decodeToCanvas } from "./engine/image";
import { thumbnail } from "./processor";
import type { StickerVariant } from "./types";

const STYLES: { id: string; label: string; prompt: string }[] = [
  {
    id: "comic",
    label: "美式漫画",
    prompt:
      "restyle into a bold American comic sticker: flat cel shading, thick black ink outline, keep the exact same person, face, pose and clothing, no text",
  },
  {
    id: "retro",
    label: "复古印刷",
    prompt:
      "restyle into a retro screen-print sticker: limited palette, halftone texture, keep the exact same face, pose and clothing, no text",
  },
  {
    id: "mono",
    label: "黑白颗粒",
    prompt:
      "restyle into high-contrast black and white film sticker: grainy texture, keep the exact same person and pose, no text",
  },
  {
    id: "pixel",
    label: "像素艺术",
    prompt:
      "restyle into clean pixel art sticker: crisp square pixels, limited palette, keep the same character and pose, no text",
  },
  {
    id: "duotone",
    label: "双色调",
    prompt:
      "restyle into a two-tone sticker with a bold duotone palette, keep the same person and pose, no text",
  },
];

export function BatchAiPanel({
  variants,
  onDone,
}: {
  /** the finished local cutouts this batch produced */
  variants: StickerVariant[];
  onDone: () => void;
}) {
  const ai = useAiKey();
  const [style, setStyle] = useState(STYLES[0]!.id);
  const [confirmed, setConfirmed] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [failures, setFailures] = useState<string[]>([]);
  const [open, setOpen] = useState(false);

  const run = useCallback(async () => {
    if (!ai.key) {
      toast("先填入你自己的 AI 密钥", "info");
      return;
    }
    if (!confirmed) {
      toast("请先确认：会按图片数量产生真实费用", "info");
      return;
    }
    if (variants.length === 0) {
      toast("这批还没有可风格化的结果", "info");
      return;
    }
    const preset = STYLES.find((item) => item.id === style) ?? STYLES[0]!;
    setRunning(true);
    setFailures([]);
    let done = 0;
    const failed: string[] = [];
    for (const variant of variants) {
      setProgress({ done, total: variants.length });
      try {
        const stored = await getVariantBlob(variant.id);
        if (!stored) throw new Error("本机文件已不在");
        const result = await restyleImage({
          key: ai.key,
          file: stored.blob,
          prompt: preset.prompt,
          model: ai.model || undefined,
          size: "1024x1024",
        });
        const blob = await downloadGenerated(result.sourceUrl);
        const canvas = await decodeToCanvas(blob, 1024);
        const thumb = await thumbnail(canvas, 320);
        await putVariant({
          sourceId: variant.sourceId,
          maskId: variant.maskId,
          parentVariantId: variant.id,
          kind: "ai-style",
          name: `${variant.name.slice(0, 30)} · ${preset.label}`,
          width: canvas.width,
          height: canvas.height,
          mime: blob.type === "image/webp" ? "image/webp" : "image/png",
          outline: variant.outline,
          mode: variant.mode,
          warnings: [],
          blob,
          thumb,
        });
        done += 1;
      } catch (error) {
        failed.push(`${variant.name}: ${error instanceof Error ? error.message : "失败"}`);
      }
    }
    setProgress({ done, total: variants.length });
    setFailures(failed);
    setRunning(false);
    setConfirmed(false);
    onDone();
    if (failed.length === 0) toast(`已风格化 ${done} 张`, "success");
    else toast(`${done} 张成功，${failed.length} 张失败`, "error");
  }, [ai.key, ai.model, confirmed, onDone, style, variants]);

  const cost = variants.length;

  return (
    <div className="space-y-1.5">
      <AiKeyPanel compact />
      <div className="rounded border border-line/70 bg-ink px-2 py-1.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-1 text-[10px] font-semibold text-paper"
        >
          <Icon name="sparkles" size={10} /> 批量 AI 风格
          <span className="ml-auto text-[9px] font-normal text-mute">{open ? "收起" : "展开"}</span>
        </button>

        {open ? (
          <div className="mt-1.5 space-y-1.5">
            <Field label="风格">
              <Select
                value={style}
                aria-label="批量风格"
                className="h-7 text-[11px]"
                onChange={(e) => setStyle(e.target.value)}
              >
                {STYLES.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </Select>
            </Field>

            <p className="text-[9px] leading-relaxed text-amber-300">
              将对 {cost} 张已完成的贴纸逐个调用生成服务，费用计入你的账号。原抠图结果不会被覆盖，生成的是新版本。
            </p>

            <label className="flex items-start gap-1.5 text-[9px] leading-relaxed text-mute">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="mt-0.5 h-3 w-3 accent-[#b6ff3c]"
              />
              <span>我确认会产生 {cost} 次真实调用</span>
            </label>

            <Button
              size="sm"
              variant="secondary"
              icon="sparkles"
              className="w-full"
              disabled={running || !confirmed || !aiReady(ai) || cost === 0}
              onClick={() => void run()}
            >
              {running ? <Spinner size={11} /> : null}
              {running ? "风格化中…" : `风格化 ${cost} 张`}
            </Button>

            {progress ? (
              <div className={cn("text-[9px] text-mute")}>
                进度 {progress.done}/{progress.total}
              </div>
            ) : null}
            {failures.slice(0, 3).map((line) => (
              <div key={line} className="text-[9px] leading-relaxed text-hot">
                {line}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
