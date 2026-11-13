import { chromium } from "@playwright/test";

// STICKER 独立入口 + 完整流程：首页菜单 → 导入图 → 自动处理 → 存入素材库。
const base = "https://meme-stage.pages.dev";
const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 160)));

// 1) 顶部菜单里能看到 STICKER
await page.goto(base, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
const nav = await page.evaluate(() =>
  [...document.querySelectorAll("header a")].map((a) => a.textContent.trim().replace(/\s+/g, " ")),
);
console.log("顶栏:", nav.filter(Boolean).join(" / "));
console.log("有 STICKER 菜单:", nav.some((t) => t === "STICKER"));

const link = page.locator('header a', { hasText: "STICKER" }).first();
console.log("STICKER href:", await link.getAttribute("href"));

// 2) 点进去应落在 /sticker
await link.click();
await page.waitForTimeout(2500);
console.log("路由:", await page.evaluate(() => location.pathname));
const studio = await page.evaluate(() => document.body.innerText);
console.log("工坊标识:", studio.includes("STICKER"), "| 单张制作:", studio.includes("单张制作"), "| 批量制作:", studio.includes("批量制作"));

// 3) 导入一张图，检查是否自动开始处理
const bytes = await page.evaluate(async () => {
  const c = document.createElement("canvas");
  c.width = 420;
  c.height = 500;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#2b3550";
  ctx.fillRect(0, 0, 420, 500);
  ctx.fillStyle = "#e8b48a";
  ctx.beginPath();
  ctx.arc(210, 190, 95, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#c9485b";
  ctx.fillRect(120, 320, 180, 180);
  const blob = await new Promise((r) => c.toBlob(r, "image/png"));
  return [...new Uint8Array(await blob.arrayBuffer())];
});
await page.setInputFiles('input[type="file"]', {
  name: "sticker-probe.png",
  mimeType: "image/png",
  buffer: Buffer.from(bytes),
});
await page.waitForTimeout(2500);
console.log("已导入:", await page.evaluate(() => document.body.innerText.includes("sticker-probe.png")));

// 自动识别：应出现识别状态文案
let analyzed = false;
for (let i = 0; i < 45; i++) {
  await page.waitForTimeout(2000);
  const text = await page.evaluate(() => document.body.innerText);
  if (text.includes("识别完成") || text.includes("蒙版覆盖")) {
    analyzed = true;
    break;
  }
}
console.log("自动识别完成:", analyzed);

// 4) 面板里应有颜色与描边预设
const panel = await page.evaluate(() => {
  const asides = document.querySelectorAll("aside");
  return asides[asides.length - 1]?.innerText ?? "";
});
console.log("人物颜色:", panel.includes("人物颜色"), "| 描边预设:", panel.includes("描边预设"));
console.log("有『存入素材库』:", await page.evaluate(() => document.body.innerText.includes("存入素材库")));
console.log("errors:", errors.slice(0, 3));
await browser.close();
