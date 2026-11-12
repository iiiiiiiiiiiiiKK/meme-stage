import { chromium } from "@playwright/test";
const base = "https://meme-stage.pages.dev";
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
await page.goto(`${base}/editor`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="canvas"] canvas');
await page.waitForTimeout(1000);
const texts = await page.locator("aside button, aside [role='tab'], aside img").evaluateAll((els) =>
  els.slice(0, 40).map((e) => (e.getAttribute("alt") || e.textContent || "").trim().slice(0, 24)),
);
console.log("left panel:", JSON.stringify(texts));
const imgs = await page.locator("aside img").evaluateAll((els) => els.map((e) => e.getAttribute("src")?.slice(0, 40)));
console.log("imgs:", imgs.slice(0, 10));
const randomBtn = await page.getByRole("button", { name: /随机|示例|熟人/ }).allInnerTexts();
console.log("random-ish buttons:", randomBtn);
await browser.close();
