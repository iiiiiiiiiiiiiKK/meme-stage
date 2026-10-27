import { chromium } from "@playwright/test";
import path from "node:path";

const base = process.argv[2] || "https://meme-stage.pages.dev";
const browser = await chromium.launch();
const results = {};

// ------------------------------------------------ editor: add 3 voices via UI
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/editor`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="canvas"] canvas');
  await page.getByRole("button", { name: "随机熟人" }).click();
  await page.waitForTimeout(700);
  // the freshly added demo character is selected; add two more voices through the UI
  const audioInput = page.locator('aside input[type="file"][accept*="audio"]').first();
  await audioInput.setInputFiles([
    path.resolve("public/demo/voice-cat.wav"),
    path.resolve("public/demo/voice-cat2.wav"),
    path.resolve("public/demo/voice-cat3.wav"),
  ]);
  await page.waitForTimeout(4000);
  const draft = await page.evaluate(() => {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith("ms.draft.") && k !== "ms.draft.index");
    const items = keys.map((k) => JSON.parse(localStorage.getItem(k)));
    return items.sort((a, b) => b.savedAt - a.savedAt)[0];
  });
  const character = draft.project.elements.find((el) => el.type === "character");
  results.uiVoiceCount = character?.character?.voices?.length;
  results.uiVoiceMode = character?.character?.voiceMode;
  results.uiVoiceNames = character?.character?.voices?.map((v) => v.name);
  results.uiLines = character?.character?.voices?.map((v) => v.line);
  results.editorErrors = errors;
  await page.screenshot({ path: "shots/editor-multivoice.png" });
  await context.close();
}

// ------------------------------------ legacy single-voice project still plays
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__played = [];
    HTMLMediaElement.prototype.play = function () {
      window.__played.push(this.currentSrc || this.src);
      setTimeout(() => this.dispatchEvent(new Event("ended")), 100);
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {};
  });
  await page.goto(`${base}/p/person-01-20-1k2v`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="visitor"] canvas');
  const box = await page.locator('[data-testid="visitor"]').boundingBox();
  const scale = Math.min((box.width - 48) / 1600, (box.height - 48) / 900, 1.4);
  const ox = box.x + (box.width - 1600 * scale) / 2;
  const oy = box.y + (box.height - 900 * scale) / 2;
  await page.mouse.click(ox + 245 * scale, oy + 230 * scale);
  await page.waitForTimeout(1200);
  results.legacyPlayed = await page.evaluate(() => window.__played);
  await context.close();
}

console.log(JSON.stringify(results, null, 2));
await browser.close();
