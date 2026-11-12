import { useState } from "react";
import { useEditor } from "../../store/editor";
import { Button, Field, TextInput, toast } from "../ui";
import { Icon } from "../Icon";
import {
  BUILTIN_TEMPLATES,
  applyTemplate,
  captureTemplate,
  readTemplates,
  writeTemplates,
  type Template,
} from "../../lib/templates";

/** 模板：把当前画布结构存成舞台，换一批图后一键复用 */
export function TemplatePanel() {
  const project = useEditor((s) => s.project);
  const [custom, setCustom] = useState<Template[]>(() => readTemplates());
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string>(BUILTIN_TEMPLATES[0].id);
  const all = [...BUILTIN_TEMPLATES, ...custom];
  const template = all.find((item) => item.id === selected) ?? all[0];

  const apply = (next: Template) => {
    const updated = applyTemplate(useEditor.getState().project, next, true);
    useEditor.setState({ project: updated, dirty: true });
    toast(`已套用「${next.name}」`, "success");
  };

  const save = () => {
    const tpl = captureTemplate(project, name || `模板 ${custom.length + 1}`);
    const list = [tpl, ...custom].slice(0, 20);
    writeTemplates(list);
    setCustom(list);
    setName("");
    setSelected(tpl.id);
    toast("已保存为模板，可在新作品里套用", "success");
  };

  const remove = (id: string) => {
    const list = custom.filter((item) => item.id !== id);
    writeTemplates(list);
    setCustom(list);
    if (selected === id) setSelected(BUILTIN_TEMPLATES[0].id);
  };

  return (
    <div className="flex h-full min-h-0">
      <div className="scroll-thin w-[250px] shrink-0 space-y-1.5 overflow-y-auto border-r border-line/60 p-2">
        <div className="text-[10px] font-bold uppercase tracking-widest text-mute">套用模板</div>
        <div className="space-y-1">
          {all.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelected(item.id)}
              className={`flex w-full items-center gap-1.5 rounded border px-2 py-1.5 text-left text-[11px] ${
                selected === item.id
                  ? "border-neon/60 bg-neon/10 text-paper"
                  : "border-line text-mute hover:text-paper"
              }`}
            >
              <Icon name={item.createdAt === 0 ? "sparkles" : "copy"} size={11} />
              <span className="min-w-0 flex-1 truncate">{item.name}</span>
              <span className="shrink-0 text-[9px] tabular-nums">
                {item.settings.width}×{item.settings.height}
              </span>
            </button>
          ))}
        </div>

        <div className="mt-2 rounded border border-line/60 bg-ink/60 p-2 text-[9.5px] leading-relaxed text-mute">
          模板只保存画幅、背景、气泡、音量模式和人物高度，不包含图片、语音和作品状态。套用不会删除任何人物。
        </div>

        <Field label="保存当前为模板">
          <div className="flex gap-1">
            <TextInput
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="模板名称"
              className="h-7 text-[11px]"
              aria-label="模板名称"
            />
            <Button size="sm" variant="secondary" onClick={save}>
              保存
            </Button>
          </div>
        </Field>
      </div>

      <div className="min-w-0 flex-1 p-3">
        {template ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="font-display text-[15px]">{template.name}</div>
              {template.createdAt === 0 ? (
                <span className="rounded bg-ink-3 px-1.5 py-0.5 text-[9px] text-mute">内置</span>
              ) : (
                <span className="rounded bg-electric/20 px-1.5 py-0.5 text-[9px] text-electric">自建</span>
              )}
              <div className="ml-auto flex gap-1">
                <Button size="sm" variant="primary" icon="check" onClick={() => apply(template)}>
                  套用到当前作品
                </Button>
                {template.createdAt > 0 ? (
                  <Button size="sm" variant="ghost" onClick={() => remove(template.id)}>
                    删除模板
                  </Button>
                ) : null}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[10px] sm:grid-cols-3">
              <Info label="画幅" value={`${template.settings.width} × ${template.settings.height}`} />
              <Info label="背景" value={template.settings.background.type === "image" ? "图片" : template.settings.background.color} />
              <Info label="声音" value={template.settings.audioMode === "mix" ? "混音" : "单音频"} />
              <Info label="人物高度" value={`${template.settings.characterHeight}px`} />
              <Info label="气泡" value={template.settings.bubble.preset} />
              <Info label="排布建议" value={template.settings.layoutMode} />
            </div>
            <div className="rounded border border-line/60 bg-ink/60 p-2 text-[10px] leading-relaxed text-mute">
              套用后会按比例把每个人物的高度统一为 {template.settings.characterHeight}px，并统一气泡样式；
              位置、语音、台词和互动都保持不变。
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-line/60 bg-ink/60 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wide text-mute">{label}</div>
      <div className="mt-0.5 truncate text-[11px] text-paper">{value}</div>
    </div>
  );
}
