import { chromium } from "@playwright/test";

const base = "https://meme-stage.pages.dev";
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 160)));
await page.addInitScript(() => {
  HTMLMediaElement.prototype.play = function () {
    setTimeout(() => this.dispatchEvent(new Event("ended")), 100);
    return Promise.resolve();
  };
  HTMLMediaElement.prototype.pause = function () {};
});

await page.goto(`${base}/editor`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="canvas"] canvas');
await page.getByRole("button", { name: "随机熟人" }).click();
await page.waitForTimeout(800);
await page.getByRole("button", { name: /文字生成语音/ }).click();
await page.waitForTimeout(800);

const options = await page.getByLabel("语音引擎").locator("option").evaluateAll((els) =>
  els.map((el) => ({ text: el.textContent, disabled: el.disabled, value: el.value })),
);
console.log("provider options", options);

await page.getByLabel("要朗读的文字").fill("微软官方音色接入测试。");
await page.getByRole("button", { name: "生成并添加" }).click();
await page.waitForTimeout(6000);
const draft = await page.evaluate(() => {
  const keys = Object.keys(localStorage).filter((k) => k.startsWith("ms.draft.") && k !== "ms.draft.index");
  const items = keys.map((k) => JSON.parse(localStorage.getItem(k)));
  const d = items.sort((a, b) => b.savedAt - a.savedAt)[0];
  const c = d.project.elements.find((el) => el.type === "character");
  return c.character.voices.map((v) => ({ name: v.name, source: v.source, rate: v.rate, line: v.line }));
});
console.log("voices", draft);
console.log("errors", errors);
await page.screenshot({ path: "shots/tts-providers.png" });
await browser.close();
