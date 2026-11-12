import { chromium } from "@playwright/test";

const base = "https://meme-stage.pages.dev";
const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("pageerror", (e) => console.log("pageerror:", e.message));
page.on("console", (m) => {
  if (m.type() === "error") console.log("console error:", m.text().slice(0, 200));
});

await page.goto(`${base}/studio/batch`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);

await page.evaluate(async () => {
  const make = async (label, hue) => {
    const c = document.createElement("canvas");
    c.width = 320;
    c.height = 380;
    const ctx = c.getContext("2d");
    ctx.fillStyle = `hsl(${hue}, 30%, 30%)`;
    ctx.fillRect(0, 0, 320, 380);
    ctx.fillStyle = `hsl(${hue}, 60%, 76%)`;
    ctx.beginPath();
    ctx.arc(160, 140, 70, 0, Math.PI * 2);
    ctx.fill();
    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    return new File([blob], label, { type: "image/png" });
  };
  const zone = [...document.querySelectorAll("label")].find((el) => el.textContent?.includes("拖入图片"));
  const dt = new DataTransfer();
  dt.items.add(await make("a.png", 200));
  dt.items.add(await make("b.png", 60));
  zone.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
});
await page.waitForTimeout(2500);

const readItems = () =>
  page.evaluate(async () => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open("meme-stage-stickers");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const rows = await new Promise((res) => {
      const tx = db.transaction("batches", "readonly");
      const req = tx.objectStore("batches").getAll();
      req.onsuccess = () => res(req.result);
    });
    const job = rows[0];
    return job ? job.items.map((i) => ({ name: i.name, stage: i.stage, progress: i.progress, err: i.error?.message })) : [];
  });

await page.getByRole("button", { name: "开始处理" }).click();
for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(6000);
  console.log(`${(i + 1) * 6}s`, JSON.stringify(await readItems()));
}
await browser.close();
