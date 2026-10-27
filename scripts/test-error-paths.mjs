import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const base = process.argv[2] || "https://meme-stage.pages.dev";
const results = {};
const browser = await chromium.launch();

// ---------------------------------------------------------------- offline save
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/editor`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="canvas"] canvas');
  await page.getByRole("button", { name: "加文字" }).click();
  await page.waitForTimeout(3000);
  const url = page.url();
  results.savedUrl = url;
  await context.setOffline(true);
  await page.getByRole("button", { name: "加文字" }).click();
  await page.waitForTimeout(4000);
  const header = await page.locator("header").innerText();
  results.offlineShowsError = /保存失败/.test(header);
  const draft = await page.evaluate(() => {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith("ms.draft.") && k !== "ms.draft.index");
    const items = keys.map((k) => JSON.parse(localStorage.getItem(k)));
    return items.sort((a, b) => b.savedAt - a.savedAt)[0];
  });
  results.offlineDraftElements = draft?.project?.elements?.length;
  results.offlineDraftTexts = draft?.project?.elements?.filter((e) => e.type === "text").length;
  await page.screenshot({ path: "shots/offline-save.png" });
  await context.setOffline(false);
  await page.waitForTimeout(2500);
  results.recoveredAfterOnline = /已保存/.test(await page.locator("header").innerText());
  results.pageErrors = errors;
  await context.close();
}

// ------------------------------------------------------------- audio failure
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.route("**/demo/voice-*.wav", (route) => route.abort());
  await page.goto(`${base}/p/demo`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="visitor"] canvas');
  const box = await page.locator('[data-testid="visitor"]').boundingBox();
  const scale = Math.min((box.width - 48) / 1600, (box.height - 48) / 900, 1.4);
  const x = box.x + (box.width - 1600 * scale) / 2 + 245 * scale;
  const y = box.y + (box.height - 900 * scale) / 2 + 600 * scale;
  await page.mouse.click(x, y);
  await page.waitForTimeout(2200);
  const text = await page.locator("body").innerText();
  results.audioErrorVisible = /播放失败|无法播放/.test(text);
  results.audioErrorSample = (text.match(/[^\n]*(播放失败|无法播放)[^\n]*/) ?? [""])[0].slice(0, 100);
  await page.screenshot({ path: "shots/audio-error.png" });
  await context.close();
}

// ------------------------------------------------------- unsupported upload UI
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();
  await page.goto(`${base}/editor`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="canvas"] canvas');
  await page.getByRole("button", { name: "批量导入人物" }).click();
  const txt = path.resolve("shots/not-an-image.txt");
  fs.writeFileSync(txt, "definitely not an image");
  await page.locator('[role="dialog"] input[type="file"]').setInputFiles(txt);
  await page.waitForTimeout(900);
  const text = await page.locator("body").innerText();
  results.unsupportedToast = /请选择 JPG|不是图片/.test(text);
  results.dialogStillOpen = await page.locator('[role="dialog"]').isVisible();
  await context.close();
}

console.log(JSON.stringify(results, null, 2));
await browser.close();
