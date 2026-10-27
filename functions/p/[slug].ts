/// <reference types="@cloudflare/workers-types" />
import type { FunctionContext } from "../_lib/http";
import { escapeHtml } from "../_lib/http";
import { findPublicBySlug, metaTags } from "../_lib/projects";

/**
 * Serves the SPA shell for /p/:slug with per-project Open Graph tags so links
 * unfurl properly on X, WeChat, Telegram and iMessage.
 */
export async function onRequestGet(context: FunctionContext): Promise<Response> {
  const url = new URL(context.request.url);
  const value = context.params.slug;
  const slug = Array.isArray(value) ? value[0] : (value ?? "");

  let html: string;
  try {
    const shell = await context.env.ASSETS.fetch(new URL("/index.html", url).toString());
    html = await shell.text();
  } catch {
    return context.next();
  }

  let row = null;
  try {
    row = slug ? await findPublicBySlug(context.env, slug) : null;
  } catch (error) {
    console.error("og lookup failed", error);
  }

  const cover = row?.cover_url ? new URL(row.cover_url, url.origin).toString() : null;
  const meta = metaTags({
    title: row ? `${row.title} · MEME STAGE` : "作品不存在 · MEME STAGE",
    description: row?.description || "点击人物，听他们开口。用 MEME STAGE 做的互动 Meme。",
    image: cover,
    url: `${url.origin}/p/${slug}`,
    index: !!row,
  });

  html = html.replace(/<!--OG_META_START-->[\s\S]*?<!--OG_META_END-->/, meta);
  if (row) {
    html = html.replace(/<title>.*?<\/title>/s, `<title>${escapeHtml(row.title)} · MEME STAGE</title>`);
  }

  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=30, stale-while-revalidate=120",
    },
  });
}
