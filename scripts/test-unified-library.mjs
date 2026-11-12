import { chromium } from "@playwright/test";

// Unified library: both scopes visible, labels honest, filters and selection work.
const base = "https://meme-stage.pages.dev";
const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 160)));

await page.goto(`${base}/assets`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2200);
const empty = await page.evaluate(() => document.body.innerText);
console.log("page loaded:", empty.includes("素材库"));
console.log("scope explanation:", empty.includes("只存在于这个浏览器") && empty.includes("云端"));

// seed one local sticker so the local scope has content
await page.evaluate(async () => {
  const canvas = document.createElement("canvas");
  canvas.width = 200;
  canvas.height = 200;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#66ddff";
  ctx.beginPath();
  ctx.arc(100, 100, 80, 0, Math.PI * 2);
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
      id: "stk_lib_probe",
      sourceId: "src_lib",
      maskId: "msk_lib",
      kind: "local-cutout",
      name: "素材库测试贴纸",
      width: 200,
      height: 200,
      byteSize: blob.size,
      mime: "image/png",
      outline: { enabled: true, thickness: 8, color: "#fff", layers: 2, secondColor: "#111", secondThickness: 3 },
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

// publish nothing, but exercise the cloud list path with the seeded AI asset
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);

const afterSeed = await page.evaluate(() => ({
  text: document.body.innerText,
  localBadge: document.querySelectorAll("span").length > 0,
}));
console.log("local sticker visible:", afterSeed.text.includes("素材库测试贴纸"));
console.log("local badge:", afterSeed.text.includes("本机"));

// filter by kind
await page.getByLabel("素材类型").selectOption("sticker");
await page.waitForTimeout(500);
const filtered = await page.evaluate(() => document.body.innerText.includes("素材库测试贴纸"));
console.log("kind filter keeps sticker:", filtered);

await page.getByLabel("素材类型").selectOption("audio");
await page.waitForTimeout(500);
const audioGone = await page.evaluate(() => !document.body.innerText.includes("素材库测试贴纸"));
console.log("kind filter hides sticker:", audioGone);

await page.getByLabel("素材类型").selectOption("all");
await page.waitForTimeout(400);

// search
await page.getByLabel("搜索素材").fill("不存在的名字");
await page.waitForTimeout(500);
console.log("search empty state:", await page.evaluate(() => document.body.innerText.includes("还没有素材")));
await page.getByLabel("搜索素材").fill("");
await page.waitForTimeout(400);

// selection + import button state
const card = page.getByLabel("选择 素材库测试贴纸");
await card.click();
await page.waitForTimeout(300);
const bodyText = await page.evaluate(() => document.body.innerText);
console.log("selection counted:", bodyText.includes("加入画布（1）"));
console.log("errors", errors.slice(0, 4));
await page.screenshot({ path: "shots/unified-library.png" });
await browser.close();
