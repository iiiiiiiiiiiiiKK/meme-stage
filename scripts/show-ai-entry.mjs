import { chromium } from "@playwright/test";

// 截图：贴纸工坊右侧面板里的两个 AI 折叠区。
const base = "https://meme-stage.pages.dev";
const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });

await page.goto(`${base}/studio/sticker`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);

// 顶栏有哪些入口
const nav = await page.evaluate(() =>
  [...document.querySelectorAll("header a, header button")].map((el) => el.textContent.trim()).filter(Boolean),
);
console.log("顶栏入口:", nav);

// 右侧面板里能看到哪些分区标题
const fields = await page.evaluate(() => {
  const aside = document.querySelectorAll("aside");
  const last = aside[aside.length - 1];
  return last ? last.innerText.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 40) : [];
});
console.log("右侧面板:", fields);

// 展开「从文字生成」
const gen = page.locator("button", { hasText: "文字生成贴纸" }).first();
if (await gen.count()) {
  await gen.click();
  await page.waitForTimeout(600);
}
await page.screenshot({ path: "shots/ai-panels.png" });
console.log("screenshot saved");

await browser.close();
