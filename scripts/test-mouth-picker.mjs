import { chromium } from "@playwright/test";

// Editor-side check for the mouth picker: click somewhere on the photo and the
// character's stored mouth anchor must follow that click.
const base = "https://meme-stage.pages.dev";
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 160)));

await page.goto(`${base}/editor`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="canvas"] canvas');
await page.getByRole("button", { name: "随机熟人" }).click();
await page.waitForTimeout(1400);

const picker = page.getByTestId("mouth-picker");
await expectVisible(picker);
// the inspector scrolls once assets finish loading, so anchor the click first
await picker.scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
const box = await picker.boundingBox();
console.log("picker box:", box && { w: Math.round(box.width), h: Math.round(box.height) });

// click at 30% across and 70% down — the stored anchor should match
await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.7);
await page.waitForTimeout(1200);

const mouth = await page.evaluate(() => {
  const keys = Object.keys(localStorage).filter((k) => k.startsWith("ms.draft.") && k !== "ms.draft.index");
  const items = keys.map((k) => JSON.parse(localStorage.getItem(k)));
  const p = items.sort((a, b) => b.savedAt - a.savedAt)[0].project;
  const el = p.elements.find((e) => e.type === "character");
  return el?.character?.mouth ?? null;
});
console.log("stored mouth:", mouth);
const okX = mouth && Math.abs(mouth.x - 0.3) < 0.06;
const okY = mouth && Math.abs(mouth.y - 0.7) < 0.06;
console.log("x follows the click:", okX);
console.log("y follows the click:", okY);
console.log("marked as custom:", mouth?.custom === true);

// reset returns to the derived default
await page.getByRole("button", { name: "恢复自动估算" }).click();
await page.waitForTimeout(1000);
const afterReset = await page.evaluate(() => {
  const keys = Object.keys(localStorage).filter((k) => k.startsWith("ms.draft.") && k !== "ms.draft.index");
  const items = keys.map((k) => JSON.parse(localStorage.getItem(k)));
  const p = items.sort((a, b) => b.savedAt - a.savedAt)[0].project;
  return p.elements.find((e) => e.type === "character")?.character?.mouth ?? null;
});
console.log("after reset:", afterReset);
console.log("errors", errors.slice(0, 4));
await browser.close();

async function expectVisible(locator) {
  for (let i = 0; i < 40; i++) {
    if (await locator.isVisible().catch(() => false)) return;
    await page.waitForTimeout(250);
  }
  throw new Error("mouth picker never appeared");
}
