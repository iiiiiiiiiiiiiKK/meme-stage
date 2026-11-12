import { chromium } from "@playwright/test";

// Verifies the animated-media overlay on a *published* page by building the
// project through the real API, so nothing here depends on editor internals.
const base = "https://meme-stage.pages.dev";
const key = [...crypto.getRandomValues(new Uint8Array(32))]
  .map((b) => b.toString(16).padStart(2, "0"))
  .join("");
const headers = { "X-Editor-Key": key, "content-type": "application/json" };

const GIF_B64 =
  "R0lGODlhAQABAIAAAAAAAP///yH/C05FVFNDQVBFMi4wAwEAAAAh+QQFCgABACwAAAAAAQABAAACAkQBACH5BAUKAAEALAAAAAABAAEAAAICRAEAOw==";

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 160)));

await page.goto(base, { waitUntil: "domcontentloaded" });

// upload the gif through the same FormData endpoint the editor uses
const uploaded = await page.evaluate(
  async ({ b64, key }) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: "image/gif" }), "boom.gif");
    form.append("kind", "image");
    form.append("name", "boom.gif");
    form.append("width", "1");
    form.append("height", "1");
    const res = await fetch("/api/assets", {
      method: "POST",
      headers: { "X-Editor-Key": key },
      body: form,
    });
    return { status: res.status, body: await res.json() };
  },
  { b64: GIF_B64, key },
);
console.log("gif upload:", uploaded.status, uploaded.body.asset?.mime, uploaded.body.asset?.url);
const gifUrl = uploaded.body.asset?.url;

const project = {
  version: 1,
  title: "动图舞台测试",
  description: "",
  mode: "preset",
  width: 1200,
  height: 800,
  background: { type: "color", color: "#0b0b12" },
  elements: [
    {
      id: "md_test",
      type: "image",
      x: 200,
      y: 150,
      width: 300,
      height: 300,
      rotation: 0,
      z: 5,
      opacity: 1,
      locked: false,
      hidden: false,
      flipX: false,
      flipY: false,
      image: { url: gifUrl, name: "boom.gif", animated: "gif" },
    },
  ],
  events: [],
  performances: [],
  settings: {
    audioMode: "single",
    reactions: true,
    showAuthor: true,
    allowRemix: true,
    authorName: "",
    soundHint: "轻点人物，听他们开口",
    showPlayButton: true,
  },
  updatedAt: Date.now(),
};

const created = await fetch(`${base}/api/projects`, {
  method: "POST",
  headers,
  body: JSON.stringify({ data: project }),
}).then((r) => r.json());
const published = await fetch(`${base}/api/projects/${created.id}/publish`, {
  method: "POST",
  headers,
  body: JSON.stringify({ data: project }),
}).then((r) => r.json());
console.log("published:", published.slug);

await page.goto(`${base}/p/${published.slug}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="visitor"] canvas');
await page.waitForTimeout(1500);
const overlays = await page.locator('[data-testid="animated-media"]').count();
const box = await page.locator('[data-testid="animated-media"]').first().boundingBox().catch(() => null);
const tag = await page
  .locator('[data-testid="animated-media"] img')
  .first()
  .evaluate((el) => ({ tag: el.tagName, src: el.getAttribute("src") }))
  .catch(() => null);
console.log("overlays:", overlays, "box:", box && { w: Math.round(box.width), h: Math.round(box.height) }, "tag:", tag);
await page.screenshot({ path: "shots/animated-media.png" });

// clean up the probe project and asset
await fetch(`${base}/api/projects/${created.id}`, { method: "DELETE", headers });
await fetch(`${base}/api/assets/${uploaded.body.asset.id}`, { method: "DELETE", headers });
console.log("errors", errors.slice(0, 4));
await browser.close();
