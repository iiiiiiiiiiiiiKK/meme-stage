/// <reference types="@cloudflare/workers-types" />
import type { FunctionContext } from "../../_lib/http";
import { fail } from "../../_lib/http";
import type { AssetRow } from "../../_lib/projects";

function parseRange(header: string | null, size: number): { offset: number; length: number } | null {
  if (!header) return null;
  const match = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;
  const start = match[1] === "" ? null : Number(match[1]);
  const end = match[2] === "" ? null : Number(match[2]);
  if (start === null && end === null) return null;
  const from = start ?? Math.max(0, size - (end ?? 0));
  const to = end ?? size - 1;
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || from >= size || to < from) return null;
  return { offset: from, length: Math.min(size, to + 1) - from };
}

export async function onRequest(context: FunctionContext): Promise<Response> {
  const value = context.params.id;
  const id = Array.isArray(value) ? value[0] : (value ?? "");
  if (!/^[a-f0-9-]{20,40}$/i.test(id)) return fail(404, "not_found", "文件不存在");

  const row = await context.env.DB.prepare("SELECT * FROM assets WHERE id = ?")
    .bind(id)
    .first<AssetRow>();
  if (!row) return fail(404, "not_found", "文件不存在");

  const rangeHeader = context.request.headers.get("range");
  const range = parseRange(rangeHeader, row.size);

  const object = await context.env.BUCKET.get(
    row.object_key,
    range ? { range: { offset: range.offset, length: range.length } } : undefined,
  );
  if (!object) return fail(404, "not_found", "文件已被删除");

  const headers = new Headers({
    "content-type": row.mime,
    "cache-control": "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
    "content-disposition": "inline",
    "accept-ranges": "bytes",
    "access-control-allow-origin": "*",
  });
  if (row.mime.startsWith("image/")) {
    headers.set("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  }

  if (range) {
    headers.set("content-range", `bytes ${range.offset}-${range.offset + range.length - 1}/${row.size}`);
    headers.set("content-length", String(range.length));
    if (context.request.method === "HEAD") return new Response(null, { status: 206, headers });
    return new Response(object.body, { status: 206, headers });
  }

  headers.set("content-length", String(row.size));
  if (context.request.method === "HEAD") return new Response(null, { status: 200, headers });
  return new Response(object.body, { status: 200, headers });
}
