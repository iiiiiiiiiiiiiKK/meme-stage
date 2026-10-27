import { chromium } from "@playwright/test";
import path from "node:path";

const base = "https://meme-stage.pages.dev";
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const requests = [];
page.on("request", (r) => {
  if (r.url().includes("/api/assets")) requests.push(`${r.method()} ${r.url()}`);
});
page.on("response", async (r) => {
  if (r.url().includes("/api/assets")) console.log("asset response", r.status(), (await r.text()).slice(0, 160));
});
page.on("console", (m) => m.type() === "error" && console.log("console error", m.text().slice(0, 200)));
page.on("pageerror", (e) => console.log("pageerror", e.message));
await page.goto(`${base}/editor`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="canvas"] canvas');
await page.getByRole("button", { name: "随机熟人" }).click();
await page.waitForTimeout(800);
console.log("inputs:", await page.locator('input[type="file"]').evaluateAll((els) => els.map((e) => e.accept)));
console.log("selected title:", await page.locator("aside").last().locator("h2, div").first().textContent().catch(() => "n/a"));
await page.locator('aside input[type="file"][accept*="audio"]').first().setInputFiles([
  path.resolve("public/demo/voice-cat.wav"),
  path.resolve("public/demo/voice-cat2.wav"),
  path.resolve("public/demo/voice-cat3.wav"),
]);
await page.waitForTimeout(7000);
console.log("requests", requests);
console.log("body snippet", (await page.locator("body").innerText()).match(/已添加[^\n]*/g));
const draft = await page.evaluate(() => {
  const keys = Object.keys(localStorage).filter((k) => k.startsWith("ms.draft.") && k !== "ms.draft.index");
  const items = keys.map((k) => JSON.parse(localStorage.getItem(k)));
  const d = items.sort((a, b) => b.savedAt - a.savedAt)[0];
  const c = d.project.elements.find((el) => el.type === "character");
  return { voices: c.character.voices, mode: c.character.voiceMode, name: c.character.name };
});
console.log(JSON.stringify(draft, null, 2));
await page.screenshot({ path: "shots/debug-multivoice.png" });
await browser.close();
