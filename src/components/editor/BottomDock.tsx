import { useMemo, useState } from "react";
import { useEditor } from "../../store/editor";
import { Icon } from "../Icon";
import { Button, IconButton, Select, TextInput, cn } from "../ui";
import type { AnimationName, CanvasElement, EventDef, Step, StepType } from "../../lib/types";
import { ANIMATIONS, STEP_TYPES, makeStep } from "../../lib/defaults";

type Tab = "layers" | "events";

export function BottomDock({ onTest }: { onTest: (triggerId: string) => void }) {
  const [tab, setTab] = useState<Tab>("events");
  const [open, setOpen] = useState(true);
  const project = useEditor((s) => s.project);
  const events = project.events;
  const characters = useMemo(
    () => project.elements.filter((el) => el.type === "character"),
    [project.elements],
  );

  return (
    <div className={cn("z-20 shrink-0 border-t border-line bg-ink-2", open ? "h-[248px]" : "h-10")}>
      <div className="flex h-10 items-center gap-1 border-b border-line/60 px-2">
        <button
          type="button"
          className="mr-1 grid h-6 w-6 place-items-center rounded text-mute hover:bg-white/5 hover:text-paper"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "收起面板" : "展开面板"}
        >
          <Icon name={open ? "chevron-down" : "chevron-up"} size={15} />
        </button>
        <TabButton active={tab === "events"} onClick={() => setTab("events")} icon="workflow">
          互动编排
          <span className="ml-1 rounded bg-ink px-1 text-[9px] text-mute">{events.length}</span>
        </TabButton>
        <TabButton active={tab === "layers"} onClick={() => setTab("layers")} icon="layers">
          图层
          <span className="ml-1 rounded bg-ink px-1 text-[9px] text-mute">{project.elements.length}</span>
        </TabButton>
        <div className="ml-auto hidden items-center gap-2 text-[10px] text-mute sm:flex">
          <span className="flex items-center gap-1">
            <Icon name="info" size={11} />
            事件按顺序执行，可勾选「同时」让气泡和声音一起出现
          </span>
        </div>
      </div>
      {open ? (
        <div className="h-[208px] min-h-0">
          {tab === "layers" ? (
            <LayersList />
          ) : (
            <EventsPanel onTest={onTest} characters={characters} />
          )}
        </div>
      ) : null}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: "workflow" | "layers";
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-semibold transition-colors",
        active ? "bg-ink text-paper" : "text-mute hover:text-paper",
      )}
    >
      <Icon name={icon} size={13} />
      {children}
    </button>
  );
}

function LayersList() {
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  const focusElement = useEditor((s) => s.focusElement);
  const toggleHidden = useEditor((s) => s.toggleHidden);
  const toggleLock = useEditor((s) => s.toggleLock);
  const moveLayer = useEditor((s) => s.moveLayer);

  const sorted = [...project.elements].sort((a, b) => b.z - a.z);

  if (sorted.length === 0) {
    return <div className="grid h-full place-items-center text-[11px] text-mute">画布还是空的，先导入人物吧。</div>;
  }

  return (
    <div className="scroll-thin flex h-full gap-1.5 overflow-x-auto overflow-y-hidden p-2">
      {sorted.map((el) => {
        const name =
          el.type === "character" ? el.character?.name : el.type === "text" ? el.text?.content : el.image?.name;
        const thumb =
          el.type === "character"
            ? el.character?.thumbUrl || el.character?.imageUrl
            : el.type === "image"
              ? el.image?.thumbUrl || el.image?.url
              : null;
        return (
          <div
            key={el.id}
            className={cn(
              "group flex w-[152px] shrink-0 flex-col rounded-md border p-1.5 transition-colors",
              selection.includes(el.id) ? "border-neon/50 bg-neon/5" : "border-line bg-ink hover:border-paper/25",
            )}
          >
            <button
              type="button"
              onClick={() => focusElement(el.id)}
              className="flex items-center gap-1.5 text-left"
            >
              <span className="grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded border border-line bg-ink-3">
                {thumb ? (
                  <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <Icon name="text" size={12} className="text-mute" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[10.5px] font-semibold">{name || "未命名"}</span>
                <span className="block text-[9px] text-mute">图层 {el.z}</span>
              </span>
            </button>
            <div className="mt-1 flex items-center gap-0.5">
              <IconButton
                icon={el.hidden ? "eye-off" : "eye"}
                label={el.hidden ? "显示" : "隐藏"}
                size={12}
                className="h-5 w-5"
                onClick={() => toggleHidden(el.id)}
              />
              <IconButton
                icon={el.locked ? "lock" : "unlock"}
                label={el.locked ? "解锁" : "锁定"}
                size={12}
                className="h-5 w-5"
                onClick={() => toggleLock(el.id)}
              />
              <div className="ml-auto flex">
                <IconButton
                  icon="chevron-up"
                  label="上移一层"
                  size={12}
                  className="h-5 w-5"
                  onClick={() => moveLayer(el.id, "up")}
                />
                <IconButton
                  icon="chevron-down"
                  label="下移一层"
                  size={12}
                  className="h-5 w-5"
                  onClick={() => moveLayer(el.id, "down")}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EventsPanel({
  onTest,
  characters,
}: {
  onTest: (triggerId: string) => void;
  characters: CanvasElement[];
}) {
  const project = useEditor((s) => s.project);
  const addEvent = useEditor((s) => s.addEvent);
  const updateEvent = useEditor((s) => s.updateEvent);
  const removeEvent = useEditor((s) => s.removeEvent);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const list = project.elements.filter((el) => el.type === "character");
  const chars = characters;
  const selected = project.events.find((e) => e.id === selectedId) ?? project.events[0] ?? null;

  const createEvent = () => {
    if (list.length === 0) return;
    const trigger = list[0];
    const event: EventDef = {
      id: `ev_${Math.random().toString(36).slice(2, 10)}`,
      name: `${trigger.character?.name ?? "人物"} 的互动`,
      triggerId: trigger.id,
      steps: [
        {
          ...makeStep("say", trigger.id),
          text: trigger.character?.line || "说点什么…",
          ms: 2600,
          parallel: true,
        },
        {
          ...makeStep("playAudio", trigger.id),
          parallel: false,
        },
      ],
      nextEventId: null,
      enabled: true,
    };
    addEvent(event);
    setSelectedId(event.id);
  };

  return (
    <div className="flex h-full min-h-0">
      <div className="scroll-thin flex w-[196px] shrink-0 flex-col border-r border-line/60">
        <div className="p-1.5">
          <Button size="sm" variant="primary" icon="plus" className="w-full" onClick={createEvent} disabled={list.length === 0}>
            新建互动
          </Button>
        </div>
        <div className="scroll-thin min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1.5 pb-2">
          {project.events.length === 0 ? (
            <p className="px-1 py-3 text-[10px] leading-relaxed text-mute">
              还没有互动。点「新建互动」，设置「点谁 → 做什么」。
            </p>
          ) : (
            project.events.map((ev) => {
              const trigger = project.elements.find((el) => el.id === ev.triggerId);
              return (
                <button
                  key={ev.id}
                  type="button"
                  onClick={() => setSelectedId(ev.id)}
                  className={cn(
                    "w-full rounded-md border px-2 py-1.5 text-left transition-colors",
                    selected?.id === ev.id
                      ? "border-neon/50 bg-neon/5"
                      : "border-transparent hover:bg-white/5",
                  )}
                >
                  <div className="truncate text-[11px] font-semibold">{ev.name}</div>
                  <div className="mt-0.5 flex items-center gap-1 text-[9px] text-mute">
                    <span className="truncate">点击：{trigger?.character?.name ?? "已删除"}</span>
                    {ev.enabled ? null : <span className="text-hot">已停用</span>}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      <div className="scroll-thin min-w-0 flex-1 overflow-y-auto p-2">
        {selected ? (
          <EventEditor
            key={selected.id}
            event={selected}
            characters={chars}
            onTest={() => onTest(selected.triggerId)}
            onDelete={() => {
              removeEvent(selected.id);
              setSelectedId(null);
            }}
            onUpdate={(patch) => updateEvent(selected.id, patch)}
          />
        ) : (
          <div className="grid h-full place-items-center text-[11px] text-mute">
            选择左侧的互动，或新建一条。
          </div>
        )}
      </div>
    </div>
  );
}

function EventEditor({
  event,
  characters,
  onUpdate,
  onDelete,
  onTest,
}: {
  event: EventDef;
  characters: CanvasElement[];
  onUpdate: (patch: Partial<EventDef>) => void;
  onDelete: () => void;
  onTest: () => void;
}) {
  const events = useEditor((s) => s.project.events);
  const [addType, setAddType] = useState<StepType>("playAudio");

  const updateStep = (index: number, patch: Partial<Step>) => {
    const steps = event.steps.map((step, i) => (i === index ? { ...step, ...patch } : step));
    onUpdate({ steps });
  };
  const removeStep = (index: number) => onUpdate({ steps: event.steps.filter((_, i) => i !== index) });
  const moveStep = (index: number, delta: number) => {
    const next = [...event.steps];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onUpdate({ steps: next });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-1.5">
        <label className="min-w-[160px] flex-1">
          <span className="mb-0.5 block text-[9px] font-semibold uppercase tracking-wider text-mute">名称</span>
          <TextInput
            value={event.name}
            onChange={(e) => onUpdate({ name: e.target.value })}
            className="h-8 text-[12px]"
          />
        </label>
        <label className="w-[150px]">
          <span className="mb-0.5 block text-[9px] font-semibold uppercase tracking-wider text-mute">点击谁</span>
          <Select
            value={event.triggerId}
            onChange={(e) => onUpdate({ triggerId: e.target.value })}
            className="h-8 text-[12px]"
          >
            {characters.map((el) => (
              <option key={el.id} value={el.id}>
                {el.character?.name ?? el.id}
              </option>
            ))}
          </Select>
        </label>
        <label className="w-[150px]">
          <span className="mb-0.5 block text-[9px] font-semibold uppercase tracking-wider text-mute">接着执行</span>
          <Select
            value={event.nextEventId ?? ""}
            onChange={(e) => onUpdate({ nextEventId: e.target.value || null })}
            className="h-8 text-[12px]"
          >
            <option value="">不继续</option>
            {events
              .filter((ev) => ev.id !== event.id)
              .map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.name}
                </option>
              ))}
          </Select>
        </label>
        <label className="flex h-8 items-center gap-1.5 rounded-md border border-line px-2 text-[11px]">
          <input
            type="checkbox"
            checked={event.enabled}
            onChange={(e) => onUpdate({ enabled: e.target.checked })}
            className="accent-[#b6ff3c]"
          />
          启用
        </label>
        <Button size="sm" variant="secondary" icon="play" onClick={onTest}>
          测试
        </Button>
        <Button size="sm" variant="danger" icon="trash" onClick={onDelete}>
          删除
        </Button>
      </div>

      <div className="space-y-1">
        {event.steps.map((step, index) => (
          <StepRow
            key={step.id}
            step={step}
            index={index}
            total={event.steps.length}
            characters={characters}
            events={events}
            onChange={(patch) => updateStep(index, patch)}
            onRemove={() => removeStep(index)}
            onMove={(delta) => moveStep(index, delta)}
          />
        ))}
        {event.steps.length === 0 ? (
          <div className="rounded-md border border-dashed border-line px-3 py-3 text-center text-[10px] text-mute">
            这条互动还没有动作，添加一个「播放语音」开始。
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-1.5">
        <Select
          value={addType}
          onChange={(e) => setAddType(e.target.value as StepType)}
          className="h-8 w-[150px] text-[11px]"
        >
          {STEP_TYPES.map((item) => (
            <option key={item.type} value={item.type}>
              {item.label}
            </option>
          ))}
        </Select>
        <Button
          size="sm"
          icon="plus"
          onClick={() => {
            const target = stepTargetDefault(addType, event.triggerId);
            const step = makeStep(addType, target);
            if (addType === "goto") step.eventId = events.find((ev) => ev.id !== event.id)?.id;
            if (addType === "playAudio" || addType === "say" || addType === "animate") step.parallel = true;
            onUpdate({ steps: [...event.steps, step] });
          }}
        >
          添加动作
        </Button>
        <span className="text-[9px] text-mute">
          {STEP_TYPES.find((item) => item.type === addType)?.hint}
        </span>
      </div>
    </div>
  );
}

function stepTargetDefault(type: StepType, triggerId: string): string | undefined {
  if (type === "flash") return undefined;
  return triggerId;
}

function StepRow({
  step,
  index,
  total,
  characters,
  events,
  onChange,
  onRemove,
  onMove,
}: {
  step: Step;
  index: number;
  total: number;
  characters: CanvasElement[];
  events: EventDef[];
  onChange: (patch: Partial<Step>) => void;
  onRemove: () => void;
  onMove: (delta: number) => void;
}) {
  const label = STEP_TYPES.find((item) => item.type === step.type)?.label ?? step.type;
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-md border border-line/70 bg-ink px-1.5 py-1">
      <span className="w-6 shrink-0 text-center text-[9px] tabular-nums text-mute">{index + 1}</span>
      <span className="w-[68px] shrink-0 text-[10px] font-semibold text-neon">{label}</span>

      {step.type !== "flash" && step.type !== "wait" && step.type !== "goto" ? (
        <Select
          value={step.targetId ?? ""}
          onChange={(e) => onChange({ targetId: e.target.value })}
          className="h-7 w-[104px] text-[10px]"
        >
          <option value="">选择人物</option>
          {characters.map((el) => (
            <option key={el.id} value={el.id}>
              {el.character?.name ?? el.id}
            </option>
          ))}
        </Select>
      ) : null}

      {step.type === "say" ? (
        <>
          <input
            value={step.text ?? ""}
            onChange={(e) => onChange({ text: e.target.value })}
            placeholder="台词（留空用默认）"
            className="h-7 min-w-[120px] flex-1 rounded border border-line bg-ink-2 px-1.5 text-[10.5px] outline-none focus:border-neon/50"
          />
          <label className="flex items-center gap-1 text-[9px] text-mute">
            停留
            <input
              type="number"
              value={step.ms ?? 2600}
              min={300}
              max={12000}
              step={100}
              onChange={(e) => onChange({ ms: Number(e.target.value) })}
              className="h-7 w-16 rounded border border-line bg-ink-2 px-1 text-[10px] tabular-nums"
            />
            ms
          </label>
        </>
      ) : null}

      {step.type === "wait" ? (
        <label className="flex items-center gap-1 text-[9px] text-mute">
          等待
          <input
            type="number"
            value={step.ms ?? 600}
            min={0}
            max={20000}
            step={100}
            onChange={(e) => onChange({ ms: Number(e.target.value) })}
            className="h-7 w-16 rounded border border-line bg-ink-2 px-1 text-[10px] tabular-nums"
          />
          ms
        </label>
      ) : null}

      {step.type === "animate" ? (
        <Select
          value={step.animation ?? "bounce"}
          onChange={(e) => onChange({ animation: e.target.value as AnimationName })}
          className="h-7 w-[88px] text-[10px]"
        >
          {ANIMATIONS.map((anim) => (
            <option key={anim} value={anim}>
              {anim}
            </option>
          ))}
        </Select>
      ) : null}

      {step.type === "move" ? (
        <div className="flex items-center gap-1 text-[9px] text-mute">
          x
          <input
            type="number"
            value={step.dx ?? 0}
            onChange={(e) => onChange({ dx: Number(e.target.value) })}
            className="h-7 w-14 rounded border border-line bg-ink-2 px-1 text-[10px] tabular-nums"
          />
          y
          <input
            type="number"
            value={step.dy ?? -40}
            onChange={(e) => onChange({ dy: Number(e.target.value) })}
            className="h-7 w-14 rounded border border-line bg-ink-2 px-1 text-[10px] tabular-nums"
          />
        </div>
      ) : null}

      {step.type === "goto" ? (
        <Select
          value={step.eventId ?? ""}
          onChange={(e) => onChange({ eventId: e.target.value })}
          className="h-7 w-[140px] text-[10px]"
        >
          <option value="">选择事件</option>
          {events.map((ev) => (
            <option key={ev.id} value={ev.id}>
              {ev.name}
            </option>
          ))}
        </Select>
      ) : null}

      <label className="ml-auto flex items-center gap-1 text-[9px] text-mute" title="不等待这一步结束，直接执行下一步">
        <input
          type="checkbox"
          checked={!!step.parallel}
          onChange={(e) => onChange({ parallel: e.target.checked })}
          className="accent-[#b6ff3c]"
        />
        同时
      </label>

      <div className="flex">
        <IconButton
          icon="chevron-up"
          label="上移"
          size={12}
          className="h-6 w-5"
          disabled={index === 0}
          onClick={() => onMove(-1)}
        />
        <IconButton
          icon="chevron-down"
          label="下移"
          size={12}
          className="h-6 w-5"
          disabled={index === total - 1}
          onClick={() => onMove(1)}
        />
        <IconButton
          icon="close"
          label="删除动作"
          size={12}
          className="h-6 w-5 hover:text-hot"
          onClick={onRemove}
        />
      </div>
    </div>
  );
}
