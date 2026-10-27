/// <reference types="@cloudflare/workers-types" />
import type { FunctionContext } from "../../_lib/http";
import { fail, json } from "../../_lib/http";
import { findPublicBySlug, publicProject } from "../../_lib/projects";

export async function onRequestGet(context: FunctionContext): Promise<Response> {
  const value = context.params.slug;
  const slug = Array.isArray(value) ? value[0] : (value ?? "");
  if (!slug || slug.length > 80) return fail(404, "not_found", "作品不存在或尚未发布");
  try {
    const row = await findPublicBySlug(context.env, slug);
    if (!row) return fail(404, "not_found", "作品不存在或尚未发布");
    return json({ project: publicProject(row) }, 200, {
      "cache-control": "public, max-age=20, stale-while-revalidate=40",
    });
  } catch (error) {
    console.error("public project failed", error);
    return fail(500, "internal", "加载作品失败");
  }
}
