import { BUBBLE_PRESETS } from "../../lib/defaults";
import type { BubbleStyle } from "../../lib/types";
import { ColorInput, Field, Select, Slider, cn } from "../ui";

const PRESET_LABELS: Record<string, string> = {
  comic: "漫画",
  plain: "纯色",
  thought: "思考",
  caption: "字幕",
  big: "大字",
};

const TAIL_LABELS: Record<string, string> = {
  none: "无",
  bottom: "下方",
  left: "左",
  right: "右",
};

const ANIM_LABELS: Record<string, string> = {
  pop: "弹出",
  bounce: "弹跳",
  fade: "淡入",
  none: "无",
};

export function BubbleStyleEditor({
  style,
  onChange,
}: {
  style: BubbleStyle;
  onChange: (patch: Partial<BubbleStyle>) => void;
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-1">
        {Object.keys(BUBBLE_PRESETS).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              const preset = BUBBLE_PRESETS[key];
              onChange({ ...preset, hold: style.hold });
            }}
            className={cn(
              "rounded-md border px-2 py-1 text-[10px] font-semibold transition-colors",
              style.preset === key
                ? "border-neon/60 bg-neon/15 text-neon"
                : "border-line bg-ink text-mute hover:text-paper",
            )}
          >
            {PRESET_LABELS[key] ?? key}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <Field label="底色">
          <ColorInput value={style.bg} onChange={(bg) => onChange({ bg })} label="气泡底色" />
        </Field>
        <Field label="文字">
          <ColorInput value={style.fg} onChange={(fg) => onChange({ fg })} label="文字颜色" />
        </Field>
        <Field label="描边">
          <ColorInput
            value={style.border}
            onChange={(border) => onChange({ border })}
            label="描边颜色"
          />
        </Field>
      </div>

      <Field label="字号" hint={`${Math.round(style.fontSize)}px`}>
        <Slider
          value={style.fontSize}
          min={12}
          max={96}
          step={1}
          label={`${Math.round(style.fontSize)}`}
          onChange={(fontSize) => onChange({ fontSize })}
        />
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="描边宽度" hint={`${style.borderWidth}px`}>
          <Slider
            value={style.borderWidth}
            min={0}
            max={10}
            step={1}
            label={`${style.borderWidth}`}
            onChange={(borderWidth) => onChange({ borderWidth })}
          />
        </Field>
        <Field label="圆角" hint={`${style.radius}px`}>
          <Slider
            value={style.radius}
            min={0}
            max={40}
            step={1}
            label={`${style.radius}`}
            onChange={(radius) => onChange({ radius })}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="停留" hint="秒">
          <Slider
            value={style.hold}
            min={0.5}
            max={8}
            step={0.1}
            label={`${style.hold.toFixed(1)}s`}
            onChange={(hold) => onChange({ hold })}
          />
        </Field>
        <Field label="动画">
          <Select value={style.animation} onChange={(e) => onChange({ animation: e.target.value as BubbleStyle["animation"] })}>
            {Object.entries(ANIM_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="尾巴方向">
          <Select value={style.tail} onChange={(e) => onChange({ tail: e.target.value as BubbleStyle["tail"] })}>
            {Object.entries(TAIL_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex items-end gap-1 pb-1">
          <button
            type="button"
            onClick={() => onChange({ bold: !style.bold })}
            className={cn(
              "h-8 flex-1 rounded-md border text-[12px] font-black transition-colors",
              style.bold ? "border-neon/50 bg-neon/15 text-neon" : "border-line text-mute",
            )}
          >
            B
          </button>
          <button
            type="button"
            onClick={() => onChange({ italic: !style.italic })}
            className={cn(
              "h-8 flex-1 rounded-md border font-serif text-[12px] italic transition-colors",
              style.italic ? "border-neon/50 bg-neon/15 text-neon" : "border-line text-mute",
            )}
          >
            I
          </button>
        </div>
      </div>
    </div>
  );
}
