/// <reference types="@cloudflare/workers-types" />
import type { FunctionContext } from "../../../_lib/http";
import { clientIp, json, rateLimit } from "../../../_lib/http";
import { findPublicBySlug } from "../../../_lib/projects";

export async function onRequestPost(context: FunctionContext): Promise<Response> {
  const value = context.params.slug;
  const slug = Array.isArray(value) ? value[0] : (value ?? "");
  if (!slug) return json({ ok: false }, 400);
  if (!rateLimit(`view:${slug}:${clientIp(context.request)}`, 6, 60_000)) {
    return json({ ok: true, throttled: true });
  }
  try {
    const row = await findPublicBySlug(context.env, slug);
    if (!row) return json({ ok: false }, 404);
    await context.env.DB.prepare("UPDATE projects SET views = views + 1 WHERE id = ?").bind(row.id).run();
    return json({ ok: true });
  } catch {
    return json({ ok: false }, 200);
  }
}
