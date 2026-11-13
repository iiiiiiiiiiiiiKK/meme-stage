import { chromium } from "@playwright/test";

// 验证任务书新增项在真实页面上可用：
// 三层描边、对比视图、蒙版撤销/重做、缩放、从素材库选图。
const base = "https://meme-stage.pages.dev";
const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 160)));

await page.goto(`${base}/sticker`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);

const bytes = await page.evaluate(async () => {
  const c = document.createElement("canvas");
  c.width = 420;
  c.height = 500;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#2b3550";
  ctx.fillRect(0, 0, 420, 500);
  ctx.fillStyle = "#e8b48a";
  ctx.beginPath();
  ctx.arc(160, 190, 85, 0, Math.PI * 2);
  ctx.arc(300, 210, 70, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#c9485b";
  ctx.fillRect(110, 320, 230, 180);
  const blob = await new Promise((r) => c.toBlob(r, "image/png"));
  return [...new Uint8Array(await blob.arrayBuffer())];
});
await page.setInputFiles('input[type="file"]', {
  name: "doc7-probe.png",
  mimeType: "image/png",
  buffer: Buffer.from(bytes),
});

for (let i = 0; i < 45; i++) {
  await page.waitForTimeout(2000);
  const text = await page.evaluate(() => document.body.innerText);
  if (text.includes("识别完成")) break;
}

const panel = () => page.evaluate(() => {
  const asides = document.querySelectorAll("aside");
  return asides[asides.length - 1]?.innerText ?? "";
});
const body = () => page.evaluate(() => document.body.innerText);

console.log("三层描边可切换:", (await panel()).includes("三层"));
await page.locator("button", { hasText: "三层" }).first().click();
await page.waitForTimeout(800);
const p1 = await panel();
const idx = p1.indexOf("描边层级");
const colorCount3 = await page.evaluate(() => document.querySelectorAll('aside input[type="color"]').length);
console.log("三层时颜色输入数量:", colorCount3, "(应为 3：主/第二/第三)");
console.log("三层按钮选中:", await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "三层");
  return btn ? btn.className.includes("neon") : "missing";
}));
await page.locator("button", { hasText: "双层" }).first().click();
await page.waitForTimeout(600);
console.log("双层时颜色输入数量:", await page.evaluate(() => document.querySelectorAll('aside input[type="color"]').length), "(应为 2)");
await page.locator("button", { hasText: "三层" }).first().click();
await page.waitForTimeout(600);

console.log("对比标签存在:", (await body()).includes("对比"));
await page.locator("button", { hasText: "对比" }).first().click();
await page.waitForTimeout(800);
console.log("对比画布有内容:", await page.evaluate(() => {
  const c = [...document.querySelectorAll("canvas")].find((el) => el.width > 200);
  return Boolean(c && c.width > 0 && c.height > 0);
}));

console.log("蒙版缩放控件:", (await body()).includes("缩放"));
console.log("拖动按钮:", (await body()).includes("拖动"));

await page.locator("button", { hasText: "蒙版" }).first().click();
await page.waitForTimeout(600);
const p2 = await panel();
console.log("撤销/重做/重置:", p2.includes("撤销") && p2.includes("重做") && p2.includes("重置"));

// 素材库选图入口
console.log("素材库选择按钮:", await page.getByLabel("从素材库选择").count() > 0);
await page.getByLabel("从素材库选择").click();
await page.waitForTimeout(1500);
console.log("选择器打开:", (await body()).includes("从素材库选择"));
await page.keyboard.press("Escape");
await page.waitForTimeout(500);

console.log("errors:", errors.slice(0, 3));
await browser.close();
