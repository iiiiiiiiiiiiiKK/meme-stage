import { chromium } from "@playwright/test";

// Batch queue + Stage bridge, on the deployed build.
//  - three images are dropped into the queue and processed one at a time
//  - the finished results can be exported as a ZIP
//  - a finished sticker becomes its own Stage element
const base = "https://meme-stage.pages.dev";
const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));

await page.goto(`${base}/studio/batch`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);

await page.evaluate(async () => {
  const make = async (label, hue) => {
    const c = document.createElement("canvas");
    c.width = 360;
    c.height = 420;
    const ctx = c.getContext("2d");
    ctx.fillStyle = `hsl(${hue}, 35%, 26%)`;
    ctx.fillRect(0, 0, 360, 420);
    ctx.fillStyle = `hsl(${hue}, 55%, 74%)`;
    ctx.beginPath();
    ctx.arc(180, 160, 80, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `hsl(${(hue + 150) % 360}, 50%, 45%)`;
    ctx.fillRect(100, 260, 160, 160);
    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    return new File([blob], label, { type: "image/png" });
  };
  const zone = [...document.querySelectorAll("label")].find((el) => el.textContent?.includes("拖入图片"));
  const dt = new DataTransfer();
  dt.items.add(await make("a.png", 210));
  dt.items.add(await make("b.png", 40));
  dt.items.add(await make("c.png", 300));
  zone.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
});
await page.waitForTimeout(4000);

const queued = await page.evaluate(() => {
  const m = document.body.innerText.match(/共 (\d+)/);
  return m ? Number(m[1]) : 0;
});
console.log("queued:", queued);

await page.getByRole("button", { name: "开始处理" }).click();

let done = 0;
let failed = 0;
for (let i = 0; i < 150; i++) {
  await page.waitForTimeout(2000);
  const text = await page.locator("body").innerText();
  const d = text.match(/(\d+) 完成/);
  const f = text.match(/(\d+) 失败/);
  done = d ? Number(d[1]) : 0;
  failed = f ? Number(f[1]) : 0;
  if (done + failed >= queued) break;
}
console.log("finished:", { queued, done, failed });

// the job must survive a reload because it lives in IndexedDB
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
const afterReload = await page.evaluate(() => {
  const m = document.body.innerText.match(/共 (\d+)[\s\S]*?(\d+) 完成/);
  return m ? { total: Number(m[1]), done: Number(m[2]) } : null;
});
console.log("after reload:", afterReload);

const zipEnabled = await page.getByRole("button", { name: "导出 ZIP" }).isEnabled();
console.log("zip enabled:", zipEnabled);

await page.getByRole("button", { name: "加入画布" }).click();
await page.waitForTimeout(6000);
const stage = await page.evaluate(() => {
  const keys = Object.keys(localStorage).filter((k) => k.startsWith("ms.draft.") && k !== "ms.draft.index");
  if (keys.length === 0) return { url: location.pathname, elements: 0 };
  const items = keys.map((k) => JSON.parse(localStorage.getItem(k)));
  const project = items.sort((a, b) => b.savedAt - a.savedAt)[0].project;
  return {
    url: location.pathname,
    elements: project.elements.length,
    types: project.elements.map((el) => el.type),
    urls: project.elements.map((el) => el.image?.url ?? el.character?.imageUrl ?? null),
  };
});
console.log("stage after import:", stage);
console.log("errors", errors.slice(0, 5));
await page.screenshot({ path: "shots/batch-queue.png" });
await browser.close();
