/// <reference types="@cloudflare/workers-types" />
import type { FunctionContext } from "../../_lib/http";
import { editorHash, fail, json, rateLimit, clientIp } from "../../_lib/http";
import { normalizeForStorage, ValidationError } from "../../../src/lib/schema";
import type { ProjectRow } from "../../_lib/projects";
import { summary } from "../../_lib/projects";

export async function onRequestGet(context: FunctionContext): Promise<Response> {
  const owner = await editorHash(context.request);
  if (!owner) return fail(401, "unauthorized", "缺少有效的编辑器身份");
  try {
    const result = await context.env.DB.prepare(
      "SELECT * FROM projects WHERE owner_hash = ? ORDER BY updated_at DESC LIMIT 60",
    )
      .bind(owner)
      .all<ProjectRow>();
    return json({ projects: (result.results ?? []).map(summary) });
  } catch (error) {
    console.error("list projects failed", error);
    return fail(500, "internal", "读取作品列表失败");
  }
}

export async function onRequestPost(context: FunctionContext): Promise<Response> {
  const owner = await editorHash(context.request);
  if (!owner) return fail(401, "unauthorized", "缺少有效的编辑器身份");
  if (!rateLimit(`create:${clientIp(context.request)}`, 30, 60_000)) {
    return fail(429, "rate_limited", "创建太频繁了，喝口水再来");
  }

  let body: { data?: unknown };
  try {
    body = (await context.request.json()) as { data?: unknown };
  } catch {
    return fail(400, "bad_json", "请求格式不正确");
  }

  let jsonData: string;
  let projectTitle: string;
  let description: string;
  try {
    const normalized = normalizeForStorage(body.data);
    jsonData = normalized.json;
    projectTitle = normalized.project.title;
    description = normalized.project.description;
  } catch (error) {
    if (error instanceof ValidationError) return fail(400, "invalid_project", error.message);
    return fail(400, "invalid_project", "作品数据不合法");
  }

  const id = crypto.randomUUID();
  const now = Date.now();
  try {
    await context.env.DB.prepare(
      `INSERT INTO projects (id, slug, owner_hash, title, description, data, cover_url, visibility, published, rev, views, created_at, updated_at)
       VALUES (?, NULL, ?, ?, ?, ?, NULL, 'private', 0, 1, 0, ?, ?)`,
    )
      .bind(id, owner, projectTitle, description, jsonData, now, now)
      .run();
    return json({ id, rev: 1, updatedAt: now }, 201);
  } catch (error) {
    console.error("create project failed", error);
    return fail(500, "internal", "保存失败，请稍后重试");
  }
}
