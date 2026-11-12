import { Route, Routes } from "react-router-dom";
import { StickerStudio } from "../features/sticker/StickerStudio";
import { BatchQueue } from "../features/sticker/BatchQueue";
import { Link } from "react-router-dom";
import { Icon } from "../components/Icon";

const TABS = [
  { to: "/studio/sticker", label: "贴纸工坊", icon: "image" as const },
  { to: "/studio/batch", label: "批量工坊", icon: "grid" as const },
];

/** Shell for the sticker tools: a thin tab bar over the full-height workbench. */
export function StudioPage() {
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
        {TABS.map((tab) => (
          <Link
            key={tab.to}
            to={tab.to}
            className="flex items-center gap-1 rounded px-2 py-1 text-[11.5px] font-semibold text-mute hover:text-paper"
          >
            <Icon name={tab.icon} size={12} />
            {tab.label}
          </Link>
        ))}
        <div className="ml-auto flex items-center gap-1.5 text-[10px] text-mute">
          <span className="rounded border border-line px-1.5 py-0.5">本机处理</span>
          <Link to="/assets" className="hover:text-paper">
            素材库
          </Link>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">
        <Routes>
          <Route path="sticker" element={<StickerStudio />} />
          <Route path="batch" element={<BatchQueue />} />
          <Route path="*" element={<StickerStudio />} />
        </Routes>
      </div>
    </div>
  );
}
