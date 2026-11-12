// Verifies the AI endpoints end-to-end against the deployed build.
// Uses the editor capability key the same way the browser does.
const base = "https://meme-stage.pages.dev";
const key = [...crypto.getRandomValues(new Uint8Array(32))]
  .map((b) => b.toString(16).padStart(2, "0"))
  .join("");

const cap = await fetch(`${base}/api/ai/capabilities`).then((r) => r.json());
console.log("capabilities:", cap);

const unauth = await fetch(`${base}/api/ai/generate`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ prompt: "x" }),
});
console.log("generate without key:", unauth.status, (await unauth.json()).error);

const started = Date.now();
const res = await fetch(`${base}/api/ai/generate`, {
  method: "POST",
  headers: { "content-type": "application/json", "X-Editor-Key": key },
  body: JSON.stringify({
    prompt: "a flat vector sticker of a smiling yellow cat head, thick white outline, transparent background, no text",
    model: "gpt-image-2.5",
    size: "1024x1024",
    background: "transparent",
    idempotencyKey: `probe-${Date.now()}`,
    name: "AI 猫头",
  }),
});
const payload = await res.json();
console.log("generate:", res.status, `${Math.round((Date.now() - started) / 1000)}s`);
console.log({
  requestId: payload.requestId,
  asset: payload.asset && { id: payload.asset.id, url: payload.asset.url, mime: payload.asset.mime, size: payload.asset.size },
  usage: payload.usage && { total: payload.usage.total_tokens },
});

if (payload.asset?.url) {
  const file = await fetch(`${base}${payload.asset.url}`);
  console.log("stored asset fetch:", file.status, file.headers.get("content-type"), (await file.arrayBuffer()).byteLength);
}

console.log("capabilities after:", await fetch(`${base}/api/ai/capabilities`).then((r) => r.json()));
