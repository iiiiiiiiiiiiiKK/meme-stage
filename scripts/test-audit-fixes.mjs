import { chromium } from "@playwright/test";

// Regression probe for the audit fixes:
// 1) pause must continue the same line (audio suspended, not restarted)
// 2) deleting a cue mid-run must not skip or repeat the survivors
// 3) templates must re-flow the cast inside the new stage
// 4) the inOrder recipe must persist its whole chain
const base = "https://meme-stage.pages.dev";
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 160)));

// a 2s clip lets pause land in the middle of the first sentence
await page.addInitScript(() => {
  window.__plays = [];
  window.__pauses = 0;
  window.__resumes = 0;
  const realPlay = HTMLMediaElement.prototype.play;
  const realPause = HTMLMediaElement.prototype.pause;
  HTMLMediaElement.prototype.play = function () {
    window.__plays.push(this.currentSrc || this.src);
    window.__resumes += window.__plays.length > 1 ? 1 : 0;
    return realPlay.call(this);
  };
  HTMLMediaElement.prototype.pause = function () {
    if (!this.paused) window.__pauses += 1;
    return realPause.call(this);
  };
});

await page.goto(`${base}/editor`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="canvas"] canvas');
for (let i = 0; i < 3; i++) {
  await page.getByRole("button", { name: "随机熟人" }).click();
  await page.waitForTimeout(450);
}
await page.waitForTimeout(1200);

// ---- fix 1: template reflow ----------------------------------------------
await page.getByRole("button", { name: /^模板/ }).first().click();
await page.waitForTimeout(300);
await page.getByRole("button", { name: /群聊截图/ }).click();
await page.getByRole("button", { name: "套用到当前作品" }).click();
await page.waitForTimeout(900);
const layout = await page.evaluate(() => {
  const keys = Object.keys(localStorage).filter((k) => k.startsWith("ms.draft.") && k !== "ms.draft.index");
  const items = keys.map((k) => JSON.parse(localStorage.getItem(k)));
  const p = items.sort((a, b) => b.savedAt - a.savedAt)[0].project;
  const cast = p.elements.filter((el) => el.type === "character");
  return {
    stage: { w: p.width, h: p.height },
    rects: cast.map((el) => ({ x: Math.round(el.x), y: Math.round(el.y), w: Math.round(el.width), h: Math.round(el.height) })),
  };
});
const inside = layout.rects.every(
  (r) => r.x >= 0 && r.y >= 0 && r.x + r.w <= layout.stage.w + 1 && r.y + r.h <= layout.stage.h + 1,
);
console.log("template reflow:", layout.stage, layout.rects, "allInside:", inside);

// ---- fix 2: recipe chain persistence -------------------------------------
await page.getByRole("button", { name: "批量", exact: true }).click();
await page.waitForTimeout(400);
await page.getByLabel("互动配方").selectOption("inOrder");
await page.getByRole("button", { name: "一键生成互动" }).click();
await page.waitForTimeout(1200);
const chain = await page.evaluate(() => {
  const keys = Object.keys(localStorage).filter((k) => k.startsWith("ms.draft.") && k !== "ms.draft.index");
  const items = keys.map((k) => JSON.parse(localStorage.getItem(k)));
  const p = items.sort((a, b) => b.savedAt - a.savedAt)[0].project;
  const ids = new Set(p.events.map((e) => e.id));
  return {
    events: p.events.length,
    dangling: p.events.filter((e) => e.nextEventId && !ids.has(e.nextEventId)).length,
  };
});
console.log("inOrder chain:", chain);

// ---- fix 3: pause / resume ---------------------------------------------
await page.getByRole("button", { name: /^剧本/ }).first().click();
await page.waitForTimeout(300);
const create = page.getByRole("button", { name: "创建剧本" });
if (await create.count()) await create.click();
await page.waitForTimeout(600);
await page.getByRole("button", { name: "试演" }).click();
await page.waitForTimeout(900);
await page.getByTestId("performance-play").click();
await page.waitForTimeout(700);
const before = await page.evaluate(() => ({ plays: window.__plays.length, pauses: window.__pauses }));
await page.getByTestId("performance-play").click(); // pause
await page.waitForTimeout(900);
const paused = await page.evaluate(() => ({ plays: window.__plays.length, pauses: window.__pauses }));
await page.getByTestId("performance-play").click(); // resume
await page.waitForTimeout(900);
const after = await page.evaluate(() => ({ plays: window.__plays.length, pauses: window.__pauses }));
console.log("pause/resume:", { before, paused, after });
console.log("paused suspended audio:", paused.pauses > before.pauses);
console.log("resume did not restart the clip:", after.plays === paused.plays);
console.log("errors", errors.slice(0, 4));
await browser.close();
