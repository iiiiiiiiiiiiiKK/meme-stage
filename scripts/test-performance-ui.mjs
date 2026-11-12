import { chromium } from "@playwright/test";

const base = "https://meme-stage.pages.dev";
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 160)));

await page.addInitScript(() => {
  window.__played = [];
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    window.__played.push(this.currentSrc || this.src);
    setTimeout(() => this.dispatchEvent(new Event("ended")), 260);
    return Promise.resolve();
  };
  void play;
});

await page.goto(`${base}/editor`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="canvas"] canvas');
console.log("tabs:", await page.getByRole("button", { name: /剧本|互动|图层|批量/ }).allInnerTexts());

// 剧本 tab is default; create one from the existing demo cast
await page.getByRole("button", { name: "随机熟人" }).click();
await page.waitForTimeout(1200);

const bulk = await page.getByRole("button", { name: "批量", exact: true }).count();
console.log("bulk tab present:", bulk);
if (bulk) {
  await page.getByRole("button", { name: "批量", exact: true }).click();
  await page.waitForTimeout(400);
  const rows = await page.locator("tbody tr").count();
  const head = await page.locator("thead").innerText();
  console.log("bulk rows:", rows, "head:", head.replace(/\s+/g, " ").trim());
  await page.screenshot({ path: "shots/bulk-panel.png" });
}

// script tab
await page.getByRole("button", { name: /^剧本/ }).click();
await page.waitForTimeout(300);
const createBtn = page.getByRole("button", { name: "创建剧本" });
if (await createBtn.count()) {
  await createBtn.click();
  await page.waitForTimeout(500);
}
const cueCount = await page.locator('[data-testid="script-cue"]').count();
console.log("script cues:", cueCount);

// fill first two lines and export
const lineInputs = page.locator('[data-testid="script-cue"] input[aria-label*="台词"]');
const n = await lineInputs.count();
console.log("line inputs:", n);
if (n > 0) {
  await lineInputs.nth(0).fill("我们先试一下剧本演出");
  if (n > 1) await lineInputs.nth(1).fill("哦？听起来还行");
}
await page.screenshot({ path: "shots/script-panel.png" });

// run the performance in preview
await page.getByRole("button", { name: "试演" }).click();
await page.waitForTimeout(1500);
const playBtn = page.getByTestId("performance-play");
console.log("play button visible:", await playBtn.count());
if (await playBtn.count()) {
  await playBtn.click();
  await page.waitForTimeout(2500);
  const spoken = await page.evaluate(() => window.__played);
  console.log("performance played:", spoken.length, spoken.map((s) => s.split("/").pop()));
  const bubbles = await page.locator('[data-testid="bubble"]').allInnerTexts();
  console.log("bubbles:", bubbles.map((t) => t.slice(0, 24)));
  await page.screenshot({ path: "shots/performance.png" });
}

console.log("errors", errors.slice(0, 6));
await browser.close();
