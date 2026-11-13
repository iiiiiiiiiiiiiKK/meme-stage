import { chromium } from "@playwright/test";

const base = "https://meme-stage.pages.dev";
const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

for (const path of ["/sticker", "/sticker/batch", "/studio/sticker"]) {
  const res = await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1800);
  const text = await page.evaluate(() => document.body.innerText);
  console.log(
    path,
    "→",
    res?.status(),
    "| STICKER:", text.includes("STICKER"),
    "| 单张制作:", text.includes("单张制作"),
    "| 批面板:", text.includes("队列是空的") || text.includes("开始处理"),
    "| 单面板:", text.includes("识别主体") || text.includes("输出长边"),
  );
}
console.log("errors:", errors.slice(0, 3));
await browser.close();
