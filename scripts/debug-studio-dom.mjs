import { chromium } from "@playwright/test";

const base = "https://meme-stage.pages.dev";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
await page.goto(`${base}/studio/sticker`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
const text = await page.evaluate(() => document.body.innerText);
console.log("has 从文字生成:", text.includes("从文字生成"));
console.log("has 文字生成贴纸:", text.includes("文字生成贴纸"));
console.log("buttons:", await page.evaluate(() =>
  [...document.querySelectorAll("button")].map((b) => b.innerText.replace(/\s+/g, " ").slice(0, 24)),
));
console.log("script srcs:", await page.evaluate(() =>
  [...document.querySelectorAll("script[src]")].map((s) => s.getAttribute("src")),
));
await browser.close();
