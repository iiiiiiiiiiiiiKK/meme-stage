import { chromium } from "@playwright/test";

// Focused bridge check: put a sticker variant straight into the local DB, open
// the editor, import it, and read the resulting project back from localStorage.
const base = "https://meme-stage.pages.dev";
const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));

await page.addInitScript(() => {
  HTMLMediaElement.prototype.play = () => Promise.resolve();
});

await page.goto(`${base}/editor`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="canvas"] canvas', { timeout: 30000 });
await page.waitForTimeout(1500);
const before = await page.evaluate(() => {
  const keys = Object.keys(localStorage).filter((k) => k.startsWith("ms.draft.") && k !== "ms.draft.index");
  if (keys.length === 0) return 0;
  const items = keys.map((k) => JSON.parse(localStorage.getItem(k)));
  return items.sort((a, b) => b.savedAt - a.savedAt)[0].project.elements.length;
});

// seed the sticker DB with a rendered variant, exactly like the workbench does
const seeded = await page.evaluate(async () => {
  const canvas = document.createElement("canvas");
  canvas.width = 240;
  canvas.height = 240;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffdd55";
  ctx.beginPath();
  ctx.arc(120, 120, 100, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#111";
  ctx.beginPath();
  ctx.arc(90, 100, 12, 0, Math.PI * 2);
  ctx.arc(150, 100, 12, 0, Math.PI * 2);
  ctx.fill();
  const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));

  const open = () =>
    new Promise((resolve, reject) => {
      const req = indexedDB.open("meme-stage-stickers", 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore("sources", { keyPath: "id" });
        db.createObjectStore("masks", { keyPath: "id" });
        db.createObjectStore("variants", { keyPath: "id" });
        db.createObjectStore("batches", { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  const db = await open();
  const id = "stk_test_bridge";
  await new Promise((resolve, reject) => {
    const tx = db.transaction("variants", "readwrite");
    tx.objectStore("variants").put({
      id,
      sourceId: "src_test",
      maskId: "msk_test",
      kind: "local-cutout",
      name: "桥接测试贴纸",
      width: 240,
      height: 240,
      byteSize: blob.size,
      mime: "image/png",
      outline: { enabled: true, thickness: 10, color: "#ffffff", layers: 2, secondColor: "#111111", secondThickness: 4 },
      mode: "head",
      warnings: [],
      createdAt: Date.now(),
      blob,
      thumb: blob,
    });
    tx.oncomplete = () => resolve(null);
    tx.onerror = () => reject(tx.error);
  });
  return { id, size: blob.size };
});
console.log("seeded variant:", seeded, "elements before:", before);

// import through the real bridge on the studio page
await page.goto(`${base}/studio/sticker`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
const enabled = await page.getByRole("button", { name: "最新一张加入画布" }).isEnabled();
console.log("import button enabled:", enabled);
await page.getByRole("button", { name: "最新一张加入画布" }).click();
await page.waitForTimeout(6000);

const after = await page.evaluate(() => {
  const keys = Object.keys(localStorage).filter((k) => k.startsWith("ms.draft.") && k !== "ms.draft.index");
  if (keys.length === 0) return { url: location.pathname, elements: 0 };
  const items = keys.map((k) => JSON.parse(localStorage.getItem(k)));
  const project = items.sort((a, b) => b.savedAt - a.savedAt)[0].project;
  return {
    url: location.pathname,
    elements: project.elements.length,
    last: project.elements.at(-1),
  };
});
console.log("url after import:", after.url);
console.log("elements:", before, "->", after.elements);
console.log("last element:", after.last && {
  type: after.last.type,
  name: after.last.image?.name ?? after.last.character?.name,
  url: after.last.image?.url ?? after.last.character?.imageUrl,
  animated: after.last.image?.animated ?? null,
  w: after.last.width,
  h: after.last.height,
});
console.log("errors", errors.slice(0, 5));
await browser.close();
