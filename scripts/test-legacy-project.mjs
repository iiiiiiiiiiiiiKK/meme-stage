import { chromium } from "@playwright/test";

const base = process.argv[2] || "https://meme-stage.pages.dev";
const slug = process.argv[3] || "person-01-20-1k2v";
const project = (await fetch(`${base}/api/public/${slug}`).then((r) => r.json())).project.data;
const target = project.elements.find((el) => el.character?.name === "person-01");
if (!target) throw new Error("person-01 not found");
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => {
  window.__played = [];
  HTMLMediaElement.prototype.play = function () {
    window.__played.push(this.currentSrc || this.src);
    setTimeout(() => this.dispatchEvent(new Event("ended")), 100);
    return Promise.resolve();
  };
  HTMLMediaElement.prototype.pause = function () {};
});
await page.goto(`${base}/p/${slug}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="visitor"] canvas');
const box = await page.locator('[data-testid="visitor"]').boundingBox();
const scale = Math.min((box.width - 48) / project.width, (box.height - 48) / project.height, 1.4);
const ox = box.x + (box.width - project.width * scale) / 2;
const oy = box.y + (box.height - project.height * scale) / 2;
await page.mouse.click(ox + (target.x + target.width / 2) * scale, oy + (target.y + target.height / 2) * scale);
await page.waitForTimeout(1200);
console.log(
  JSON.stringify(
    {
      target: [target.x, target.y, target.width, target.height],
      played: await page.evaluate(() => window.__played),
      bubble: (await page.locator("body").innerText()).includes("这波真的不亏"),
      errors,
    },
    null,
    2,
  ),
);
await browser.close();
