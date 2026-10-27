import { chromium } from "@playwright/test";

const base = "https://meme-stage.pages.dev";
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.addInitScript(() => {
  window.__started = [];
  window.__lastPointer = 0;
  document.addEventListener("pointerdown", () => (window.__lastPointer = performance.now()), true);
  const original = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    const element = this;
    const calledAt = performance.now();
    const result = original.apply(this, arguments);
    Promise.resolve(result)
      .then(() => {
        window.__started.push({
          src: element.currentSrc || element.src,
          fromPointerMs: Math.round(performance.now() - (window.__lastPointer || calledAt)),
          fromPlayMs: Math.round(performance.now() - calledAt),
          readyState: element.readyState,
        });
      })
      .catch((error) => window.__started.push({ error: String(error), src: element.src }));
    return result;
  };
});

await page.goto(`${base}/p/demo`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="visitor"] canvas');
await page.waitForTimeout(2500);

const preloaded = await page.evaluate(() =>
  performance
    .getEntriesByType("resource")
    .filter((entry) => entry.name.endsWith(".wav"))
    .map((entry) => ({ file: entry.name.split("/").pop(), size: entry.transferSize })),
);
const audioReady = await page.evaluate(() =>
  Array.from(document.querySelectorAll("audio")).length,
);

const box = await page.locator('[data-testid="visitor"]').boundingBox();
const scale = Math.min((box.width - 48) / 1600, (box.height - 48) / 900, 1.4);
const ox = box.x + (box.width - 1600 * scale) / 2;
const oy = box.y + (box.height - 900 * scale) / 2;

async function clickAndMeasure(worldX, worldY) {
  const before = await page.evaluate(() => window.__started.length);
  await page.mouse.click(ox + worldX * scale, oy + worldY * scale);
  await page.waitForFunction((count) => window.__started.length > count, before, { timeout: 15000 });
  return await page.evaluate(() => window.__started[window.__started.length - 1]);
}

const first = await clickAndMeasure(245, 600); // 老K
await page.waitForTimeout(3400);
const second = await clickAndMeasure(1380, 630); // 猫猫头

console.log(
  JSON.stringify(
    {
      preloadedCount: preloaded.length,
      preloaded,
      audioElements: audioReady,
      first,
      second,
      errors,
    },
    null,
    2,
  ),
);
await browser.close();
