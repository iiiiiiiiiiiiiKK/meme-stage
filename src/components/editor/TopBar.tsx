import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useEditor } from "../../store/editor";
import { Button, IconButton, Spinner, cn, toast } from "../ui";
import { Icon } from "../Icon";
import { persistNow } from "../../hooks/useAutosave";
import { downloadDataUrl } from "../../lib/export";

export function TopBar({
  onOpenPublish,
  onOpenPreview,
  onOpenImport,
  onExportPng,
  onOpenMobile,
  exporting,
}: {
  onOpenPublish: () => void;
  onOpenPreview: () => void;
  onOpenImport: () => void;
  onExportPng: () => void;
  onOpenMobile: (panel: "left" | "right" | "dock") => void;
  exporting: boolean;
}) {
  const title = useEditor((s) => s.project.title);
  const dirty = useEditor((s) => s.dirty);
  const saveState = useEditor((s) => s.saveState);
  const saveError = useEditor((s) => s.saveError);
  const projectId = useEditor((s) => s.projectId);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const status =
    saveState === "saving"
      ? { label: "保存中…", color: "bg-warn", spin: true }
      : saveState === "error"
        ? { label: "保存失败", color: "bg-hot", spin: false }
        : dirty
          ? { label: "未保存", color: "bg-warn", spin: false }
          : projectId
            ? { label: "已保存", color: "bg-neon", spin: false }
            : { label: "本地草稿", color: "bg-mute", spin: false };

  const exportJson = () => {
    const project = useEditor.getState().project;
    const blob = new Blob([JSON.stringify({ format: "meme-stage/project@1", project }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    downloadDataUrl(url, `${project.title || "meme-stage"}.json`);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    setMenuOpen(false);
  };

  return (
    <header className="relative z-30 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-ink px-2 sm:px-3">
      <Link
        to="/"
        className="group flex shrink-0 items-center gap-2"
        title="回到首页"
        aria-label="MEME STAGE 首页"
      >
        <span className="grid h-8 w-8 place-items-center border-2 border-ink bg-neon font-display text-[15px] text-ink hard-shadow-sm transition-transform group-hover:-rotate-6">
          M
        </span>
        <span className="hidden font-display text-[15px] tracking-tight sm:block">
          MEME<span className="text-neon">STAGE</span>
        </span>
      </Link>

      <div className="mx-1 h-6 w-px bg-line sm:mx-2" />

      <input
        value={title}
        onChange={(e) => useEditor.getState().mutate((draft) => void (draft.title = e.target.value), true, "title")}
        className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1.5 font-display text-[15px] outline-none transition-colors hover:border-line focus:border-neon/50 focus:bg-ink-2 sm:text-[17px]"
        placeholder="给作品起个名字"
        aria-label="作品名称"
        maxLength={80}
      />

      <div
        className="hidden items-center gap-1.5 rounded-full border border-line bg-ink-2 px-2.5 py-1 text-[11px] text-mute sm:flex"
        title={saveError ?? "编辑会自动保存"}
      >
        {status.spin ? (
          <Spinner size={9} className="text-warn" />
        ) : (
          <span className={cn("h-1.5 w-1.5 rounded-full", status.color)} />
        )}
        <span>{status.label}</span>
      </div>

      <div className="ml-auto flex items-center gap-0.5 sm:gap-1">
        <div className="hidden items-center gap-0.5 sm:flex">
          <IconButton
            icon="undo"
            label="撤销 ⌘Z"
            disabled={!canUndo}
            onClick={() => useEditor.getState().undo()}
          />
          <IconButton
            icon="redo"
            label="重做 ⇧⌘Z"
            disabled={!canRedo}
            onClick={() => useEditor.getState().redo()}
          />
          <div className="mx-1 h-6 w-px bg-line" />
        </div>

        <IconButton
          icon="upload"
          label="导入人物"
          className="lg:hidden"
          onClick={onOpenImport}
        />
        <IconButton
          icon="sliders"
          label="属性"
          className="lg:hidden"
          onClick={() => onOpenMobile("right")}
        />

        <Button
          variant="ghost"
          size="sm"
          icon="play"
          onClick={onOpenPreview}
          className="hidden sm:inline-flex"
        >
          预览
        </Button>
        <IconButton icon="play" label="预览" className="sm:hidden" onClick={onOpenPreview} />

        <Button variant="primary" size="sm" icon="bolt" onClick={onOpenPublish}>
          <span className="hidden sm:inline">发布</span>
          <span className="sm:hidden">发布</span>
        </Button>

        <div className="relative" ref={menuRef}>
          <IconButton icon="grip" label="更多" onClick={() => setMenuOpen((v) => !v)} />
          {menuOpen ? (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-9 z-50 w-52 overflow-hidden rounded-lg border border-line bg-ink-2 py-1 shadow-2xl">
                <MenuItem
                  icon="download"
                  label={exporting ? "正在导出…" : "导出 PNG"}
                  disabled={exporting}
                  onClick={() => {
                    setMenuOpen(false);
                    onExportPng();
                  }}
                />
                <MenuItem icon="download-cloud" label="导出项目 JSON" onClick={exportJson} />
                <MenuItem
                  icon="check"
                  label="立即保存"
                  onClick={async () => {
                    setMenuOpen(false);
                    await persistNow();
                    toast("已保存到云端", "success");
                  }}
                />
                <MenuItem
                  icon="copy"
                  label={projectId ? `作品 ID：${projectId.slice(0, 8)}…` : "尚未创建云端作品"}
                  onClick={async () => {
                    if (!projectId) return;
                    await navigator.clipboard.writeText(projectId).catch(() => undefined);
                    toast("作品 ID 已复制", "info");
                    setMenuOpen(false);
                  }}
                />
              </div>
            </>
          ) : null}
        </div>

        <a
          href="https://x.com/0xkillcoin"
          target="_blank"
          rel="noreferrer noopener"
          title="作者 @0xkillcoin on X"
          aria-label="作者 X 主页"
          className="ml-0.5 grid h-8 w-8 place-items-center rounded-md border border-line text-[15px] font-bold text-paper transition-colors hover:border-paper/40 hover:bg-white/5"
        >
          𝕏
        </a>
      </div>
    </header>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: Parameters<typeof Icon>[0]["name"];
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-paper transition-colors hover:bg-white/5 disabled:opacity-40"
    >
      <Icon name={icon} size={14} className="text-mute" />
      <span className="truncate">{label}</span>
    </button>
  );
}
