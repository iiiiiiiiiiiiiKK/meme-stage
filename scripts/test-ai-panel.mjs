import { chromium } from "@playwright/test";

// Verifies the AI style panel in the real workbench: the panel is gated, states
// the third-party transfer, and a generated result becomes its own version.
const base = "https://meme-stage.pages.dev";
const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));

await page.goto(`${base}/studio/sticker`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);

// seed one saved sticker so the AI panel can appear
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
      id: "stk_ai_probe",
      sourceId: "src_probe",
      maskId: "msk_probe",
      kind: "local-cutout",
      name: "AI 探测贴纸",
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

const panelText = await page.evaluate(() => document.body.innerText);
console.log("panel present:", panelText.includes("AI 风格版"));
console.log("gated states a caveat:", panelText.includes("外部模型服务") || panelText.includes("未启用"));

await page.getByRole("button", { name: /AI 风格版/ }).click();
await page.waitForTimeout(600);
const opened = await page.evaluate(() => document.body.innerText);
console.log("models listed:", /gpt-image-2\.[56]/.test(opened));
console.log("confirmation text:", opened.includes("外部模型服务"));
const runBtn = page.getByRole("button", { name: "生成风格版", exact: true });
console.log("generate disabled before confirm:", await runBtn.isDisabled());

await page.getByRole("checkbox").check();
await page.waitForTimeout(300);
console.log("generate enabled after confirm:", await runBtn.isEnabled());

const started = Date.now();
await runBtn.click();
let done = false;
for (let i = 0; i < 90; i++) {
  await page.waitForTimeout(2000);
  const text = await page.evaluate(() => document.body.innerText);
  if (text.includes("用量：") || text.includes("生成失败") || text.includes("失败")) {
    done = true;
    break;
  }
}
console.log("generation finished:", done, `${Math.round((Date.now() - started) / 1000)}s`);

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
    variants: rows.map((r) => ({ name: r.name, kind: r.kind, w: r.width, h: r.height })),
    body: document.body.innerText.includes("已保存为独立版本"),
  };
});
console.log("variants after:", after.variants);
console.log("saved message:", after.body);
console.log("errors", errors.slice(0, 4));
await browser.close();
