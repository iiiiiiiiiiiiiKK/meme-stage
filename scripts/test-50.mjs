import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const base = process.argv[2] || "https://meme-stage.pages.dev";
const dir = path.resolve("tests/fixtures/people");
const files = fs.readdirSync(dir).slice(0, 50).map((f) => path.join(dir, f));
const results = {};

const draftOf = (page) =>
  page.evaluate(() => {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith("ms.draft.") && k !== "ms.draft.index");
    const items = keys.map((k) => {
      try {
        return JSON.parse(localStorage.getItem(k));
      } catch {
        return null;
      }
    });
    return items.filter(Boolean).sort((a, b) => b.savedAt - a.savedAt)[0];
  });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 160)));
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`${base}/editor`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="canvas"] canvas');

await page.getByRole("button", { name: "批量导入人物" }).click();
await page.locator('[role="dialog"] input[type="file"]').setInputFiles(files);
await page.waitForFunction(
  () => {
    const d = document.querySelector('[role="dialog"]');
    const btn = [...(d?.querySelectorAll("button") ?? [])].find((b) => b.textContent.includes("导入 50 个人物"));
    return !!btn && !btn.disabled;
  },
  { timeout: 240000 },
);
const started = Date.now();
await page.getByRole("button", { name: /导入 50 个人物/ }).click();
await page.waitForSelector('[role="dialog"]', { state: "detached", timeout: 300000 });
results.importSeconds = Math.round((Date.now() - started) / 1000);
await page.waitForTimeout(1600);
const draft = await draftOf(page);
results.elements = draft.project.elements.length;
results.unique = new Set(draft.project.elements.map((e) => `${e.x},${e.y}`)).size;
results.inFrame = draft.project.elements.every(
  (e) => e.x >= 0 && e.y >= 0 && e.x + e.width <= draft.project.width && e.y + e.height <= draft.project.height,
);
const countText = await page.locator('[data-testid="canvas"]').innerText();
results.badge = (countText.match(/(\d+) 个人物/) ?? [])[1];
await page.screenshot({ path: "shots/editor-50.png" });

const canvasBox = await page.locator('[data-testid="canvas"]').boundingBox();
const zoomLabel = page.locator('[data-testid="canvas"] button[title="重置为 100%"]');
const before = await zoomLabel.textContent();
const t0 = Date.now();
for (let i = 0; i < 12; i++) {
  await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  await page.mouse.wheel(0, i < 6 ? -180 : 180);
}
await page.waitForTimeout(500);
results.zoom12Ms = Date.now() - t0;
results.zoom = [before, await zoomLabel.textContent()];

// drag one element after focusing it from the list
await page.getByRole("button", { name: /person-01/ }).first().click();
await page.waitForTimeout(600);
const c2 = await page.locator('[data-testid="canvas"]').boundingBox();
const b0 = (await draftOf(page)).project.elements.find((e) => e.character?.name === "person-01");
await page.mouse.move(c2.x + c2.width / 2, c2.y + c2.height / 2);
await page.mouse.down();
await page.mouse.move(c2.x + c2.width / 2 + 80, c2.y + c2.height / 2 + 40, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(900);
const b1 = (await draftOf(page)).project.elements.find((e) => e.character?.name === "person-01");
results.dragDelta = [b1.x - b0.x, b1.y - b0.y];
results.errors = errors;
console.log(JSON.stringify(results, null, 2));
await browser.close();
