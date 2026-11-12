import { chromium } from "@playwright/test";

const base = "https://meme-stage.pages.dev";
const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("pageerror", (e) => console.log("pageerror:", e.message));
page.on("console", (m) => console.log("console:", m.type(), m.text().slice(0, 200)));
page.on("response", (r) => {
  if (r.url().includes("/api/ai/")) console.log("resp:", r.status(), r.url().replace(base, "").slice(0, 60));
});

await page.goto(`${base}/studio/sticker`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);

await page.evaluate(async () => {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffcc55";
  ctx.beginPath();
  ctx.arc(128, 128, 100, 0, Math.PI * 2);
  ctx.fill();
  const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
  const db = await new Promise((res, rej) => {
    const req = indexedDB.open("meme-stage-stickers", 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      d.createObjectStore("sources", { keyPath: "id" });
      d.createObjectStore("masks", { keyPath: "id" });
      d.createObjectStore("variants", { keyPath: "id" });
      d.createObjectStore("batches", { keyPath: "id" });
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
  await new Promise((res, rej) => {
    const tx = db.transaction("variants", "readwrite");
    tx.objectStore("variants").put({
      id: "stk_probe3",
      sourceId: "src_p3",
      maskId: "msk_p3",
      kind: "local-cutout",
      name: "探测贴纸3",
      width: 256,
      height: 256,
      byteSize: blob.size,
      mime: "image/png",
      outline: { enabled: true, thickness: 10, color: "#fff", layers: 2, secondColor: "#111", secondThickness: 4 },
      mode: "head",
      warnings: [],
      createdAt: Date.now(),
      blob,
      thumb: blob,
    });
    tx.oncomplete = () => res(null);
    tx.onerror = () => rej(tx.error);
  });
});
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);

await page.getByRole("button", { name: /AI 风格版/ }).click();
await page.waitForTimeout(400);
await page.getByRole("checkbox").check();
await page.getByRole("button", { name: "生成风格版", exact: true }).click();

let found = false;
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(2000);
  const text = await page.evaluate(() => document.body.innerText);
  if (text.includes("已保存为独立版本") || /失败|无法/.test(text)) {
    found = true;
    console.log("outcome at", (i + 1) * 2, "s:", text.includes("已保存") ? "saved" : "error");
    break;
  }
}
console.log("terminal state reached:", found);

const state = await page.evaluate(async () => {
  const db = await new Promise((res) => {
    const req = indexedDB.open("meme-stage-stickers");
    req.onsuccess = () => res(req.result);
  });
  const rows = await new Promise((res) => {
    const tx = db.transaction("variants", "readonly");
    const req = tx.objectStore("variants").getAll();
    req.onsuccess = () => res(req.result);
  });
  return rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind }));
});
console.log("variants:", state);
await browser.close();
