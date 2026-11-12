import { chromium } from "@playwright/test";

const base = "https://meme-stage.pages.dev";
const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("pageerror", (e) => console.log("pageerror:", e.message));
page.on("console", (m) => m.type() === "error" && console.log("console:", m.text().slice(0, 200)));

await page.goto(`${base}/studio/sticker`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2200);

await page.locator("button", { hasText: "文字生成贴纸" }).first().click();
await page.waitForTimeout(400);
await page.getByRole("button", { name: "生成", exact: true }).click();

for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(2000);
  const text = await page.evaluate(() => document.body.innerText);
  if (text.includes("已生成") || /生成失败/.test(text)) {
    console.log("generated at", (i + 1) * 2, "s");
    break;
  }
}

const info = await page.evaluate(() => {
  const buttons = [...document.querySelectorAll("button")].map((b) => b.innerText.replace(/\s+/g, " ").trim());
  const imgs = [...document.querySelectorAll("img")].map((i) => i.getAttribute("src")?.slice(0, 60));
  return { buttons: buttons.filter(Boolean), imgs };
});
console.log("buttons:", info.buttons);
console.log("imgs:", info.imgs);

const save = page.locator("button", { hasText: "保存到本机素材" }).last();
console.log("save count:", await save.count(), "visible:", await save.first().isVisible().catch(() => false));
if (await save.count()) {
  await save.first().click();
  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(1500);
    const text = await page.evaluate(() => document.body.innerText);
    if (text.includes("已存入本机素材") || /保存失败/.test(text)) {
      console.log("save outcome:", text.includes("已存入") ? "saved" : "failed");
      break;
    }
  }
}

const rows = await page.evaluate(async () => {
  const db = await new Promise((res) => {
    const req = indexedDB.open("meme-stage-stickers");
    req.onsuccess = () => res(req.result);
  });
  const get = (store) =>
    new Promise((res) => {
      const tx = db.transaction(store, "readonly");
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => res(req.result);
    });
  const variants = await get("variants");
  const sources = await get("sources");
  const masks = await get("masks");
  return {
    variants: variants.map((v) => ({ name: v.name, kind: v.kind, w: v.width, h: v.height })),
    sources: sources.length,
    masks: masks.length,
  };
});
console.log("db:", rows);
await browser.close();
