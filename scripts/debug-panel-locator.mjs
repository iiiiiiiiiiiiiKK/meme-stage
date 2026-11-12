import { chromium } from "@playwright/test";

const base = "https://meme-stage.pages.dev";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
await page.goto(`${base}/studio/sticker`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);

const btn = page.locator("button", { hasText: "文字生成贴纸" }).first();
console.log("count:", await page.locator("button", { hasText: "文字生成贴纸" }).count());
console.log("visible:", await btn.isVisible());
console.log("box:", await btn.boundingBox());
console.log("role buttons matching:", await page.getByRole("button", { name: /文字生成/ }).count());
await browser.close();
