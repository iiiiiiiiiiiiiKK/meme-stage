/// <reference types="@cloudflare/workers-types" />
import type { FunctionContext } from "../../_lib/http";
import { editorHash, fail, json } from "../../_lib/http";
import type { AssetRow } from "../../_lib/projects";

export async function onRequestDelete(context: FunctionContext): Promise<Response> {
  const owner = await editorHash(context.request);
  if (!owner) return fail(401, "unauthorized", "缺少有效的编辑器身份");
  const value = context.params.id;
  const id = Array.isArray(value) ? value[0] : (value ?? "");
  if (!/^[a-f0-9-]{20,40}$/i.test(id)) return fail(400, "bad_id", "素材 ID 不正确");

  try {
    const row = await context.env.DB.prepare("SELECT * FROM assets WHERE id = ? AND owner_hash = ?")
      .bind(id, owner)
      .first<AssetRow>();
    if (!row) return fail(404, "not_found", "素材不存在");
    if (row.kind === "cover") return fail(400, "cover_locked", "封面素材不能直接删除");
    await context.env.BUCKET.delete(row.object_key);
    await context.env.DB.prepare("DELETE FROM assets WHERE id = ? AND owner_hash = ?").bind(id, owner).run();
    return json({ ok: true });
  } catch (error) {
    console.error("delete asset failed", error);
    return fail(500, "internal", "删除失败");
  }
}
