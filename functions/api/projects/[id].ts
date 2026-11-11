/// <reference types="@cloudflare/workers-types" />
import type { FunctionContext } from "../../_lib/http";
import { editorHash, fail, json } from "../../_lib/http";
import { normalizeForStorage, ValidationError } from "../../../src/lib/schema";
import { findProjectById, publicProject } from "../../_lib/projects";

function idOf(context: FunctionContext): string {
  const value = context.params.id;
  return Array.isArray(value) ? value[0] : (value ?? "");
}

export async function onRequestGet(context: FunctionContext): Promise<Response> {
  const owner = await editorHash(context.request);
  if (!owner) return fail(401, "unauthorized", "缺少有效的编辑器身份");
  const row = await findProjectById(context.env, idOf(context));
  if (!row || row.owner_hash !== owner) return fail(404, "not_found", "作品不存在或无权访问");
  return json({ project: publicProject(row) });
}

export async function onRequestPut(context: FunctionContext): Promise<Response> {
  const owner = await editorHash(context.request);
  if (!owner) return fail(401, "unauthorized", "缺少有效的编辑器身份");
  const id = idOf(context);
  const row = await findProjectById(context.env, id);
  if (!row || row.owner_hash !== owner) return fail(404, "not_found", "作品不存在或无权修改");

  let body: { data?: unknown; rev?: number; force?: boolean };
  try {
    body = (await context.request.json()) as typeof body;
  } catch {
    return fail(400, "bad_json", "请求格式不正确");
  }

  let jsonData: string;
  let title: string;
  let description: string;
  let incomingUpdatedAt = 0;
  try {
    const normalized = normalizeForStorage(body.data);
    jsonData = normalized.json;
    title = normalized.project.title;
    description = normalized.project.description;
    incomingUpdatedAt = normalized.project.updatedAt;
  } catch (error) {
    if (error instanceof ValidationError) return fail(400, "invalid_project", error.message);
    return fail(400, "invalid_project", "作品数据不合法");
  }

  let storedUpdatedAt = 0;
  try {
    storedUpdatedAt = Number((JSON.parse(row.data) as { updatedAt?: number }).updatedAt ?? 0);
  } catch {
    storedUpdatedAt = 0;
  }

  if (!body.force) {
    // Idempotent retry: the same document is already stored, so nothing to write.
    if (jsonData === row.data) return json({ rev: row.rev, updatedAt: row.updated_at });
    // Accept a save that is demonstrably newer than what is stored (a retry after
    // reload), but reject one that would roll the document back.
    if (incomingUpdatedAt < storedUpdatedAt) {
      return fail(409, "conflict", "这个作品在别处被修改过，请先同步最新版本");
    }
  }

  // Optimistic lock in SQL: two concurrent PUTs can both read the same rev, so the
  // version predicate has to live in the UPDATE itself, not only in this handler.
  const attempts = body.force ? 1 : 4;
  let current = row;
  try {
    for (let attempt = 0; attempt < attempts; attempt++) {
      const now = Date.now();
      const nextRev = current.rev + 1;
      const result = body.force
        ? await context.env.DB.prepare(
            "UPDATE projects SET data = ?, title = ?, description = ?, rev = rev + 1, updated_at = ? WHERE id = ? AND owner_hash = ?",
          )
            .bind(jsonData, title, description, now, id, owner)
            .run()
        : await context.env.DB.prepare(
            "UPDATE projects SET data = ?, title = ?, description = ?, rev = ?, updated_at = ? WHERE id = ? AND owner_hash = ? AND rev = ?",
          )
            .bind(jsonData, title, description, nextRev, now, id, owner, current.rev)
            .run();

      if ((result.meta?.changes ?? 0) > 0) {
        if (body.force) {
          const fresh = await findProjectById(context.env, id);
          return json({ rev: fresh?.rev ?? nextRev, updatedAt: now });
        }
        return json({ rev: nextRev, updatedAt: now });
      }

      // Somebody else advanced rev between our read and this write.
      const fresh = await findProjectById(context.env, id);
      if (!fresh) return fail(404, "not_found", "作品不存在或无权修改");
      if (fresh.data === jsonData) return json({ rev: fresh.rev, updatedAt: fresh.updated_at });
      current = fresh;
    }
    return fail(409, "conflict", "这个作品在别处被修改过，请先同步最新版本");
  } catch (error) {
    console.error("save project failed", error);
    return fail(500, "internal", "保存失败，本地草稿已保留");
  }
}

export async function onRequestDelete(context: FunctionContext): Promise<Response> {
  const owner = await editorHash(context.request);
  if (!owner) return fail(401, "unauthorized", "缺少有效的编辑器身份");
  const id = idOf(context);
  try {
    await context.env.DB.prepare("DELETE FROM projects WHERE id = ? AND owner_hash = ?").bind(id, owner).run();
    return json({ ok: true });
  } catch (error) {
    console.error("delete project failed", error);
    return fail(500, "internal", "删除失败");
  }
}
