import { chromium } from "@playwright/test";

// 精确检查首页导航：哪些链接可见、在什么宽度下消失。
const base = "https://meme-stage.pages.dev";
const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });

for (const width of [1440, 1024, 820, 640, 500]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const info = await page.evaluate(() => {
    const header = document.querySelector("header");
    const items = [...(header?.querySelectorAll("a") ?? [])].map((a) => {
      const rect = a.getBoundingClientRect();
      const style = getComputedStyle(a);
      const parentNav = a.closest("nav");
      const navDisplay = parentNav ? getComputedStyle(parentNav).display : "n/a";
      return {
        text: a.textContent.trim().replace(/\s+/g, " "),
        href: a.getAttribute("href"),
        w: Math.round(rect.width),
        visible: rect.width > 0 && rect.height > 0 && style.visibility !== "hidden",
        navDisplay,
      };
    });
    return { innerWidth: window.innerWidth, items };
  });
  const stickers = info.items.filter((i) => i.text.includes("贴纸"));
  console.log(
    `width ${width} → innerWidth ${info.innerWidth} | 贴纸工坊:`,
    stickers.length ? JSON.stringify(stickers) : "NOT RENDERED",
    "| visible links:",
    info.items.filter((i) => i.visible).map((i) => i.text).join(" / "),
  );
  await page.close();
}
await browser.close();
