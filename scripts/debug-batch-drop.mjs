import { chromium } from "@playwright/test";

const base = "https://meme-stage.pages.dev";
const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("pageerror", (e) => console.log("pageerror:", e.message));
page.on("console", (m) => console.log("console:", m.type(), m.text().slice(0, 200)));

await page.goto(`${base}/studio/batch`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);

// build a File inside the page and drop it onto the import zone
const result = await page.evaluate(async () => {
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
  const file = new File([blob], "one.png", { type: "image/png" });
  const zone = [...document.querySelectorAll("label")].find((el) => el.textContent?.includes("拖入图片"));
  if (!zone) return { error: "no zone" };
  const dt = new DataTransfer();
  dt.items.add(file);
  zone.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
  return { dropped: true, size: file.size };
});
console.log("drop:", result);
await page.waitForTimeout(4000);
console.log(
  "body:",
  (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 260),
);
console.log(
  "idb sources:",
  await page.evaluate(async () => {
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
  }),
);
await browser.close();
