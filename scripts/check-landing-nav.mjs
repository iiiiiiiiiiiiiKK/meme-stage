import { chromium } from "@playwright/test";

// 检查线上首页真正渲染出来的导航，以及 /studio/sticker 是否可达。
const base = "https://meme-stage.pages.dev";
const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 140)));

await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

const nav = await page.evaluate(() => {
  const header = document.querySelector("header");
  const links = [...(header?.querySelectorAll("a") ?? [])].map((a) => ({
    text: a.textContent.trim().replace(/\s+/g, " "),
    href: a.getAttribute("href"),
  }));
  return {
    viewport: window.innerWidth,
    headerLinks: links,
    bodyHasSticker: document.body.innerText.includes("贴纸工坊"),
  };
});
console.log("viewport:", nav.viewport);
console.log("header links:", JSON.stringify(nav.headerLinks, null, 1));
console.log("body has 贴纸工坊:", nav.bodyHasSticker);

// 直接访问工坊路由
const res = await page.goto(`${base}/studio/sticker`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
const studio = await page.evaluate(() => ({
  title: document.title,
  hasWorkshop: document.body.innerText.includes("贴纸工坊"),
  hasBatch: document.body.innerText.includes("批量工坊"),
  hasAI: document.body.innerText.includes("文字生成贴纸"),
}));
console.log("route status:", res?.status());
console.log("studio:", studio);
console.log("errors:", errors.slice(0, 3));

await browser.close();
