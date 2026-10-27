import { webkit, devices } from "@playwright/test";

const base = process.argv[2] || "https://meme-stage.pages.dev";
const browser = await webkit.launch();
const context = await browser.newContext({ ...devices["iPhone 13"], ignoreHTTPSErrors: true });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 120)));
await page.addInitScript(() => {
  window.__played = [];
  HTMLMediaElement.prototype.play = function () {
    window.__played.push(this.currentSrc || this.src);
    setTimeout(() => this.dispatchEvent(new Event("ended")), 120);
    return Promise.resolve();
  };
  HTMLMediaElement.prototype.pause = function () {};
});
await page.goto(`${base}/p/demo`, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForSelector('[data-testid="visitor"] canvas', { timeout: 30000 });
await page.waitForTimeout(700);
const box = await page.locator('[data-testid="visitor"]').boundingBox();
const scale = Math.min((box.width - 48) / 1600, (box.height - 48) / 900, 1.4);
const x = box.x + (box.width - 1600 * scale) / 2 + 245 * scale;
const y = box.y + (box.height - 900 * scale) / 2 + 600 * scale;
await page.touchscreen.tap(x, y);
await page.waitForTimeout(1200);
const text = await page.locator("body").innerText();
console.log("webkit ok", {
  overflow: await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  played: await page.evaluate(() => window.__played),
  bubble: text.includes("这波真的不亏"),
  errors,
});
await page.screenshot({ path: "shots/safari-mobile.png" });
await browser.close();
