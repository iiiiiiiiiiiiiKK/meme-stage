import {
  createContext,
  useContext,
  useEffect,
  useId,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { Icon, type IconName } from "./Icon";

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "outline" | "danger";
type Size = "sm" | "md" | "lg";

const variantClass: Record<Variant, string> = {
  primary:
    "bg-neon text-ink border-2 border-ink hard-shadow-sm hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none active:translate-x-[2px] active:translate-y-[2px]",
  secondary: "bg-ink-3 text-paper border border-line hover:border-neon/60 hover:bg-ink-2",
  ghost: "bg-transparent text-mute hover:text-paper hover:bg-white/5 border border-transparent",
  outline: "bg-transparent text-paper border border-line hover:border-paper/40",
  danger: "bg-hot/10 text-hot border border-hot/50 hover:bg-hot/20",
};

const sizeClass: Record<Size, string> = {
  sm: "text-[12px] px-2.5 h-8 gap-1.5 rounded-lg",
  md: "text-[13px] px-3.5 h-9 gap-2 rounded-lg",
  lg: "text-[15px] px-5 h-12 gap-2 rounded-xl",
};

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  children,
  className,
  ...props
}: {
  variant?: Variant;
  size?: Size;
  icon?: IconName;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center justify-center font-semibold transition-all duration-150 disabled:opacity-40 disabled:pointer-events-none select-none",
        variantClass[variant],
        sizeClass[size],
        className,
      )}
      {...props}
    >
      {icon ? <Icon name={icon} size={size === "sm" ? 14 : 16} /> : null}
      {children}
    </button>
  );
}

export function IconButton({
  icon,
  label,
  active,
  className,
  size = 18,
  ...props
}: {
  icon: IconName;
  label: string;
  active?: boolean;
  size?: number;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-mute transition-colors hover:bg-white/6 hover:text-paper disabled:opacity-35 disabled:pointer-events-none",
        active && "bg-neon/15 text-neon border-neon/40",
        className,
      )}
      {...props}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block space-y-1.5", className)}>
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mute">{label}</span>
        {hint ? <span className="text-[10px] text-mute/70">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

const inputBase =
  "w-full rounded-lg border border-line bg-ink-2 px-2.5 py-1.5 text-[13px] text-paper placeholder:text-mute/60 outline-none transition-colors focus:border-neon/60 focus:bg-ink-3";

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(inputBase, "h-9", className)} {...props} />;
}

export function TextArea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(inputBase, "min-h-[72px] resize-y leading-relaxed", className)} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(inputBase, "h-9 cursor-pointer pr-8", className)} {...props}>
      {children}
    </select>
  );
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
  className,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  className?: string;
}) {
  const [text, setText] = useState(String(Math.round(value * 100) / 100));
  useEffect(() => {
    setText(String(Math.round(value * 100) / 100));
  }, [value]);

  const commit = (raw: string) => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      setText(String(Math.round(value * 100) / 100));
      return;
    }
    const clamped = Math.min(max ?? Number.MAX_SAFE_INTEGER, Math.max(min ?? -Number.MAX_SAFE_INTEGER, parsed));
    onChange(clamped);
    setText(String(Math.round(clamped * 100) / 100));
  };

  return (
    <div className={cn("relative", className)}>
      <input
        className={cn(inputBase, "h-9 pr-7 tabular-nums")}
        value={text}
        inputMode="decimal"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => commit(text)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit(text);
        }}
        step={step}
        type="number"
        min={min}
        max={max}
      />
      {suffix ? (
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-mute">
          {suffix}
        </span>
      ) : null}
    </div>
  );
}

export function Slider({
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.01,
  label,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-line"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-mute">
        {label ?? Math.round(value * 100)}
      </span>
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <div className="min-w-0">
        <div className="text-[12px] text-paper">{label}</div>
        {hint ? <div className="text-[10px] leading-tight text-mute">{hint}</div> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full border transition-colors",
          checked ? "border-neon bg-neon/30" : "border-line bg-ink-3",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all",
            checked ? "left-4.5 bg-neon" : "left-0.5 bg-mute",
          )}
        />
      </button>
    </div>
  );
}

export function ColorInput({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <input
        id={id}
        type="color"
        value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#ffffff"}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-9 cursor-pointer rounded-md border border-line bg-ink-2 p-0.5"
        aria-label={label}
      />
      <TextInput
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 font-mono text-[11px]"
        aria-label={`${label} 颜色值`}
      />
    </div>
  );
}

export function Section({
  title,
  action,
  children,
  defaultOpen = true,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-line/70">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <button
          type="button"
          className="flex flex-1 items-center gap-1.5 text-left text-[11px] font-bold uppercase tracking-[0.1em] text-mute hover:text-paper"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <Icon name={open ? "chevron-down" : "chevron-right"} size={12} />
          {title}
        </button>
        {action}
      </div>
      {open ? <div className="space-y-3 px-3 pb-3">{children}</div> : null}
    </div>
  );
}

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "pop-in flex max-h-[92dvh] w-full flex-col overflow-hidden border-2 border-ink bg-ink-2 shadow-[0_0_0_1px_#262633,10px_10px_0_#000] sm:rounded-2xl",
          wide ? "sm:max-w-4xl" : "sm:max-w-lg",
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-4 py-3">
          <div>
            <h2 className="font-display text-lg leading-none">{title}</h2>
            {subtitle ? <p className="mt-1 text-[11px] text-mute">{subtitle}</p> : null}
          </div>
          <IconButton icon="close" label="关闭" onClick={onClose} />
        </div>
        <div className="scroll-thin flex-1 overflow-y-auto p-4">{children}</div>
        {footer ? (
          <div className="border-t border-line bg-ink px-4 py-3 pb-[calc(0.75rem+var(--safe-bottom))]">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

type ToastKind = "info" | "success" | "error";
interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}
const useToastStore = create<{ items: ToastItem[]; push: (message: string, kind: ToastKind) => void; remove: (id: number) => void }>(
  (set, get) => ({
    items: [],
    push: (message, kind) => {
      const id = Date.now() + Math.random();
      set({ items: [...get().items.slice(-3), { id, message, kind }] });
      setTimeout(() => get().remove(id), kind === "error" ? 5200 : 2800);
    },
    remove: (id) => set({ items: get().items.filter((t) => t.id !== id) }),
  }),
);

export function toast(message: string, kind: ToastKind = "info"): void {
  useToastStore.getState().push(message, kind);
}

export function Toaster() {
  const items = useToastStore((s) => s.items);
  if (items.length === 0) return null;
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 pb-[var(--safe-bottom)]">
      {items.map((item) => (
        <div
          key={item.id}
          className={cn(
            "pop-in pointer-events-auto flex max-w-md items-start gap-2 rounded-lg border px-3.5 py-2.5 text-[12.5px] shadow-lg",
            item.kind === "error"
              ? "border-hot/60 bg-[#2a0d18] text-paper"
              : item.kind === "success"
                ? "border-neon/50 bg-[#16220b] text-paper"
                : "border-line bg-ink-3 text-paper",
          )}
          role="status"
        >
          <Icon
            name={item.kind === "error" ? "alert" : item.kind === "success" ? "check" : "info"}
            size={15}
            className={item.kind === "error" ? "text-hot" : item.kind === "success" ? "text-neon" : "text-electric"}
          />
          <span className="leading-snug">{item.message}</span>
        </div>
      ))}
    </div>,
    document.body,
  );
}

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <span
      className={cn("inline-block animate-spin rounded-full border-2 border-current border-t-transparent", className)}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: IconName;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
      <div className="grid h-11 w-11 place-items-center rounded-xl border border-line bg-ink-3 text-mute">
        <Icon name={icon} size={20} />
      </div>
      <div className="text-[13px] font-semibold">{title}</div>
      <p className="max-w-[220px] text-[11px] leading-relaxed text-mute">{description}</p>
      {action}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-line bg-ink px-1 py-0.5 font-mono text-[10px] text-mute">{children}</kbd>
  );
}

export const ThemeContext = createContext<"dark" | "light">("dark");
export const useTheme = () => useContext(ThemeContext);
