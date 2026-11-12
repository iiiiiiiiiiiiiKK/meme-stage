import { chromium } from "@playwright/test";

const base = "https://meme-stage.pages.dev";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("console", (m) => console.log("console:", m.type(), m.text().slice(0, 120)));
page.on("pageerror", (e) => console.log("pageerror:", e.message));

await page.goto(`${base}/editor`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="canvas"] canvas');
await page.getByRole("button", { name: "随机熟人" }).click();
await page.waitForTimeout(1500);

const picker = page.getByTestId("mouth-picker");
const before = await picker.evaluate((el) => {
  const marker = el.querySelector("span");
  return marker ? marker.getAttribute("style") : null;
});
console.log("marker before:", before);

const box = await picker.boundingBox();
// dispatch a real pointer sequence the same way a user would
await page.mouse.move(box.x + 20, box.y + 20);
await page.mouse.down();
await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.72, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(800);

const after = await picker.evaluate((el) => {
  const marker = el.querySelector("span");
  return marker ? marker.getAttribute("style") : null;
});
console.log("marker after:", after);

const stored = await page.evaluate(() => {
  const keys = Object.keys(localStorage).filter((k) => k.startsWith("ms.draft.") && k !== "ms.draft.index");
  const items = keys.map((k) => JSON.parse(localStorage.getItem(k)));
  const p = items.sort((a, b) => b.savedAt - a.savedAt)[0].project;
  const el = p.elements.find((e) => e.type === "character");
  return { mouth: el?.character?.mouth ?? null, count: p.elements.length };
});
console.log("stored:", stored);
await browser.close();
