import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type ProjectSummary } from "../lib/api";
import { readDraftIndex } from "../lib/local";
import { Button, Spinner, toast } from "../components/ui";
import { Icon } from "../components/Icon";

interface DraftItem {
  id: string;
  title: string;
  updatedAt: number;
}

export function LibraryPage() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "published" | "draft">("all");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.listProjects();
      setProjects(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setDrafts(readDraftIndex());
      setLoading(false);
    }
  };

  useEffect(() => {
    document.title = "我的作品 · MEME STAGE";
    void load();
  }, []);

  const shown = projects.filter((project) =>
    filter === "all" ? true : filter === "published" ? project.published : !project.published,
  );

  const formatDate = (ts: number) =>
    new Date(ts).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="min-h-full bg-ink">
      <header className="sticky top-0 z-30 border-b border-line bg-ink/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
          <Link to="/" className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center border-2 border-ink bg-neon font-display text-[13px] text-ink">
              M
            </span>
            <span className="font-display text-[14px]">
              MEME<span className="text-neon">STAGE</span>
            </span>
          </Link>
          <span className="ml-2 text-[12px] text-mute">我的作品</span>
          <div className="ml-auto flex items-center gap-1.5">
            <a
              href="https://x.com/0xkillcoin"
              target="_blank"
              rel="noreferrer noopener"
              className="grid h-8 w-8 place-items-center rounded-md border border-line text-[14px] hover:border-paper/40"
              aria-label="作者 X"
            >
              𝕏
            </a>
            <Link to="/editor">
              <Button size="sm" variant="primary" icon="plus">新建作品</Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {(
            [
              { id: "all" as const, label: "全部" },
              { id: "published" as const, label: "已发布" },
              { id: "draft" as const, label: "未发布" },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setFilter(item.id)}
              className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold ${
                filter === item.id ? "border-neon/50 bg-neon/10 text-neon" : "border-line text-mute hover:text-paper"
              }`}
            >
              {item.label}
            </button>
          ))}
          <span className="ml-auto text-[10px] text-mute">
            作品与「当前浏览器身份」绑定，换浏览器/清缓存后将无法编辑旧作品。
          </span>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-16 text-[12px] text-mute">
            <Spinner size={16} className="text-neon" /> 正在读取云端作品…
          </div>
        ) : error ? (
          <div className="rounded-lg border border-hot/40 bg-hot/5 p-4 text-[12px]">
            <div className="font-semibold text-hot">读取失败</div>
            <p className="mt-1 text-mute">{error}</p>
            <Button size="sm" variant="secondary" className="mt-3" onClick={() => void load()}>
              重试
            </Button>
          </div>
        ) : shown.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line py-16 text-center">
            <div className="font-display text-xl">这里还没有作品</div>
            <p className="mx-auto mt-1 max-w-xs text-[12px] leading-relaxed text-mute">
              从导入二十张人物图片开始，给几个人绑上声音，再安排他们吵一架。
            </p>
            <div className="mt-4 flex justify-center gap-2">
              <Link to="/editor">
                <Button size="sm" variant="primary" icon="bolt">开始创作</Button>
              </Link>
              <Link to="/p/demo">
                <Button size="sm" variant="ghost" icon="play">看示例</Button>
              </Link>
            </div>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((project) => (
              <div key={project.id} className="group overflow-hidden rounded-lg border border-line bg-ink-2 transition-colors hover:border-paper/25">
                <Link to={project.published && project.slug ? `/p/${project.slug}` : `/editor/${project.id}`}>
                  <div className="relative aspect-[1200/630] overflow-hidden bg-ink-3">
                    {project.coverUrl ? (
                      <img src={project.coverUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                      <div className="grid h-full place-items-center text-[11px] text-mute">还没有封面</div>
                    )}
                    {project.published ? (
                      <span className="absolute right-1.5 top-1.5 rounded bg-neon px-1.5 py-0.5 text-[9px] font-bold text-ink">
                        已发布
                      </span>
                    ) : (
                      <span className="absolute right-1.5 top-1.5 rounded bg-ink/80 px-1.5 py-0.5 text-[9px] text-mute">
                        未发布
                      </span>
                    )}
                  </div>
                </Link>
                <div className="p-2.5">
                  <Link to={`/editor/${project.id}`} className="block truncate text-[13px] font-semibold hover:text-neon">
                    {project.title}
                  </Link>
                  <div className="mt-1 flex items-center gap-2 text-[9.5px] text-mute">
                    <span>{formatDate(project.updatedAt)}</span>
                    {project.views > 0 ? (
                      <span className="flex items-center gap-0.5">
                        <Icon name="eye" size={10} /> {project.views}
                      </span>
                    ) : null}
                    <span className="ml-auto font-mono">rev {project.rev}</span>
                  </div>
                  <div className="mt-2 flex gap-1">
                    <Link to={`/editor/${project.id}`} className="flex-1">
                      <Button size="sm" variant="secondary" icon="sliders" className="w-full">编辑</Button>
                    </Link>
                    {project.published && project.slug ? (
                      <Link to={`/p/${project.slug}`} className="flex-1">
                        <Button size="sm" variant="ghost" icon="external" className="w-full">打开</Button>
                      </Link>
                    ) : null}
                    <button
                      type="button"
                      className="grid h-8 w-8 place-items-center rounded-md text-mute hover:bg-hot/10 hover:text-hot"
                      title="删除作品"
                      onClick={async () => {
                        if (!window.confirm(`永久删除「${project.title}」？这个操作不可撤销。`)) return;
                        try {
                          await api.deleteProject(project.id);
                          setProjects((prev) => prev.filter((item) => item.id !== project.id));
                          toast("作品已删除", "success");
                        } catch (err) {
                          toast(err instanceof Error ? err.message : "删除失败", "error");
                        }
                      }}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {drafts.length > 0 ? (
          <div className="mt-8">
            <h2 className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-mute">本地草稿</h2>
            <ul className="divide-y divide-line rounded-lg border border-line">
              {drafts.map((draft) => (
                <li key={draft.id} className="flex items-center gap-2 px-3 py-2">
                  <Icon name="download-cloud" size={13} className="text-mute" />
                  <Link
                    to={draft.id === "new" ? "/editor" : `/editor/${draft.id}`}
                    className="min-w-0 flex-1 truncate text-[12px] hover:text-neon"
                  >
                    {draft.title || "未命名草稿"}
                  </Link>
                  <span className="text-[9px] text-mute">{formatDate(draft.updatedAt)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[10px] text-mute">
              本地草稿保存在这个浏览器里；联网后打开会自动同步到云端。
            </p>
          </div>
        ) : null}
      </main>
    </div>
  );
}
