/**
 * Unified asset library.
 *
 * Two storage scopes share one screen: local IndexedDB (stickers produced on this
 * device) and the Cloudflare R2 assets that published works can reference. The
 * scope is always labelled, because "exists in my browser" and "可以发布" are very
 * different promises and the UI must not blur them.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button, EmptyState, Select, Spinner, cn, toast } from "../components/ui";
import { Icon } from "../components/Icon";
import { useAssets } from "../store/assets";
import { useEditor } from "../store/editor";
import { formatBytes } from "../lib/image";
import { getVariantBlob, listSources, listVariants } from "../features/sticker/repository";
import { importStickers } from "../features/sticker/bridge";
import type { AssetRecord } from "../lib/types";
import type { StickerSource, StickerVariant } from "../features/sticker/types";

type Scope = "all" | "local" | "cloud";
type Kind = "all" | "sticker" | "source" | "image" | "audio" | "video";

interface LocalRow {
  scope: "local";
  id: string;
  name: string;
  kind: "sticker" | "source";
  mime: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  createdAt: number;
  variant?: StickerVariant;
  source?: StickerSource;
}

interface CloudRow {
  scope: "cloud";
  id: string;
  name: string;
  kind: "image" | "audio" | "video";
  mime: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  createdAt: number;
  asset: AssetRecord;
}

type Row = LocalRow | CloudRow;

export function UnifiedLibrary() {
  const navigate = useNavigate();
  // STICKER sends the user here right after an upload; highlight what just landed.
  const [searchParams] = useSearchParams();
  const focusId = searchParams.get("focus");
  const projectId = useEditor((s) => s.projectId);
  const cloudAssets = useAssets((s) => s.items);
  const loadCloud = useAssets((s) => s.load);
  const cloudLoading = useAssets((s) => s.loading);
  const cloudHasMore = useAssets((s) => s.hasMore);
  const removeCloud = useAssets((s) => s.remove);

  const [localVariants, setLocalVariants] = useState<StickerVariant[]>([]);
  const [localSources, setLocalSources] = useState<StickerSource[]>([]);
  const [loadingLocal, setLoadingLocal] = useState(true);
  const [scope, setScope] = useState<Scope>("all");
  const [kind, setKind] = useState<Kind>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  const loadLocal = useCallback(async () => {
    setLoadingLocal(true);
    try {
      const [variants, sources] = await Promise.all([listVariants(), listSources()]);
      setLocalVariants(variants);
      setLocalSources(sources);
    } finally {
      setLoadingLocal(false);
    }
  }, []);

  useEffect(() => {
    void loadLocal();
  }, [loadLocal]);

  useEffect(() => {
    void loadCloud();
  }, [loadCloud]);

  // Build preview URLs once per variant and revoke them on unmount.
  useEffect(() => {
    let alive = true;
    const created: string[] = [];
    void (async () => {
      const next: Record<string, string> = {};
      for (const variant of localVariants.slice(0, 60)) {
        if (thumbs[variant.id]) {
          next[variant.id] = thumbs[variant.id];
          continue;
        }
        const stored = await getVariantBlob(variant.id);
        if (!stored || !alive) continue;
        const url = URL.createObjectURL(stored.thumb);
        created.push(url);
        next[variant.id] = url;
      }
      if (alive && Object.keys(next).length > 0) {
        setThumbs((prev) => ({ ...prev, ...next }));
      }
    })();
    return () => {
      alive = false;
      for (const url of created) URL.revokeObjectURL(url);
    };
    // `thumbs` is intentionally not a dependency: it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localVariants]);

  const rows = useMemo<Row[]>(() => {
    const local: Row[] = [
      ...localVariants.map<LocalRow>((variant) => ({
        scope: "local",
        id: variant.id,
        name: variant.name,
        kind: "sticker",
        mime: variant.mime,
        byteSize: variant.byteSize,
        width: variant.width,
        height: variant.height,
        createdAt: variant.createdAt,
        variant,
      })),
      ...localSources.map<LocalRow>((source) => ({
        scope: "local",
        id: source.id,
        name: source.name,
        kind: "source",
        mime: source.mime,
        byteSize: source.byteSize,
        width: source.width,
        height: source.height,
        createdAt: source.createdAt,
        source,
      })),
    ];
    const cloud: Row[] = cloudAssets.map<CloudRow>((asset) => ({
      scope: "cloud",
      id: asset.id,
      name: asset.name,
      kind: asset.kind === "cover" ? "image" : asset.kind,
      mime: asset.mime,
      byteSize: asset.size,
      width: asset.width,
      height: asset.height,
      createdAt: asset.createdAt ?? 0,
      asset,
    }));
    const needle = search.trim().toLowerCase();
    return [...local, ...cloud]
      .filter((row) => (scope === "all" ? true : row.scope === scope))
      .filter((row) => (kind === "all" ? true : row.kind === kind))
      .filter((row) => (needle ? row.name.toLowerCase().includes(needle) : true))
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [cloudAssets, kind, localSources, localVariants, scope, search]);

  const counts = useMemo(
    () => ({
      local: localVariants.length + localSources.length,
      cloud: cloudAssets.length,
    }),
    [cloudAssets.length, localSources.length, localVariants.length],
  );

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const downloadOne = useCallback(async (row: Row) => {
    if (row.scope === "cloud") {
      const response = await fetch(row.asset.url);
      if (!response.ok) {
        toast("下载失败", "error");
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = row.name;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      return;
    }
    if (row.kind === "sticker") {
      const stored = await getVariantBlob(row.id);
      if (!stored) {
        toast("本机文件已不在", "error");
        return;
      }
      const url = URL.createObjectURL(stored.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${row.name}.${row.mime === "image/webp" ? "webp" : "png"}`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      return;
    }
    toast("原图请从贴纸工坊下载", "info");
  }, []);

  const importSelected = useCallback(async () => {
    const chosen = rows.filter((row) => selected.has(`${row.scope}:${row.id}`));
    const stickers = chosen.filter((row): row is LocalRow => row.scope === "local" && row.kind === "sticker");
    if (stickers.length === 0) {
      toast("先选本机贴纸；云端图片可以用「加入画布」单独插入", "info");
      return;
    }
    setImporting(true);
    try {
      const outcome = await importStickers(
        stickers.map((row) => ({ variant: row.variant!, asCharacter: false })),
      );
      toast(
        outcome.failed.length > 0
          ? `${outcome.ok.length} 张已加入，${outcome.failed.length} 张失败`
          : `已把 ${outcome.ok.length} 张贴纸加入画布`,
        outcome.failed.length > 0 ? "error" : "success",
      );
      // Leaving the user on this page would hide the result: the elements exist in
      // the editor store, not on screen here. Same landing point as the batch panel.
      if (outcome.ok.length > 0) navigate(projectId ? `/editor/${projectId}` : "/editor");
    } finally {
      setImporting(false);
    }
  }, [navigate, projectId, rows, selected]);

  return (
    <div className="min-h-full bg-ink">
      <header className="sticky top-0 z-30 border-b border-line bg-ink/95 px-4 py-2.5 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2">
          <Link to="/" className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center border-2 border-ink bg-neon font-display text-[13px] text-ink">
              M
            </span>
            <span className="font-display text-[14px]">
              MEME<span className="text-neon">STAGE</span>
            </span>
          </Link>
          <span className="text-[12px] text-mute">素材库</span>
          <div className="ml-auto flex items-center gap-1.5">
            <Link to="/sticker">
              <Button size="sm" variant="secondary" icon="image">
                贴纸工坊
              </Button>
            </Link>
            <Link to="/editor">
              <Button size="sm" variant="primary" icon="plus">
                新建作品
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex rounded border border-line">
            {(
              [
                { id: "all" as Scope, label: "全部" },
                { id: "local" as Scope, label: `本机 ${counts.local}` },
                { id: "cloud" as Scope, label: `云端 ${counts.cloud}` },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setScope(item.id)}
                className={cn(
                  "px-2.5 py-1 text-[11px] font-semibold",
                  scope === item.id ? "bg-neon text-ink" : "text-mute hover:text-paper",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
          <Select
            value={kind}
            aria-label="素材类型"
            className="h-7 w-28 text-[11px]"
            onChange={(e) => setKind(e.target.value as Kind)}
          >
            <option value="all">全部类型</option>
            <option value="sticker">贴纸</option>
            <option value="source">原图</option>
            <option value="image">图片</option>
            <option value="audio">音频</option>
            <option value="video">视频</option>
          </Select>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索名称"
            aria-label="搜索素材"
            className="h-7 w-40 rounded border border-line bg-ink px-2 text-[11px] outline-none focus:border-neon/60"
          />
          <div className="ml-auto flex items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              icon="image"
              disabled={selected.size === 0 || importing}
              onClick={() => void importSelected()}
            >
              {importing ? <Spinner size={11} /> : null}
              加入画布（{selected.size}）
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>
              清空选择
            </Button>
          </div>
        </div>

        <p className="mt-2 text-[10px] leading-relaxed text-mute">
          <b className="text-paper">本机</b> 只存在于这个浏览器（IndexedDB），清理浏览器数据会丢；
          <b className="text-paper">云端</b> 是加入作品后上传到 R2 的素材，发布页可以访问。
          贴纸的原始图片与蒙版只在本机。
        </p>

        <div className="mt-3">
          {loadingLocal && cloudLoading ? (
            <div className="flex items-center gap-2 py-10 text-[11px] text-mute">
              <Spinner size={13} /> 正在读取本机与云端素材…
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon="grid"
              title="这里还没有素材"
              description="去贴纸工坊导入一张图片，抠出第一张贴纸；加入作品后它会同时出现在云端。"
              action={
                <Link to="/sticker">
                  <Button size="sm" variant="primary" icon="image">
                    打开贴纸工坊
                  </Button>
                </Link>
              }
            />
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {rows.map((row) => {
                const key = `${row.scope}:${row.id}`;
                const active = selected.has(key);
                return (
                  <div
                    key={key}
                    className={cn(
                      "overflow-hidden rounded-lg border bg-ink-2",
                      active ? "border-neon/70" : row.id === focusId ? "border-electric/80 ring-1 ring-electric/40" : "border-line",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => toggle(key)}
                      className="block w-full text-left"
                      aria-label={`选择 ${row.name}`}
                    >
                      <div className="checker relative flex aspect-square items-center justify-center bg-ink-3">
                        {row.scope === "local" && row.kind === "sticker" && thumbs[row.id] ? (
                          <img src={thumbs[row.id]} alt="" className="h-full w-full object-contain" />
                        ) : row.scope === "cloud" && (row.kind === "image" || row.kind === "video") ? (
                          row.kind === "video" ? (
                            <video src={row.asset.url} className="h-full w-full object-cover" muted />
                          ) : (
                            <img src={row.asset.url} alt="" className="h-full w-full object-contain" loading="lazy" />
                          )
                        ) : (
                          <Icon
                            name={row.kind === "audio" ? "music" : row.kind === "source" ? "image" : "layers"}
                            size={18}
                            className="text-mute"
                          />
                        )}
                        <span
                          className={cn(
                            "absolute left-1 top-1 rounded px-1 py-0.5 text-[8.5px] font-semibold",
                            row.scope === "cloud" ? "bg-electric/80 text-ink" : "bg-ink/85 text-neon",
                          )}
                        >
                          {row.scope === "cloud" ? "云端" : "本机"}
                        </span>
                      </div>
                    </button>
                    <div className="p-1.5">
                      <p className="truncate text-[10px]" title={row.name}>
                        {row.name}
                      </p>
                      <p className="text-[9px] text-mute">
                        {formatBytes(row.byteSize)}
                        {row.width && row.height ? ` · ${row.width}×${row.height}` : ""}
                      </p>
                      <div className="mt-1 flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => void downloadOne(row)}
                          className="flex-1 rounded border border-line px-1 py-0.5 text-[9px] text-mute hover:text-paper"
                        >
                          下载
                        </button>
                        {row.scope === "cloud" ? (
                          <button
                            type="button"
                            onClick={async () => {
                              if (!confirm(`删除云端素材「${row.name}」？已发布作品可能因此破图。`)) return;
                              try {
                                await removeCloud(row.id);
                                toast("已删除云端素材", "success");
                              } catch (error) {
                                toast(error instanceof Error ? error.message : "删除失败", "error");
                              }
                            }}
                            className="rounded border border-line px-1 py-0.5 text-[9px] text-mute hover:text-hot"
                          >
                            删除
                          </button>
                        ) : (
                          <Link
                            to="/sticker"
                            className="rounded border border-line px-1 py-0.5 text-[9px] text-mute hover:text-paper"
                          >
                            打开工坊
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {cloudHasMore ? (
          <div className="mt-3 flex justify-center">
            <Button size="sm" variant="secondary" disabled={cloudLoading} onClick={() => void loadCloud({ more: true })}>
              {cloudLoading ? "加载中…" : "加载更多云端素材"}
            </Button>
          </div>
        ) : null}
      </main>
    </div>
  );
}
