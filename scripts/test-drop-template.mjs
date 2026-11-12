import { chromium } from "@playwright/test";

const base = "https://meme-stage.pages.dev";
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 160)));

await page.goto(`${base}/editor`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="canvas"] canvas');

// drop-target wiring: simulate a file drop via DataTransfer
const dropped = await page.evaluate(async () => {
  const host = document.querySelector('[data-testid="canvas"]')?.parentElement;
  if (!host) return "no host";
  const canvas = document.createElement("canvas");
  canvas.width = 200;
  canvas.height = 260;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#b6ff3c";
  ctx.fillRect(0, 0, 200, 260);
  const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
  const file = new File([blob], "拖入测试--我用文件名当台词.png", { type: "image/png" });
  const dt = new DataTransfer();
  dt.items.add(file);
  host.dispatchEvent(new DragEvent("dragenter", { dataTransfer: dt, bubbles: true }));
  host.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true }));
  return "dropped";
});
console.log(dropped);
await page.waitForTimeout(6000);

const state = await page.evaluate(() => {
  const keys = Object.keys(localStorage).filter((k) => k.startsWith("ms.draft.") && k !== "ms.draft.index");
  const items = keys.map((k) => JSON.parse(localStorage.getItem(k)));
  if (!items.length) return null;
  const p = items.sort((a, b) => b.savedAt - a.savedAt)[0].project;
  return {
    count: p.elements.length,
    name: p.elements[0]?.character?.name,
    line: p.elements[0]?.character?.line,
    title: p.title,
  };
});
console.log("after drop:", state);

// template tab
await page.getByRole("button", { name: "模板" }).click();
await page.waitForTimeout(400);
console.log("templates:", await page.locator("button").filter({ hasText: /全员开麦|群聊截图|群像海报/ }).count());
await page.getByRole("button", { name: /群聊截图/ }).click();
await page.getByRole("button", { name: "套用到当前作品" }).click();
await page.waitForTimeout(900);
const afterTpl = await page.evaluate(() => {
  const keys = Object.keys(localStorage).filter((k) => k.startsWith("ms.draft.") && k !== "ms.draft.index");
  const items = keys.map((k) => JSON.parse(localStorage.getItem(k)));
  const p = items.sort((a, b) => b.savedAt - a.savedAt)[0].project;
  return { w: p.width, h: p.height, heights: p.elements.map((el) => Math.round(el.height)), count: p.elements.length };
});
console.log("after template:", afterTpl);
await page.screenshot({ path: "shots/templates.png" });
console.log("errors", errors.slice(0, 5));
await browser.close();
