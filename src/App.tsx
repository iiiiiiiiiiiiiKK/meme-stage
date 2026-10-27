import { useEffect } from "react";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { LandingPage } from "./pages/Landing";
import { EditorPage } from "./pages/Editor";
import { PublishedPage } from "./pages/Published";
import { LibraryPage } from "./pages/Library";
import { Toaster } from "./components/ui";

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function NotFound() {
  return (
    <div className="grid min-h-full place-items-center bg-ink px-6">
      <div className="text-center">
        <div className="font-display text-6xl text-neon">404</div>
        <h1 className="mt-3 font-display text-2xl">这一格是空的</h1>
        <p className="mt-2 text-[12px] text-mute">画布里没有这个页面。</p>
        <a
          href="/"
          className="mt-5 inline-flex h-10 items-center rounded-lg border-2 border-ink bg-neon px-4 text-[13px] font-bold text-ink"
        >
          回首页
        </a>
      </div>
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/editor" element={<EditorPage />} />
        <Route path="/editor/:id" element={<EditorPage />} />
        <Route path="/p/:slug" element={<PublishedPage />} />
        <Route path="/library" element={<LibraryPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      <Toaster />
    </BrowserRouter>
  );
}
