import { chromium } from "@playwright/test";

const base = "https://meme-stage.pages.dev";
const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("pageerror", (e) => console.log("pageerror:", e.message));
page.on("console", (m) => console.log("console:", m.type(), m.text().slice(0, 160)));

await page.goto(`${base}/studio/batch`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
console.log("file inputs:", await page.locator('input[type="file"]').count());

const bytes = await page.evaluate(async () => {
  const c = document.createElement("canvas");
  c.width = 300;
  c.height = 360;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#224";
  ctx.fillRect(0, 0, 300, 360);
  ctx.fillStyle = "#eab";
  ctx.beginPath();
  ctx.arc(150, 140, 70, 0, Math.PI * 2);
  ctx.fill();
  const blob = await new Promise((r) => c.toBlob(r, "image/png"));
  return [...new Uint8Array(await blob.arrayBuffer())];
});

await page.setInputFiles('input[type="file"]', {
  name: "one.png",
  mimeType: "image/png",
  buffer: Buffer.from(bytes),
});
await page.waitForTimeout(3000);
const body = await page.locator("body").innerText();
console.log("toast/body excerpt:", body.replace(/\s+/g, " ").slice(0, 400));
console.log("idb sources:", await page.evaluate(async () => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open("meme-stage-stickers");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }).catch(() => null);
  if (!db) return "no db";
  return await new Promise((res) => {
    const tx = db.transaction("sources", "readonly");
    const req = tx.objectStore("sources").count();
    req.onsuccess = () => res(req.result);
    req.onerror = () => res(-1);
  });
}));
await browser.close();
