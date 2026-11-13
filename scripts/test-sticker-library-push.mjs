import { chromium } from "@playwright/test";

// 1) 桌面/手机各只应出现一个可见的 STICKER 入口
// 2) 「存入素材库」应真的把字节写进 /api/assets
const base = "https://meme-stage.pages.dev";
const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });

for (const [label, width, mobile] of [["桌面", 1500, false], ["手机", 390, true]]) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, isMobile: mobile });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const visible = await page.evaluate(() => {
    const els = [...document.querySelectorAll('a')].filter(
      (a) => a.getAttribute("href") === "/sticker" && a.getBoundingClientRect().width > 0,
    );
    return els.map((a) => a.textContent.trim().replace(/\s+/g, " "));
  });
  console.log(`${label}: 可见 STICKER 入口 ${visible.length} 个 → ${JSON.stringify(visible)}`);
  await page.close();
}

// 3) 存入素材库
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const calls = [];
page.on("request", (r) => {
  if (r.url().includes("/api/assets")) calls.push(`${r.method()} ${new URL(r.url()).pathname}`);
});
await page.goto(`${base}/sticker`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);

const bytes = await page.evaluate(async () => {
  const c = document.createElement("canvas");
  c.width = 400;
  c.height = 460;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#31405e";
  ctx.fillRect(0, 0, 400, 460);
  ctx.fillStyle = "#eab08a";
  ctx.beginPath();
  ctx.arc(200, 180, 90, 0, Math.PI * 2);
  ctx.fill();
  const blob = await new Promise((r) => c.toBlob(r, "image/png"));
  return [...new Uint8Array(await blob.arrayBuffer())];
});
await page.setInputFiles('input[type="file"]', {
  name: "lib-probe.png",
  mimeType: "image/png",
  buffer: Buffer.from(bytes),
});

for (let i = 0; i < 45; i++) {
  await page.waitForTimeout(2000);
  const text = await page.evaluate(() => document.body.innerText);
  if (text.includes("识别完成")) break;
}

const pushBtn = page.locator("button", { hasText: "存入素材库" }).first();
console.log("存入按钮可用:", await pushBtn.isEnabled());
await pushBtn.click();
await page.waitForTimeout(9000);

console.log("当前路由:", await page.evaluate(() => location.pathname + location.search));
console.log("assets 请求:", calls.join(" | ") || "无");
const listed = await page.evaluate(() => document.body.innerText.includes("lib-probe"));
console.log("素材库出现该贴纸:", listed);
console.log("高亮刚存入的素材:", await page.evaluate(() =>
  Boolean(document.querySelector('[class*="ring-electric"]')),
));
await browser.close();
