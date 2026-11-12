/// <reference types="@cloudflare/workers-types" />
import type { FunctionContext } from "./_lib/http";

/**
 * Image generation runs in the visitor's browser with their own key, so the page
 * has to be allowed to reach the gateway and the CDN that serves the result. Those
 * are the only cross-origin endpoints the app talks to; everything else stays
 * same-origin.
 */
const AI_GATEWAY = "https://agent3.shyfai.cn";
const AI_CDN = "https://*.fycsai.com";

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${AI_CDN}`,
  "media-src 'self' blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${AI_GATEWAY} ${AI_CDN}`,
  "worker-src 'self' blob:",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

export async function onRequest(context: FunctionContext): Promise<Response> {
  const url = new URL(context.request.url);
  const method = context.request.method.toUpperCase();

  // block cross-site writes even though the API is same-origin only
  if (url.pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(method)) {
    const origin = context.request.headers.get("origin");
    if (origin) {
      try {
        if (new URL(origin).host !== url.host) {
          return new Response(JSON.stringify({ error: "forbidden", message: "跨站请求已被拒绝" }), {
            status: 403,
            headers: { "content-type": "application/json" },
          });
        }
      } catch {
        return new Response(JSON.stringify({ error: "forbidden", message: "非法来源" }), {
          status: 403,
          headers: { "content-type": "application/json" },
        });
      }
    }
  }

  const response = await context.next();
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", CSP);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Frame-Options", "SAMEORIGIN");
  headers.set("Permissions-Policy", "camera=(), microphone=(self), geolocation=(), payment=()");
  if (url.protocol === "https:") {
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
