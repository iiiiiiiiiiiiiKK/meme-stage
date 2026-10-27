import { chromium } from "@playwright/test";

const base = process.argv[2] || "https://meme-stage.pages.dev";
const results = {};

// --- security / API checks -------------------------------------------------
const seed = JSON.parse(await import("node:fs").then((fs) => fs.readFileSync(".seed/seed.json", "utf8")));
const demo = await fetch(`${base}/api/projects/${seed.id}`, {
  headers: { "X-Editor-Key": "f".repeat(64) },
});
results.privateProjectWithWrongKey = demo.status;

const textFile = new FormData();
textFile.append("file", new Blob(["not an image"], { type: "image/png" }), "evil.png");
textFile.append("kind", "image");
const badUpload = await fetch(`${base}/api/assets`, {
  method: "POST",
  headers: { "X-Editor-Key": "f".repeat(64) },
  body: textFile,
});
results.uploadWithoutAuth = badUpload.status;

const badUpload2 = new FormData();
badUpload2.append("file", new Blob(["<script>alert(1)</script>"], { type: "image/png" }), "evil.png");
badUpload2.append("kind", "image");
const bad2 = await fetch(`${base}/api/assets`, {
  method: "POST",
  headers: { "X-Editor-Key": seed.key },
  body: badUpload2,
});
results.fakeImageRejected = bad2.status;

const traversal = await fetch(`${base}/api/files/..%2f..%2fsecret`);
results.badFileId = traversal.status;

const publishMissing = await fetch(`${base}/api/projects/00000000-0000-0000-0000-000000000000/publish`, {
  method: "POST",
  headers: { "X-Editor-Key": seed.key, "content-type": "application/json" },
  body: JSON.stringify({ data: {} }),
});
results.publishUnknownProject = publishMissing.status;

// --- OG for the official demo ---------------------------------------------
const demoPage = await fetch(`${base}/p/demo`).then((r) => r.text());
results.ogTitle = /og:title" content="([^"]+)/.exec(demoPage)?.[1];
results.ogImage = /og:image" content="([^"]+)/.exec(demoPage)?.[1] ? true : false;

// --- mobile landing --------------------------------------------------------
const browser = await chromium.launch();
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const mp = await mobile.newPage();
const mErrors = [];
mp.on("console", (m) => m.type() === "error" && mErrors.push(m.text().slice(0, 150)));
mp.on("pageerror", (e) => mErrors.push(e.message));
await mp.addInitScript(() => {
  window.__played = [];
  HTMLMediaElement.prototype.play = function () {
    window.__played.push(this.currentSrc || this.src);
    setTimeout(() => this.dispatchEvent(new Event("ended")), 120);
    return Promise.resolve();
  };
  HTMLMediaElement.prototype.pause = function () {};
});
await mp.goto(`${base}/`, { waitUntil: "domcontentloaded" });
await mp.waitForSelector('[data-testid="visitor"] canvas', { timeout: 30000 });
await mp.waitForTimeout(600);
results.mobileLandingOverflow = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const heroBox = await mp.locator('[data-testid="visitor"]').boundingBox();
const scale = Math.min((heroBox.width - 24) / 1600, (heroBox.height - 24) / 900, 1.4);
const ox = heroBox.x + (heroBox.width - 1600 * scale) / 2;
const oy = heroBox.y + (heroBox.height - 900 * scale) / 2;
await mp.touchscreen.tap(ox + 245 * scale, oy + 600 * scale);
await mp.waitForTimeout(900);
results.heroTapAudio = await mp.evaluate(() => window.__played);
results.heroBubble = (await mp.locator("body").innerText()).includes("这波真的不亏");
await mp.screenshot({ path: "shots/mobile-home.png", fullPage: false });
await mp.screenshot({ path: "shots/mobile-home-full.png", fullPage: true });

// --- desktop landing -------------------------------------------------------
const desktop = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
const dp = await desktop.newPage();
const dErrors = [];
dp.on("console", (m) => m.type() === "error" && dErrors.push(m.text().slice(0, 150)));
dp.on("pageerror", (e) => dErrors.push(e.message));
await dp.goto(`${base}/`, { waitUntil: "domcontentloaded" });
await dp.waitForSelector('[data-testid="visitor"] canvas');
await dp.waitForTimeout(1200);
await dp.screenshot({ path: "shots/home-desktop.png", fullPage: false });
await dp.screenshot({ path: "shots/home-desktop-full.png", fullPage: true });
results.desktopOverflow = await dp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
results.mErrors = mErrors;
results.dErrors = dErrors;

console.log(JSON.stringify(results, null, 2));
await browser.close();
