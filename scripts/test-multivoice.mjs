import { chromium } from "@playwright/test";

const base = process.argv[2] || "https://meme-stage.pages.dev";
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 160)));
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => {
  window.__played = [];
  HTMLMediaElement.prototype.play = function () {
    window.__played.push(this.currentSrc || this.src);
    setTimeout(() => this.dispatchEvent(new Event("ended")), 110);
    return Promise.resolve();
  };
  HTMLMediaElement.prototype.pause = function () {};
});

await page.goto(`${base}/p/demo`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="visitor"] canvas');
const box = await page.locator('[data-testid="visitor"]').boundingBox();
const scale = Math.min((box.width - 48) / 1600, (box.height - 48) / 900, 1.4);
const ox = box.x + (box.width - 1600 * scale) / 2;
const oy = box.y + (box.height - 900 * scale) / 2;
const catX = ox + 1380 * scale;
const catY = oy + 630 * scale;

const texts = [];
for (let i = 0; i < 3; i++) {
  await page.mouse.click(catX, catY);
  await page.waitForTimeout(700);
  const body = await page.locator("body").innerText();
  texts.push(["喵。听不懂，但是喵。", "别问我，我只是一只猫。", "这个家没有我，早就散了。"].filter((t) => body.includes(t)));
}

const played = await page.evaluate(() => window.__played);
const catClips = played.filter((url) => /voice-cat/.test(url)).map((url) => url.split("/").pop());
console.log(JSON.stringify({ played, catClips, distinct: [...new Set(catClips)], texts, errors }, null, 2));
await page.screenshot({ path: "shots/demo-multivoice.png" });
await browser.close();
