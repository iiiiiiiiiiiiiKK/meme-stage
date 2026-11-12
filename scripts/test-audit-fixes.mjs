import { chromium } from "@playwright/test";

// Verifies the two audit fixes that are only observable in the browser:
//  1. batch「保存到本机素材」关闭 → 结果不进素材库，但导出仍然可用
//  2. 素材库批量加入画布后 → 跳到编辑器，而不是停在原地
const base = "https://meme-stage.pages.dev";
const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 160)));

const countVariants = (includeEphemeral) =>
  page.evaluate(async (include) => {
    const db = await new Promise((res, rej) => {
      const req = indexedDB.open("meme-stage-stickers", 1);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    const rows = await new Promise((res) => {
      const tx = db.transaction("variants", "readonly");
      const req = tx.objectStore("variants").getAll();
      req.onsuccess = () => res(req.result);
    });
    return include ? rows.length : rows.filter((r) => !r.ephemeral).length;
  }, includeEphemeral);

await page.goto(`${base}/studio/batch`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);

const saveSwitch = page.getByRole("switch", { name: /完成后保存到本机素材/ });
await saveSwitch.waitFor({ state: "visible", timeout: 20000 });
if ((await saveSwitch.getAttribute("aria-checked")) !== "false") await saveSwitch.click();
await page.waitForTimeout(300);
console.log("save switch off:", (await saveSwitch.getAttribute("aria-checked")) === "false");

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
  dt.items.add(await make("tmp.png", 200));
  zone.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
});
await page.waitForTimeout(2500);
await page.getByRole("button", { name: "开始处理" }).click();

const jobState = () =>
  page.evaluate(async () => {
    const db = await new Promise((res) => {
      const req = indexedDB.open("meme-stage-stickers");
      req.onsuccess = () => res(req.result);
    });
    const rows = await new Promise((res) => {
      const tx = db.transaction("batches", "readonly");
      const req = tx.objectStore("batches").getAll();
      req.onsuccess = () => res(req.result);
    });
    return rows.flatMap((job) => job.items.map((i) => i.stage));
  });

for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(2000);
  const stages = await jobState();
  if (stages.length > 0 && stages.every((s) => s === "done" || s === "failed")) break;
}
console.log("item stages:", await jobState());

const all = await countVariants(true);
const visible = await countVariants(false);
console.log("variants on disk:", all, "| visible in library:", visible);
console.log("ephemeral hidden:", all > 0 && visible === 0);
console.log("zip still enabled:", await page.getByRole("button", { name: "导出 ZIP" }).isEnabled());

// library import must land on the editor
await page.goto(`${base}/assets`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);

// seed one visible sticker so there is something to import
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
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
  await new Promise((res, rej) => {
    const tx = db.transaction("variants", "readwrite");
    tx.objectStore("variants").put({
      id: "stk_nav_probe",
      sourceId: "src_nav",
      maskId: "msk_nav",
      kind: "local-cutout",
      name: "导航探测贴纸",
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
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);

await page.getByLabel("选择 导航探测贴纸").click();
await page.waitForTimeout(300);
await page.getByRole("button", { name: /加入画布（1）/ }).click();
await page.waitForTimeout(6000);

const landing = await page.evaluate(() => location.pathname);
console.log("path after library import:", landing);
console.log("navigated to editor:", landing.startsWith("/editor"));
console.log("errors", errors.slice(0, 4));
await browser.close();
