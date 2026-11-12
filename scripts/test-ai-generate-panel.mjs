import { chromium } from "@playwright/test";

// Text-to-sticker in the real workbench: generate, preview, save into the local
// library, and confirm the original library was not touched.
const base = "https://meme-stage.pages.dev";
const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));

await page.goto(`${base}/studio/sticker`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2200);

const panel = page.locator("button", { hasText: "文字生成贴纸" }).first();
await panel.waitFor({ state: "attached", timeout: 20000 });
console.log("panel present:", await panel.isVisible());
await panel.click();
await page.waitForTimeout(500);

const opened = await page.evaluate(() => document.body.innerText);
console.log("models:", /gpt-image-2\.[56]/.test(opened));
console.log("cost statement:", opened.includes("按 token 计费"));

const before = await page.evaluate(async () => {
  const db = await new Promise((res) => {
    const req = indexedDB.open("meme-stage-stickers");
    req.onsuccess = () => res(req.result);
  }).catch(() => null);
  if (!db) return 0;
  return await new Promise((res) => {
    const tx = db.transaction("variants", "readonly");
    const req = tx.objectStore("variants").count();
    req.onsuccess = () => res(req.result);
    req.onerror = () => res(-1);
  });
});
console.log("variants before:", before);

const started = Date.now();
await page.getByRole("button", { name: "生成", exact: true }).click();

let generated = false;
for (let i = 0; i < 120; i++) {
  await page.waitForTimeout(2000);
  const text = await page.evaluate(() => document.body.innerText);
  if (text.includes("已生成") || text.includes("生成失败")) {
    generated = true;
    console.log("outcome:", text.includes("已生成") ? "generated" : "failed");
    break;
  }
}
console.log("generation done:", generated, `${Math.round((Date.now() - started) / 1000)}s`);
console.log("usage shown:", await page.evaluate(() => document.body.innerText.includes("用量：")));

const saveBtn = page.locator("button", { hasText: "保存到本机素材" }).last();
if (await saveBtn.isVisible().catch(() => false)) {
  await saveBtn.click();
  await page.waitForTimeout(4000);
}

const after = await page.evaluate(async () => {
  const db = await new Promise((res) => {
    const req = indexedDB.open("meme-stage-stickers");
    req.onsuccess = () => res(req.result);
  });
  const rows = await new Promise((res) => {
    const tx = db.transaction("variants", "readonly");
    const req = tx.objectStore("variants").getAll();
    req.onsuccess = () => res(req.result);
  });
  return {
    count: rows.length,
    kinds: rows.map((r) => r.kind),
    names: rows.map((r) => r.name),
    body: document.body.innerText.includes("已存入本机素材"),
  };
});
console.log("variants after:", after.count, after.kinds);
console.log("saved banner:", after.body);
console.log("errors", errors.slice(0, 4));
await browser.close();
