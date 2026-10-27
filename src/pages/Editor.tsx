import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useEditor } from "../store/editor";
import { useAutosave, persistNow } from "../hooks/useAutosave";
import { api, ApiRequestError } from "../lib/api";
import { createProject } from "../lib/defaults";
import { normalizeProject } from "../lib/schema";
import { loadDraft, removeDraft } from "../lib/local";
import { takePendingProject } from "../lib/remix";
import { downloadDataUrl } from "../lib/export";
import { EditorCanvas, type EditorCanvasHandle } from "../components/canvas/EditorCanvas";
import { VisitorStage } from "../components/canvas/VisitorStage";
import { TopBar } from "../components/editor/TopBar";
import { LeftPanel } from "../components/editor/LeftPanel";
import { Inspector } from "../components/editor/Inspector";
import { BottomDock } from "../components/editor/BottomDock";
import { ImportDialog } from "../components/editor/ImportDialog";
import { PublishDialog } from "../components/editor/PublishDialog";
import { Button, IconButton, Spinner, cn, toast } from "../components/ui";
import { Icon } from "../components/Icon";
import { useIsMobile } from "../hooks/useMediaQuery";

type MobilePanel = "left" | "right" | "dock" | null;

export function EditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const canvasRef = useRef<EditorCanvasHandle | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showPublish, setShowPublish] = useState(false);
  const [preview, setPreview] = useState<{ open: boolean; triggerId: string | null }>({
    open: false,
    triggerId: null,
  });
  const [exporting, setExporting] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const projectId = useEditor((s) => s.projectId);
  const liveProject = useEditor((s) => (preview.open ? s.project : null));
  const conflict = useEditor((s) => s.conflict);
  const saveState = useEditor((s) => s.saveState);
  const saveError = useEditor((s) => s.saveError);

  useAutosave();

  /* --------------------------------------------------------------- loading */
  useEffect(() => {
    let alive = true;
    // already loaded in memory (e.g. we just created this project and synced the URL)
    if (id && useEditor.getState().projectId === id) {
      setLoading(false);
      setNotFound(false);
      return () => {
        alive = false;
      };
    }
    setLoading(true);
    setNotFound(false);

    const load = async () => {
      if (!id) {
        const pending = takePendingProject();
        if (pending) {
          let project = pending;
          try {
            project = normalizeProject(pending);
          } catch {
            project = pending;
          }
          useEditor.getState().loadProject(project, { id: null, rev: 0 });
          useEditor.setState({ dirty: true });
          if (alive) setLoading(false);
          return;
        }
        const draft = loadDraft("new");
        const rawProject = draft?.project ? { ...draft.project, updatedAt: Date.now() } : createProject();
        let project = rawProject;
        try {
          project = normalizeProject(rawProject);
        } catch {
          project = rawProject;
        }
        useEditor.getState().loadProject(project, { id: null, rev: draft?.rev ?? 0 });
        if (alive) setLoading(false);
        return;
      }

      const draft = loadDraft(id);
      if (draft) {
        try {
          useEditor.getState().loadProject(normalizeProject(draft.project), { id, rev: draft.rev });
        } catch {
          useEditor.getState().loadProject(draft.project, { id, rev: draft.rev });
        }
        if (alive) setLoading(false);
      }
      try {
        const res = await api.getProject(id);
        if (!alive) return;
        const localUpdatedAt = Math.max(draft?.project.updatedAt ?? 0, draft?.savedAt ?? 0);
        const serverNewer = res.updatedAt >= localUpdatedAt;
        if (serverNewer || !draft) {
          useEditor.getState().loadProject(res.data, { id: res.id, rev: res.rev });
          useEditor.getState().setSaveState("saved");
          removeDraft(id);
        } else {
          useEditor.getState().setSaveState("saved");
          useEditor.setState({ rev: res.rev, dirty: true });
        }
      } catch (error) {
        if (!alive) return;
        if (error instanceof ApiRequestError && (error.status === 404 || error.status === 401 || error.status === 403)) {
          if (draft) {
            useEditor.getState().setSaveState("local", "云端作品不可用，正在使用本地草稿");
          } else {
            setNotFound(true);
          }
        } else if (!draft) {
          setNotFound(true);
        }
      } finally {
        if (alive) setLoading(false);
      }
    };

    void load();
    return () => {
      alive = false;
    };
  }, [id]);

  /* ------------------------------------------- URL sync after first create */
  useEffect(() => {
    if (!id && projectId) {
      navigate(`/editor/${projectId}`, { replace: true });
    }
  }, [id, projectId, navigate]);

  /* ---------------------------------------------------------------- export */
  const exportPng = async () => {
    const project = useEditor.getState().project;
    setExporting(true);
    try {
      const dataUrl = await canvasRef.current?.exportFrame(project.width * 1.5);
      if (!dataUrl) throw new Error("导出失败");
      downloadDataUrl(dataUrl, `${project.title || "meme-stage"}.png`);
      toast("PNG 已导出", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "导出失败", "error");
    } finally {
      setExporting(false);
    }
  };

  /* --------------------------------------------------------------- preview */
  useEffect(() => {
    document.body.dataset.mode = preview.open ? "preview" : "";
    return () => {
      document.body.dataset.mode = "";
    };
  }, [preview.open]);

  if (loading) {
    return (
      <div className="grid h-full place-items-center bg-ink">
        <div className="flex flex-col items-center gap-3 text-mute">
          <Spinner size={22} className="text-neon" />
          <div className="text-[12px]">正在打开画布…</div>
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="grid h-full place-items-center bg-ink px-6">
        <div className="max-w-md text-center">
          <div className="font-display text-4xl text-neon">404</div>
          <h1 className="mt-2 font-display text-xl">这个作品不存在，或者不属于你</h1>
          <p className="mt-2 text-[12px] leading-relaxed text-mute">
            作品可能已被删除，或者你在另一台设备上创建。编辑器身份只保存在当前浏览器，换设备需要用同一个身份。
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Link to="/">
              <Button variant="secondary" size="sm">回首页</Button>
            </Link>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                useEditor.getState().loadProject(createProject(), { id: null, rev: 0 });
                setNotFound(false);
                navigate("/editor", { replace: true });
              }}
            >
              新建作品
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const dock = (
    <BottomDock
      onTest={(triggerId) => {
        setPreview({ open: true, triggerId });
        setMobilePanel(null);
      }}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-ink">
      <TopBar
        onOpenPublish={() => setShowPublish(true)}
        onOpenPreview={() => setPreview({ open: true, triggerId: null })}
        onOpenImport={() => setShowImport(true)}
        onExportPng={() => void exportPng()}
        onOpenMobile={(panel) => setMobilePanel(panel)}
        exporting={exporting}
      />

      {conflict ? (
        <div className="flex items-center gap-2 border-b border-warn/40 bg-warn/10 px-3 py-1.5 text-[11px] text-warn">
          <Icon name="alert" size={13} />
          <span className="min-w-0 flex-1 truncate">这个作品在别处被修改过。你可以用本地版本覆盖云端。</span>
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              await persistNow(true);
              toast("已用本地版本覆盖", "success");
            }}
          >
            覆盖云端
          </Button>
        </div>
      ) : null}

      {saveState === "error" && !conflict ? (
        <div className="flex items-center gap-2 border-b border-hot/40 bg-hot/10 px-3 py-1.5 text-[11px] text-hot">
          <Icon name="alert" size={13} />
          <span className="min-w-0 flex-1 truncate">保存失败：{saveError ?? "网络异常"}（本地草稿已保留）</span>
          <Button size="sm" variant="secondary" onClick={() => void persistNow()}>
            重试
          </Button>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        {!isMobile ? (
          <aside className="hidden w-[292px] shrink-0 border-r border-line lg:block">
            <LeftPanel onOpenImport={() => setShowImport(true)} />
          </aside>
        ) : null}

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
            <EditorCanvas ref={canvasRef} />
          </div>
          {!isMobile ? dock : null}
        </main>

        {!isMobile ? (
          <aside className="hidden w-[318px] shrink-0 border-l border-line bg-ink-2 lg:block">
            <Inspector />
          </aside>
        ) : null}
      </div>

      {isMobile ? (
        <nav className="flex h-14 shrink-0 items-center justify-around border-t border-line bg-ink px-1 pb-[var(--safe-bottom)]">
          <MobileTab icon="users" label="人物" active={mobilePanel === "left"} onClick={() => setMobilePanel("left")} />
          <MobileTab icon="sliders" label="属性" active={mobilePanel === "right"} onClick={() => setMobilePanel("right")} />
          <MobileTab icon="workflow" label="互动" active={mobilePanel === "dock"} onClick={() => setMobilePanel("dock")} />
          <MobileTab icon="play" label="预览" active={preview.open} onClick={() => setPreview({ open: true, triggerId: null })} />
        </nav>
      ) : null}

      {isMobile && mobilePanel ? (
        <div className="fixed inset-0 z-40 flex flex-col justify-end bg-black/60 backdrop-blur-sm" onClick={() => setMobilePanel(null)}>
          <div
            className="pop-in flex max-h-[68dvh] min-h-[40dvh] flex-col overflow-hidden rounded-t-2xl border-t-2 border-line bg-ink-2"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-line px-3 py-2">
              <span className="text-[12px] font-bold">
                {mobilePanel === "left" ? "人物与素材" : mobilePanel === "right" ? "属性" : "互动编排"}
              </span>
              <IconButton icon="close" label="关闭" onClick={() => setMobilePanel(null)} />
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              {mobilePanel === "left" ? <LeftPanel onOpenImport={() => setShowImport(true)} /> : null}
              {mobilePanel === "right" ? <Inspector /> : null}
              {mobilePanel === "dock" ? <div className="h-full overflow-hidden">{dock}</div> : null}
            </div>
          </div>
        </div>
      ) : null}

      {showImport ? <ImportDialog onClose={() => setShowImport(false)} /> : null}
      {showPublish ? (
        <PublishDialog
          onClose={() => setShowPublish(false)}
          exportFrame={async (width) => {
            const data = await canvasRef.current?.exportFrame(width);
            if (!data) throw new Error("画布还没准备好");
            return data;
          }}
        />
      ) : null}

      {preview.open ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-[#050507]" data-testid="preview">
          <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-ink px-2">
            <Button size="sm" variant="ghost" icon="chevron-left" onClick={() => setPreview({ open: false, triggerId: null })}>
              退出预览
            </Button>
            <span className="text-[10px] text-mute">访客看到的就是这样 · 点人物出声音 · 气泡可直接拖动</span>
            <div className="ml-auto flex items-center gap-1">
              <Button
                size="sm"
                variant="secondary"
                icon="download"
                onClick={() => void exportPng()}
                disabled={exporting}
              >
                PNG
              </Button>
              <Button size="sm" variant="primary" icon="bolt" onClick={() => setShowPublish(true)}>
                发布
              </Button>
            </div>
          </div>
          <div className="relative min-h-0 flex-1">
            <VisitorStage
              project={liveProject ?? useEditor.getState().project}
              autoTriggerId={preview.triggerId}
              onBubbleMove={(elementId, placement) =>
                useEditor.getState().updateCharacter(
                  elementId,
                  (character) => {
                    character.bubblePlacement = placement;
                  },
                  true,
                  `bubblepos:${elementId}`,
                )
              }
              onError={(message) => {
                setAudioError(message);
                setTimeout(() => setAudioError(null), 4200);
              }}
            />
          </div>
          {audioError ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-16 z-10 flex justify-center">
              <div className="rounded-lg border border-hot/50 bg-[#2a0d18] px-3 py-2 text-[11px] text-paper shadow-lg">
                {audioError}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function MobileTab({
  icon,
  label,
  active,
  onClick,
}: {
  icon: "users" | "sliders" | "workflow" | "play";
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg text-[9px] transition-colors",
        active ? "text-neon" : "text-mute",
      )}
    >
      <Icon name={icon} size={17} />
      {label}
    </button>
  );
}
