import { chromium } from "@playwright/test";

const base = process.argv[2] || "https://meme-stage.pages.dev";
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
await page.addInitScript(() => {
  window.__played = [];
  HTMLMediaElement.prototype.play = function () {
    window.__played.push(this.currentSrc || this.src);
    setTimeout(() => this.dispatchEvent(new Event("ended")), 90);
    return Promise.resolve();
  };
  HTMLMediaElement.prototype.pause = function () {};
});

await page.goto(`${base}/p/demo`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
const box = await page.locator('[data-testid="visitor"]').boundingBox();
console.log("visitor box", box);
const scale = Math.min((box.width - 48) / 1600, (box.height - 48) / 900);
const originX = box.x + (box.width - 1600 * scale) / 2;
const originY = box.y + (box.height - 900 * scale) / 2;
const target = { x: originX + 245 * scale, y: originY + 600 * scale };
console.log("click", target);
await page.mouse.click(target.x, target.y);
await page.waitForTimeout(700);
console.log("played", await page.evaluate(() => window.__played));
const text = await page.locator("body").innerText();
console.log("bubble visible:", text.includes("兄弟们"));
console.log("bubble text sample:", text.includes("这波真的不亏"));
await page.waitForTimeout(3200);
console.log("played after chain", await page.evaluate(() => window.__played));
await page.screenshot({ path: "shots/published-demo.png" });
console.log("errors", errors);
await browser.close();
