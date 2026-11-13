import { Link, Route, Routes, useLocation } from "react-router-dom";
import { StickerStudio } from "../features/sticker/StickerStudio";
import { BatchQueue } from "../features/sticker/BatchQueue";
import { Icon } from "../components/Icon";
import { cn } from "../components/ui";

const TABS = [
  { to: "/sticker", label: "单张制作", icon: "image" as const },
  { to: "/sticker/batch", label: "批量制作", icon: "grid" as const },
];

/**
 * STICKER — the standalone sticker workshop.
 *
 * Its own product surface rather than a tab inside the editor: import a photo, let
 * the local pipeline (and optionally the user's own AI key) turn it into a
 * transparent sticker, then push the result into the MEME STAGE asset library.
 * Everything heavy runs in this browser, so there is no server key and no queue.
 */
export function StudioPage() {
  const { pathname } = useLocation();

  return (
    <div className="flex h-dvh flex-col bg-ink">
      <header className="flex shrink-0 items-center gap-2 border-b border-line bg-ink px-3 py-2">
        <Link to="/" className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center border-2 border-ink bg-neon font-display text-[13px] text-ink">
            M
          </span>
          <span className="font-display text-[14px]">
            MEME<span className="text-neon">STAGE</span>
          </span>
        </Link>
        <span className="mx-1 h-4 w-px bg-line" />
        <span className="flex items-center gap-1 font-display text-[13px] tracking-tight text-paper">
          <Icon name="sparkles" size={12} className="text-neon" />
          STICKER
        </span>
        <div className="ml-2 flex items-center gap-1">
          {TABS.map((tab) => {
            const active = pathname === tab.to;
            return (
              <Link
                key={tab.to}
                to={tab.to}
                className={cn(
                  "flex items-center gap-1 rounded px-2 py-1 text-[11.5px] font-semibold",
                  active ? "bg-neon/15 text-neon" : "text-mute hover:text-paper",
                )}
              >
                <Icon name={tab.icon} size={12} />
                {tab.label}
              </Link>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-1.5 text-[10px] text-mute">
          <span className="rounded border border-line px-1.5 py-0.5">本机处理</span>
          <Link to="/assets" className="hover:text-paper">
            素材库
          </Link>
          <Link to="/editor" className="hover:text-paper">
            编辑器
          </Link>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">
        <Routes>
          <Route path="/" element={<StickerStudio />} />
          <Route path="/batch" element={<BatchQueue />} />
          <Route path="*" element={<StickerStudio />} />
        </Routes>
      </div>
    </div>
  );
}
