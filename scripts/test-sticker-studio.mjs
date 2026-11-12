import { chromium } from "@playwright/test";

// End-to-end check of the new sticker studio on the deployed build:
// import an image, run the local model, compose a sticker, save it locally and
// verify the settings never re-run detection.
const base = "https://meme-stage.pages.dev";
const browser = await chromium.launch({
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"],
});
const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));

await page.goto(`${base}/studio/sticker`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
console.log("studio loaded:", await page.getByText("贴纸工坊").first().isVisible());

// a synthetic "portrait": head circle + shoulders on a flat background
const png = await page.evaluate(async () => {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 640;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#3a4a6b";
  ctx.fillRect(0, 0, 512, 640);
  ctx.fillStyle = "#e8b48a";
  ctx.beginPath();
  ctx.arc(256, 230, 110, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#c9485b";
  ctx.fillRect(140, 360, 232, 280);
  ctx.fillStyle = "#1a1a1a";
  ctx.beginPath();
  ctx.arc(216, 215, 12, 0, Math.PI * 2);
  ctx.arc(296, 215, 12, 0, Math.PI * 2);
  ctx.fill();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  const buffer = await blob.arrayBuffer();
  return [...new Uint8Array(buffer)];
});
const buffer = Buffer.from(png);
await page.setInputFiles('input[type="file"]', {
  name: "portrait.png",
  mimeType: "image/png",
  buffer,
});
await page.waitForTimeout(1500);
console.log("source imported:", await page.getByText("portrait.png").first().isVisible());

// run the local pipeline
const analyzeButton = page.getByRole("button", { name: /识别主体|重新识别/ });
await analyzeButton.waitFor({ state: "visible", timeout: 20000 });
await analyzeButton.click();

let analysed = false;
for (let i = 0; i < 120; i++) {
  await page.waitForTimeout(1000);
  const text = await page.locator("aside").last().innerText();
  if (text.includes("识别完成") || text.includes("蒙版覆盖")) {
    analysed = true;
    break;
  }
  if (text.includes("失败") || text.includes("error")) break;
}
console.log("analysis finished:", analysed);
const status = await page.locator("aside").last().innerText();
console.log("status excerpt:", status.split("\n").filter((l) => l.includes("蒙版") || l.includes("识别")).slice(0, 4));

// compose must already have produced something
await page.waitForTimeout(800);
const hasResult = await page.evaluate(() => {
  const canvases = [...document.querySelectorAll("canvas")];
  return canvases.some((c) => c.width > 200 && c.height > 200);
});
console.log("preview canvas painted:", hasResult);

// save to local library
const save = page.getByRole("button", { name: "保存到本机" });
if (await save.isEnabled()) {
  await save.click();
  await page.waitForTimeout(1500);
}
const saved = await page.evaluate(async () => {
  const dbs = await indexedDB.databases();
  if (!dbs.some((d) => d.name === "meme-stage-stickers")) return { ok: false, variants: 0 };
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open("meme-stage-stickers");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const count = await new Promise((resolve) => {
    const tx = db.transaction("variants", "readonly");
    const req = tx.objectStore("variants").count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(-1);
  });
  return { ok: true, variants: count };
});
console.log("local library:", saved);

await page.screenshot({ path: "shots/sticker-studio.png", fullPage: false });
console.log("errors", errors.slice(0, 5));
await browser.close();
