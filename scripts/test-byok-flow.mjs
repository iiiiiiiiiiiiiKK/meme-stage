import { chromium } from "@playwright/test";

// BYOK 端到端：用户在自己的浏览器里输入密钥 → 直连图像服务 → 生成 → 保存到本机。
// 同时验证服务端已经没有任何 AI 密钥接口。
const base = "https://meme-stage.pages.dev";
const key = process.env.IMG_KEY;
if (!key) {
  console.log("SKIP: 需要 IMG_KEY");
  process.exit(0);
}

const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
const providerCalls = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 160)));
page.on("request", (r) => {
  if (r.url().includes("agent3.shyfai.cn")) providerCalls.push({ url: r.url(), method: r.method() });
});

// 1) 服务端不应再有 AI 接口
for (const path of ["/api/ai/capabilities", "/api/ai/generate"]) {
  const res = await page.request.fetch(`${base}${path}`, { method: path.endsWith("generate") ? "POST" : "GET" });
  console.log(`server ${path}:`, res.status());
}

// 2) 打开工坊，填入密钥
await page.goto(`${base}/studio/sticker`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);

const keyPanel = page.locator("button", { hasText: "我的 AI 密钥" }).first();
await keyPanel.waitFor({ state: "visible", timeout: 20000 });
// 没有密钥时面板默认是展开的；只有显示"展开"时才需要点开。
const panelState = await page.evaluate(() => document.body.innerText);
if (panelState.includes("我的 AI 密钥") && !panelState.includes("粘贴密钥")) {
  await keyPanel.click();
  await page.waitForTimeout(400);
}

await page.locator('input[placeholder="sk-..."]').first().fill(key);
await page.waitForTimeout(600);
const saveKeyBtn = page.getByRole("button", { name: "验证并保存", exact: true }).first();
for (let i = 0; i < 20; i++) {
  if (!(await saveKeyBtn.isDisabled())) break;
  await page.waitForTimeout(300);
}
console.log("save disabled:", await saveKeyBtn.isDisabled(), "| input len:", (await page.locator('input[placeholder="sk-..."]').first().inputValue()).length);
await saveKeyBtn.click();

let verified = false;
for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(1000);
  const text = await page.evaluate(() => document.body.innerText);
  if (text.includes("已就绪") || text.includes("可用模型")) {
    verified = true;
    break;
  }
  if (text.includes("密钥无效") || text.includes("格式")) break;
}
console.log("key verified in browser:", verified);

const stored = await page.evaluate(() => localStorage.getItem("ms.ai.key"));
console.log("key stored locally:", stored ? `${stored.slice(0, 6)}…${stored.slice(-4)}` : "none");

// 3) 生成
await page.locator("button", { hasText: "文字生成贴纸" }).first().click();
await page.waitForTimeout(400);
const genBtn = page.getByRole("button", { name: "生成", exact: true });
console.log("generate enabled:", await genBtn.isEnabled());
const started = Date.now();
await genBtn.click();

let generated = false;
for (let i = 0; i < 90; i++) {
  await page.waitForTimeout(2000);
  const text = await page.evaluate(() => document.body.innerText);
  // 预览出现（保存按钮）才说明真正拿到了字节；用量只代表请求结束。
  if (text.includes("保存到本机素材") || /生成失败/.test(text)) {
    generated = text.includes("保存到本机素材");
    break;
  }
}
console.log("generated:", generated, `${Math.round((Date.now() - started) / 1000)}s`);
console.log("usage shown:", await page.evaluate(() => document.body.innerText.includes("你的账号")));

// 4) 保存到本机素材
const saveBtn = page.locator("button", { hasText: "保存到本机素材" }).last();
if (await saveBtn.isVisible().catch(() => false)) {
  await saveBtn.click();
  await page.waitForTimeout(4000);
}
const variants = await page.evaluate(async () => {
  const db = await new Promise((res) => {
    const req = indexedDB.open("meme-stage-stickers");
    req.onsuccess = () => res(req.result);
  });
  const rows = await new Promise((res) => {
    const tx = db.transaction("variants", "readonly");
    const req = tx.objectStore("variants").getAll();
    req.onsuccess = () => res(req.result);
  });
  return rows.map((r) => ({ name: r.name, kind: r.kind, w: r.width, h: r.height }));
});
console.log("local variants:", variants);

console.log("provider calls:", providerCalls.length, providerCalls.slice(0, 3).map((c) => `${c.method} ${c.url.split("?")[0]}`));
console.log("errors:", errors.slice(0, 3));
await browser.close();
