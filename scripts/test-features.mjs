import { chromium } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

const base = process.argv[2] || "https://meme-stage.pages.dev";
const dir = path.resolve("tests/fixtures/people");
const files = fs.readdirSync(dir).slice(0, 4).map((f) => path.join(dir, f));
const results = {};

const draftOf = (page) =>
  page.evaluate(() => {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith("ms.draft.") && k !== "ms.draft.index");
    const items = keys.map((k) => {
      try {
        return { key: k, ...JSON.parse(localStorage.getItem(k)) };
      } catch {
        return null;
      }
    });
    return items.filter(Boolean).sort((a, b) => b.savedAt - a.savedAt)[0];
  });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));
page.on("pageerror", (e) => errors.push(e.message));
page.on("response", (res) => {
  if (res.status() === 409) {
    console.log("409!", new Date().toISOString(), res.url());
    res.text().then((t) => console.log("  body:", t.slice(0, 120))).catch(() => undefined);
  }
});
await page.addInitScript(() => {
  window.__played = [];
  HTMLMediaElement.prototype.play = function () {
    window.__played.push(this.currentSrc || this.src);
    setTimeout(() => this.dispatchEvent(new Event("ended")), 100);
    return Promise.resolve();
  };
  HTMLMediaElement.prototype.pause = function () {};
});

await page.goto(`${base}/editor`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="canvas"] canvas');
await page.getByRole("button", { name: "批量导入人物" }).click();
const dialog = page.locator('[role="dialog"]');
await dialog.locator('input[type="file"]').setInputFiles(files);
await page.waitForFunction(() => {
  const d = document.querySelector('[role="dialog"]');
  const btn = [...(d?.querySelectorAll("button") ?? [])].find((b) => b.textContent.includes("导入 4 个人物"));
  return !!btn && !btn.disabled;
});
await page.getByRole("button", { name: /导入 4 个人物/ }).click();
await page.waitForSelector('[role="dialog"]', { state: "detached", timeout: 120000 });
await page.waitForTimeout(1600);
const countText = async () =>
  (await page.locator('[data-testid="canvas"]').innerText()).match(/(\d+) 个人物/)?.[1];
results.imported = await countText();

console.log("→ text element");
await page.getByRole("button", { name: "加文字" }).click();
await page.waitForTimeout(400);
results.afterText = await countText();
const draftText = await draftOf(page);
results.textContent = draftText.project.elements.find((e) => e.type === "text")?.text?.content;

console.log("→ multi select + batch move");
await page.getByRole("button", { name: /person-01/ }).first().click();
await page.getByRole("button", { name: /person-02/ }).first().click({ modifiers: ["Shift"] });
await page.waitForTimeout(300);
const beforeMulti = await draftOf(page);
const a0 = beforeMulti.project.elements.find((e) => e.character?.name === "person-01");
const b0 = beforeMulti.project.elements.find((e) => e.character?.name === "person-02");
const canvasBox = await page.locator('[data-testid="canvas"]').boundingBox();
const cx = canvasBox.x + canvasBox.width / 2;
const cy = canvasBox.y + canvasBox.height / 2;
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.move(cx + 60, cy + 30, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(900);
const afterMulti = await draftOf(page);
const a1 = afterMulti.project.elements.find((e) => e.character?.name === "person-01");
const b1 = afterMulti.project.elements.find((e) => e.character?.name === "person-02");
results.multiMove = {
  a: [a1.x - a0.x, a1.y - a0.y],
  b: [b1.x - b0.x, b1.y - b0.y],
};

console.log("→ duplicate / delete / lock");
await page.getByRole("button", { name: /person-03/ }).first().click();
await page.waitForTimeout(300);
await page.keyboard.press("Control+d");
await page.waitForTimeout(500);
results.afterDuplicate = await countText();
await page.keyboard.press("Delete");
await page.waitForTimeout(500);
results.afterDelete = await countText();
await page.getByRole("button", { name: /person-04/ }).first().click();
await page.waitForTimeout(300);
await page.locator("aside").last().getByRole("button", { name: "锁定" }).click();
await page.waitForTimeout(400);
const lockedBefore = await draftOf(page);
const l0 = lockedBefore.project.elements.find((e) => e.character?.name === "person-04");
results.lockFlag = l0.locked;
const cBox2 = await page.locator('[data-testid="canvas"]').boundingBox();
await page.mouse.move(cBox2.x + cBox2.width / 2, cBox2.y + cBox2.height / 2);
await page.mouse.down();
await page.mouse.move(cBox2.x + cBox2.width / 2 + 70, cBox2.y + cBox2.height / 2 + 20, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(700);
const lockedAfter = await draftOf(page);
const l1 = lockedAfter.project.elements.find((e) => e.character?.name === "person-04");
results.lockHolds = l0.x === l1.x && l0.y === l1.y;

console.log("→ layer order");
await page.getByRole("button", { name: /person-02/ }).first().click();
await page.getByRole("button", { name: "图层与操作" }).click();
await page.waitForTimeout(250);
await page.getByRole("button", { name: "顶", exact: true }).click();
await page.waitForTimeout(500);
const layerDraft = await draftOf(page);
const maxZ = Math.max(...layerDraft.project.elements.map((e) => e.z));
const p2 = layerDraft.project.elements.find((e) => e.character?.name === "person-02");
results.layerTop = p2.z === maxZ;

console.log("→ export png");
await page.getByRole("button", { name: "更多" }).click();
const downloadPromise = page.waitForEvent("download", { timeout: 30000 });
await page.getByRole("button", { name: /导出 PNG/ }).click();
const download = await downloadPromise;
const pngPath = path.resolve("shots/export-test.png");
await download.saveAs(pngPath);
results.exportPngBytes = fs.statSync(pngPath).size;

console.log("→ preview + click");
await page.getByRole("button", { name: /person-01/ }).first().click();
await page.waitForTimeout(400);
await page.locator('input[accept*="audio"]').first().setInputFiles(path.resolve("public/demo/voice-k.wav"));
await page.waitForTimeout(2200);
await page.getByRole("button", { name: "图层与操作" }).click();
await page.waitForTimeout(200);
await page.getByRole("button", { name: "顶", exact: true }).click();
await page.waitForTimeout(400);
const previewDraft = await draftOf(page);
await page.getByRole("button", { name: "预览" }).click();
await page.waitForSelector('[data-testid="preview"] canvas');
await page.waitForTimeout(500);
const previewBox = await page.locator('[data-testid="visitor"]').boundingBox();
const pv = previewDraft.project;
const s = Math.min((previewBox.width - 48) / pv.width, (previewBox.height - 48) / pv.height, 1.4);
const ox = previewBox.x + (previewBox.width - pv.width * s) / 2;
const oy = previewBox.y + (previewBox.height - pv.height * s) / 2;
const p1 = pv.elements.find((e) => e.character?.name === "person-01");
await page.mouse.click(ox + (p1.x + p1.width / 2) * s, oy + (p1.y + p1.height / 2) * s);
await page.waitForTimeout(900);
results.previewPlayed = await page.evaluate(() => window.__played);
await page.screenshot({ path: "shots/preview-editor.png" });
await page.getByRole("button", { name: "退出预览" }).click();

console.log("→ save + refresh");
await page.getByText("已保存", { exact: true }).first().waitFor({ timeout: 20000 }).catch(() => undefined);
await page.waitForTimeout(800);
const savedUrl = page.url();
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="canvas"] canvas');
await page.waitForTimeout(1200);
results.reloadCount = await countText();
results.reloadUrl = page.url();
results.savedUrl = savedUrl;
const reloadDraft = await draftOf(page);
results.reloadElements = reloadDraft.project.elements.length;

console.log("→ mobile editor");
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const mp = await mobile.newPage();
const mErrors = [];
mp.on("console", (m) => m.type() === "error" && mErrors.push(m.text().slice(0, 160)));
mp.on("pageerror", (e) => mErrors.push(e.message));
await mp.goto(`${base}/editor`, { waitUntil: "domcontentloaded" });
await mp.waitForSelector('[data-testid="canvas"] canvas');
await mp.waitForTimeout(700);
results.mobileEditorOverflow = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
await mp.getByRole("button", { name: "人物" }).last().click();
await mp.waitForTimeout(400);
results.mobileSheet = await mp.getByText("批量导入人物").isVisible();
await mp.screenshot({ path: "shots/editor-mobile.png" });

results.errors = errors;
results.mErrors = mErrors;
fs.writeFileSync("shots/features-result.json", JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
await browser.close();
