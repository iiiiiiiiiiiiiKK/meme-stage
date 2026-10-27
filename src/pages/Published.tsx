import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { VisitorStage } from "../components/canvas/VisitorStage";
import { DEMO_PROJECT } from "../lib/demo";
import { remixProject, stagePendingProject } from "../lib/remix";
import { Button, IconButton, Spinner, toast } from "../components/ui";
import { Icon } from "../components/Icon";
import { copyText } from "../lib/export";
import { absoluteUrl } from "../lib/api";
import type { ProjectData } from "../lib/types";

interface Loaded {
  data: ProjectData;
  title: string;
  description: string;
  author: string;
  views: number;
  id: string;
  published: boolean;
}

export function PublishedPage() {
  const { slug = "" } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDemo, setIsDemo] = useState(false);

  useEffect(() => {
    let alive = true;
    setState("loading");
    (async () => {
      try {
        const res = await fetch(`/api/public/${encodeURIComponent(slug)}`);
        if (res.status === 404) {
          if (slug === "demo") {
            if (!alive) return;
            setIsDemo(true);
            setLoaded({
              data: DEMO_PROJECT,
              title: DEMO_PROJECT.title,
              description: DEMO_PROJECT.description,
              author: DEMO_PROJECT.settings.authorName || "MEME STAGE",
              views: 0,
              id: "demo",
              published: true,
            });
            setState("ready");
            return;
          }
          if (alive) setState("missing");
          return;
        }
        if (!res.ok) throw new Error(`加载失败（${res.status}）`);
        const payload = (await res.json()) as {
          project: {
            data: ProjectData;
            title: string;
            description: string;
            views: number;
            id: string;
            published: boolean;
            rev: number;
          };
        };
        if (!alive) return;
        setLoaded({
          data: payload.project.data,
          title: payload.project.title,
          description: payload.project.description,
          author: payload.project.data.settings.authorName || "",
          views: payload.project.views,
          id: payload.project.id,
          published: payload.project.published,
        });
        setState("ready");
      } catch (err) {
        if (!alive) return;
        setError(err instanceof Error ? err.message : "网络异常");
        setState("missing");
      }
    })();
    return () => {
      alive = false;
    };
  }, [slug]);

  useEffect(() => {
    if (!loaded) return;
    document.title = `${loaded.title} · MEME STAGE`;
    const meta = document.querySelector('meta[name="description"]');
    if (meta && loaded.description) meta.setAttribute("content", loaded.description);
    const timer = setTimeout(() => {
      void fetch(`/api/public/${encodeURIComponent(slug)}/view`, { method: "POST" }).catch(() => undefined);
    }, 1600);
    return () => clearTimeout(timer);
  }, [loaded, slug]);

  if (state === "loading") {
    return (
      <div className="grid h-full place-items-center bg-ink">
        <div className="flex flex-col items-center gap-3 text-mute">
          <Spinner size={24} className="text-neon" />
          <div className="text-[12px]">正在加载作品…</div>
        </div>
      </div>
    );
  }

  if (state === "missing") {
    return (
      <div className="relative grid h-full place-items-center bg-ink px-6">
        <div className="pointer-events-none absolute inset-0 grid-bg opacity-30" />
        <div className="relative max-w-md text-center">
          <div className="font-display text-6xl text-neon">404</div>
          <h1 className="mt-3 font-display text-2xl">这个作品还没上线</h1>
          <p className="mt-2 text-[12.5px] leading-relaxed text-mute">
            {error
              ? `加载时出错：${error}`
              : "链接可能拼错了，或者作者取消了发布。你仍然可以自己做一个。"}
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Link to="/">
              <Button variant="secondary" size="sm">回首页</Button>
            </Link>
            <Link to="/editor">
              <Button variant="primary" size="sm" icon="bolt">自己做一个</Button>
            </Link>
            <Link to="/p/demo">
              <Button variant="ghost" size="sm" icon="play">看官方示例</Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!loaded) return null;

  const shareUrl = absoluteUrl(`/p/${slug}`);

  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: loaded.title, text: loaded.description || "点开听听", url: shareUrl });
        return;
      } catch {
        // fall through to copy
      }
    }
    const ok = await copyText(shareUrl);
    toast(ok ? "链接已复制，去发群吧" : "复制失败", ok ? "success" : "error");
  };

  const remix = () => {
    const next = remixProject(loaded.data);
    stagePendingProject(next);
    navigate("/editor");
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#050507]">
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        <div className="absolute left-1/3 top-0 h-72 w-72 rounded-full bg-electric/10 blur-[100px]" />
        <div className="absolute bottom-0 right-1/4 h-64 w-64 rounded-full bg-hot/10 blur-[100px]" />
      </div>

      <header className="relative z-20 flex h-12 shrink-0 items-center gap-2 border-b border-line/70 bg-ink/80 px-2 backdrop-blur sm:px-3">
        <Link to="/" className="flex items-center gap-2" aria-label="MEME STAGE">
          <span className="grid h-6 w-6 place-items-center border-2 border-ink bg-neon font-display text-[11px] text-ink">
            M
          </span>
          <span className="hidden font-display text-[12px] sm:block">
            MEME<span className="text-neon">STAGE</span>
          </span>
        </Link>
        <div className="ml-2 min-w-0 flex-1">
          <div className="truncate text-[12px] font-semibold">{loaded.title}</div>
          <div className="flex items-center gap-2 text-[9px] text-mute">
            {loaded.data.settings.showAuthor && loaded.author ? <span>by {loaded.author}</span> : null}
            {loaded.views > 0 ? <span>· {loaded.views + 1} 次打开</span> : null}
            {isDemo ? <span className="text-neon">· 官方示例</span> : null}
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <IconButton icon="link" label="复制链接" onClick={() => void share()} />
          {loaded.data.settings.allowRemix ? (
            <Button size="sm" variant="secondary" icon="copy" onClick={remix} className="hidden sm:inline-flex">
              Remix
            </Button>
          ) : null}
          <Button size="sm" variant="primary" icon="bolt" onClick={() => navigate("/editor")}>
            做一个
          </Button>
        </div>
      </header>

      <main className="relative z-10 min-h-0 flex-1">
        <VisitorStage
          project={loaded.data}
          onError={(message) => toast(message, "error")}
        />
      </main>

      <footer className="relative z-20 flex shrink-0 flex-wrap items-center gap-2 border-t border-line/70 bg-ink/85 px-3 py-2 pb-[calc(0.5rem+var(--safe-bottom))] backdrop-blur">
        <span className="text-[10px] text-mute">
          {loaded.data.settings.soundHint || "轻点人物，听他们开口"}
        </span>
        {loaded.data.settings.allowRemix ? (
          <button
            type="button"
            onClick={remix}
            className="ml-auto flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[10px] text-paper hover:border-neon/50"
          >
            <Icon name="copy" size={11} /> Remix 这个作品
          </button>
        ) : null}
        <Link
          to="/"
          className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[10px] text-mute hover:border-paper/40 hover:text-paper"
        >
          <Icon name="bolt" size={11} /> 用 MEME STAGE 做一个
        </Link>
        <a
          href="https://x.com/0xkillcoin"
          target="_blank"
          rel="noreferrer noopener"
          className="grid h-6 w-6 place-items-center rounded border border-line text-[11px] hover:border-paper/40"
          aria-label="作者 X"
        >
          𝕏
        </a>
      </footer>
    </div>
  );
}
