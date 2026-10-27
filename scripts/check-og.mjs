// Smoke check for the published demo: OG tags + cover reachability.
const base = (process.argv[2] || "https://meme-stage.pages.dev").replace(/\/$/, "");
const res = await fetch(`${base}/p/demo`);
const html = await res.text();
console.log("status", res.status);
for (const match of html.match(/<meta property="og:[^>]+>/g) ?? []) console.log(match);
console.log("title:", (html.match(/<title>[^<]+<\/title>/) ?? [""])[0]);
const image = html.match(/og:image" content="([^"]+)/);
if (image) {
  const cover = await fetch(image[1]);
  console.log("cover", cover.status, cover.headers.get("content-type"), cover.headers.get("content-length"));
} else {
  console.log("no og:image");
}
const api = await fetch(`${base}/api/public/demo`).then((r) => r.json());
console.log("api elements:", api?.project?.data?.elements?.length, "events:", api?.project?.data?.events?.length);
