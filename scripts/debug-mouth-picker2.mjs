import { chromium } from "@playwright/test";

const base = "https://meme-stage.pages.dev";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("pageerror", (e) => console.log("pageerror:", e.message));

await page.goto(`${base}/editor`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="canvas"] canvas');
await page.getByRole("button", { name: "随机熟人" }).click();
await page.waitForTimeout(1500);

const picker = page.getByTestId("mouth-picker");
await picker.scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
const box = await picker.boundingBox();
console.log("box:", box);
const inViewport = box && box.y >= 0 && box.y + box.height <= 950 && box.x >= 0 && box.x + box.width <= 1500;
console.log("inside viewport:", inViewport);

await picker.evaluate((el) => {
  window.__hits = 0;
  el.addEventListener("pointerdown", () => {
    window.__hits += 1;
  });
});

await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.6);
await page.waitForTimeout(600);
console.log("pointerdown hits:", await page.evaluate(() => window.__hits));

const markerStyle = await picker.locator("span").first().getAttribute("style");
console.log("marker:", markerStyle);

const stored = await page.evaluate(() => {
  const keys = Object.keys(localStorage).filter((k) => k.startsWith("ms.draft.") && k !== "ms.draft.index");
  const items = keys.map((k) => JSON.parse(localStorage.getItem(k)));
  const p = items.sort((a, b) => b.savedAt - a.savedAt)[0].project;
  return p.elements.find((e) => e.type === "character")?.character?.mouth ?? null;
});
console.log("stored:", stored);
await browser.close();
