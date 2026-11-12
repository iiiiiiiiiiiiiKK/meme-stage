import { chromium } from "@playwright/test";

// 手机宽度下，首页到底有没有任何通往贴纸工坊的入口。
const base = "https://meme-stage.pages.dev";
const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
await page.goto(base, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);

const audit = await page.evaluate(() => {
  const links = [...document.querySelectorAll("a")].map((a) => ({
    text: a.textContent.trim().replace(/\s+/g, " "),
    href: a.getAttribute("href"),
    visible: a.getBoundingClientRect().width > 0,
  }));
  const toStudio = links.filter((l) => l.href?.includes("/studio"));
  return {
    totalLinks: links.length,
    studioLinks: toStudio,
    visibleStudio: toStudio.filter((l) => l.visible).length,
    allVisibleHrefs: [...new Set(links.filter((l) => l.visible).map((l) => l.href))],
  };
});
console.log(JSON.stringify(audit, null, 1));
await browser.close();
