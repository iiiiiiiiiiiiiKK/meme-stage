/// <reference types="@cloudflare/workers-types" />
import type { FunctionContext } from "./_lib/http";
import { metaTags } from "./_lib/projects";

/** Home page gets absolute Open Graph tags (crawlers reject relative images). */
export async function onRequestGet(context: FunctionContext): Promise<Response> {
  const url = new URL(context.request.url);
  try {
    const shell = await context.env.ASSETS.fetch(new URL("/index.html", url).toString());
    let html = await shell.text();
    const meta = metaTags({
      title: "MEME STAGE — 把二十个人塞进一张画布",
      description: "无限画布 · 批量导入人物 · 每人独立配音 · 点击就演。做一张能听、能玩、能分享的互动 Meme。",
      image: `${url.origin}/demo/cover.png`,
      url: `${url.origin}/`,
      index: true,
    });
    html = html.replace(/<!--OG_META_START-->[\s\S]*?<!--OG_META_END-->/, meta);
    return new Response(html, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=60",
      },
    });
  } catch {
    return context.next();
  }
}
