// Confirms /api/files/:id redirects to the configured image host and that the
// stored row carries real pixel dimensions.
const base = "https://meme-stage.pages.dev";
const key = [...crypto.getRandomValues(new Uint8Array(32))]
  .map((b) => b.toString(16).padStart(2, "0"))
  .join("");

const started = Date.now();
const res = await fetch(`${base}/api/ai/generate`, {
  method: "POST",
  headers: { "content-type": "application/json", "X-Editor-Key": key },
  body: JSON.stringify({
    prompt: "a flat sticker of a green leaf, thick white outline, plain background, no text",
    model: "gpt-image-2.5",
    size: "1024x1024",
    name: "图床探测",
  }),
});
const payload = await res.json();
console.log("generate:", res.status, `${Math.round((Date.now() - started) / 1000)}s`);
console.log("asset:", {
  url: payload.asset?.url,
  width: payload.asset?.width,
  height: payload.asset?.height,
  size: payload.asset?.size,
  mime: payload.asset?.mime,
});

if (payload.asset?.url) {
  const direct = await fetch(`${base}${payload.asset.url}`, { redirect: "manual" });
  console.log("file endpoint:", direct.status, "location:", direct.headers.get("location")?.slice(0, 70));
  const followed = await fetch(`${base}${payload.asset.url}`);
  const bytes = await followed.arrayBuffer();
  console.log("followed:", followed.status, followed.headers.get("content-type"), bytes.byteLength);
}

// asset list should report the same dimensions
const list = await fetch(`${base}/api/assets?limit=3`, { headers: { "X-Editor-Key": key } });
const listed = await list.json();
console.log(
  "listed:",
  (listed.assets ?? []).map((a) => ({ name: a.name, w: a.width, h: a.height, size: a.size })),
);

// delete must succeed for an externally hosted asset too
if (payload.asset?.id) {
  const del = await fetch(`${base}/api/assets/${payload.asset.id}`, {
    method: "DELETE",
    headers: { "X-Editor-Key": key },
  });
  console.log("delete:", del.status, JSON.stringify(await del.json()));
}
