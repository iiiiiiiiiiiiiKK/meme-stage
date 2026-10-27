/// <reference types="@cloudflare/workers-types" />

export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  ASSETS: Fetcher;
  AI: Ai;
  ENVIRONMENT?: string;
}

export interface FunctionContext {
  request: Request;
  env: Env;
  params: Record<string, string | string[]>;
  next: () => Promise<Response>;
  waitUntil: (promise: Promise<unknown>) => void;
  data: Record<string, unknown>;
}

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  });
}

export function fail(status: number, code: string, message: string, headers: Record<string, string> = {}): Response {
  return json({ error: code, message }, status, headers);
}

export async function sha256Hex(text: string): Promise<string> {
  const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

const KEY_RE = /^[a-f0-9]{64}$/;

/** capability-style auth: the browser keeps a 256-bit editor key, we only store its hash */
export async function editorHash(request: Request): Promise<string | null> {
  const key = request.headers.get("X-Editor-Key")?.trim().toLowerCase() ?? "";
  if (!KEY_RE.test(key)) return null;
  return sha256Hex(key);
}

export function clientIp(request: Request): string {
  return (
    request.headers.get("CF-Connecting-IP") ??
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ??
    "local"
  );
}

const buckets = new Map<string, { count: number; resetAt: number }>();

/** best-effort per-isolate limiter; D1 caps + size limits are the real guard rails */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = buckets.get(key);
  if (!entry || entry.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 5000) {
      for (const [k, v] of buckets) if (v.resetAt < now) buckets.delete(k);
    }
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count += 1;
  return true;
}

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch,
  );
}

export function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}
