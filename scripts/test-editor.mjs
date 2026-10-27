import { chromium } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

const base = process.argv[2] || "https://meme-stage.pages.dev";
const fixtureDir = path.resolve("tests/fixtures/people");
const files = fs.readdirSync(fixtureDir).slice(0, 20).map((f) => path.join(fixtureDir, f));

const readDraft = (page) =>
  page.evaluate(() => {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith("ms.draft.") && k !== "ms.draft.index");
    const items = keys.map((key) => {
      try {
        return { key, ...JSON.parse(localStorage.getItem(key)) };
      } catch {
        return null;
      }
    });
    return items.filter(Boolean).sort((a, b) => b.savedAt - a.savedAt)[0] ?? null;
  });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
await page.addInitScript(() => {
  window.__played = [];
  HTMLMediaElement.prototype.play = function () {
    window.__played.push(this.currentSrc || this.src);
    setTimeout(() => this.dispatchEvent(new Event("ended")), 120);
    return Promise.resolve();
  };
  HTMLMediaElement.prototype.pause = function () {};
});

console.log("→ open editor");
await page.goto(`${base}/editor`, { waitUntil: "networkidle" });
await page.waitForSelector('[data-testid="canvas"] canvas', { timeout: 20000 });

console.log("→ import 20 images");
await page.getByRole("button", { name: "批量导入人物" }).click();
const dialog = page.locator('[role="dialog"]');
await dialog.locator('input[type="file"]').setInputFiles(files);
await page.waitForFunction(
  () => {
    const d = document.querySelector('[role="dialog"]');
    const btn = [...(d?.querySelectorAll("button") ?? [])].find((b) => b.textContent.includes("导入 20 个人物"));
    return !!btn && !btn.disabled;
  },
  { timeout: 120000 },
);
await page.screenshot({ path: "shots/import-dialog.png" });
await page.getByRole("button", { name: /导入 20 个人物/ }).click();
await page.waitForSelector('[role="dialog"]', { state: "detached", timeout: 180000 });
clearTimeout(0);
await page.waitForTimeout(1500);

const draft = await readDraft(page);
console.log("elements:", draft?.project?.elements?.length, "url:", page.url());
const positions = draft?.project?.elements?.map((el) => `${Math.round(el.x)},${Math.round(el.y)}`);
console.log("unique positions:", new Set(positions).size);
await page.screenshot({ path: "shots/editor-20.png" });

console.log("→ select + drag");
const row = page.getByRole("button", { name: /person-01/ }).first();
await row.click();
await page.waitForTimeout(500);
const before = await readDraft(page);
const firstBefore = before.project.elements.find((el) => el.character?.name === "person-01");
console.log("selected position:", firstBefore.x, firstBefore.y);

const canvasBox = await page.locator('[data-testid="canvas"]').boundingBox();
const cx = canvasBox.x + canvasBox.width / 2;
const cy = canvasBox.y + canvasBox.height / 2;
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.move(cx + 90, cy + 50, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(800);
const after = await readDraft(page);
const firstAfter = after.project.elements.find((el) => el.character?.name === "person-01");
console.log("dragged position:", firstAfter.x, firstAfter.y);

await page.keyboard.press("Control+z");
await page.waitForTimeout(600);
const undone = await readDraft(page);
console.log("undo position:", undone.project.elements.find((el) => el.character?.name === "person-01").x);

console.log("→ zoom");
const zoomLabel = page.locator('[data-testid="canvas"] button[title="重置为 100%"]');
const zoomBefore = await zoomLabel.textContent();
await page.mouse.move(cx, cy);
await page.mouse.wheel(0, -300);
await page.waitForTimeout(400);
console.log("zoom:", zoomBefore, "→", await zoomLabel.textContent());

console.log("→ bind voice + line");
await page.getByRole("button", { name: /person-01/ }).first().click();
await page.waitForTimeout(600);
await page.locator('input[accept*="audio"]').first().setInputFiles(path.resolve("public/demo/voice-k.wav"));
await page.waitForTimeout(2500);
await page.getByLabel("默认台词").fill("这波真的不亏。");
await page.waitForTimeout(1200);
const voiced = await readDraft(page);
const v = voiced.project.elements.find((el) => el.character?.name === "person-01");
console.log("voice:", v.character?.voice?.url, "line:", v.character?.line);

console.log("→ add interaction");
await page.getByRole("button", { name: /新建互动/ }).click();
await page.waitForTimeout(400);
await page.getByRole("button", { name: /添加动作/ }).click();
await page.waitForTimeout(500);
const withEvent = await readDraft(page);
console.log("events:", withEvent.project.elements.length, withEvent.project.events.length, withEvent.project.events[0]?.steps.length);

console.log("→ publish");
await page.getByRole("button", { name: "发布", exact: true }).click();
await page.waitForSelector('[role="dialog"] img[alt="分享封面预览"]', { timeout: 30000 });
await page.getByRole("button", { name: /发布并获取链接/ }).click();
await page.waitForSelector('input[aria-label="分享链接"]', { timeout: 90000 });
const shareUrl = await page.locator('input[aria-label="分享链接"]').inputValue();
console.log("share:", shareUrl);
const published = await readDraft(page);
fs.writeFileSync(
  "shots/test-project.json",
  JSON.stringify({ shareUrl, project: published.project, projectId: published.key }, null, 2),
);
await page.screenshot({ path: "shots/publish-success.png" });

console.log("→ open on mobile");
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const mpage = await mobile.newPage();
const merrors = [];
mpage.on("console", (m) => m.type() === "error" && merrors.push(m.text()));
mpage.on("pageerror", (e) => merrors.push(e.message));
await mpage.addInitScript(() => {
  window.__played = [];
  HTMLMediaElement.prototype.play = function () {
    window.__played.push(this.currentSrc || this.src);
    setTimeout(() => this.dispatchEvent(new Event("ended")), 120);
    return Promise.resolve();
  };
  HTMLMediaElement.prototype.pause = function () {};
});
await mpage.goto(shareUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
await mpage.waitForSelector('[data-testid="visitor"] canvas', { timeout: 30000 });
await mpage.waitForTimeout(800);
const title = await mpage.locator("header").innerText();
console.log("mobile header:", title.replace(/\n/g, " | "));

const mbox = await mpage.locator('[data-testid="visitor"]').boundingBox();
const proj = published.project;
const fitScale = Math.min((mbox.width - 48) / proj.width, (mbox.height - 48) / proj.height, 1.4);
const ox = mbox.x + (mbox.width - proj.width * fitScale) / 2;
const oy = mbox.y + (mbox.height - proj.height * fitScale) / 2;
const target = proj.elements.find((el) => el.character?.name === "person-01");
await mpage.touchscreen.tap(ox + (target.x + target.width / 2) * fitScale, oy + (target.y + target.height / 2) * fitScale);
await mpage.waitForTimeout(900);
const earlyText = await mpage.locator("body").innerText();
console.log("mobile bubble early:", earlyText.includes("这波真的不亏"));
await mpage.waitForTimeout(2800);
console.log("mobile played:", await mpage.evaluate(() => window.__played));
const mtext = await mpage.locator("body").innerText();
console.log("mobile bubble:", mtext.includes("这波真的不亏"));
console.log("mobile overflow:", await mpage.evaluate(() => document.documentElement.scrollWidth - window.innerWidth));
await mpage.screenshot({ path: "shots/published-mobile.png", fullPage: false });

fs.writeFileSync("shots/e2e-result.json", JSON.stringify({
  shareUrl,
  elements: published.project.elements.length,
  events: published.project.events.length,
  positions: new Set(positions).size,
  dragged: { before: [firstBefore.x, firstBefore.y], after: [firstAfter.x, firstAfter.y], undo: undone.project.elements.find((el) => el.character?.name === "person-01").x },
  mobilePlayed: await mpage.evaluate(() => window.__played),
  mobileBubble: mtext.includes("这波真的不亏"),
  overflow: await mpage.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  errors,
  merrors,
}, null, 2));

console.log("errors:", errors, merrors);
await browser.close();
