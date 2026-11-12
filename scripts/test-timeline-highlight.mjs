import { chromium } from "@playwright/test";

// Verifies the timeline highlights the cue that is speaking right now.
const base = "https://meme-stage.pages.dev";
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 160)));

await page.addInitScript(() => {
  HTMLMediaElement.prototype.play = function () {
    setTimeout(() => this.dispatchEvent(new Event("ended")), 900);
    return Promise.resolve();
  };
});

await page.goto(`${base}/editor`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="canvas"] canvas');
for (let i = 0; i < 3; i++) {
  await page.getByRole("button", { name: "随机熟人" }).click();
  await page.waitForTimeout(450);
}
await page.waitForTimeout(1200);

await page.getByRole("button", { name: /^剧本/ }).first().click();
await page.waitForTimeout(300);
const create = page.getByRole("button", { name: "创建剧本" });
if (await create.count()) await create.click();
await page.waitForTimeout(600);
const cues = await page.locator('[data-testid="script-cue"]').count();
console.log("cues:", cues);

await page.getByRole("button", { name: "试演" }).click();
await page.waitForTimeout(1200);
await page.getByTestId("performance-play").click();

const seen = [];
for (let i = 0; i < 60; i++) {
  const idx = await page.locator('[data-testid="script-cue"]').evaluateAll((els) =>
    els.findIndex((el) => el.getAttribute("data-speaking") === "true"),
  );
  if (idx >= 0) seen.push(idx);
  await page.waitForTimeout(100);
}
const unique = [...new Set(seen)].sort((a, b) => a - b);
console.log("highlighted cue indexes:", unique);
await page.screenshot({ path: "shots/timeline-highlight.png" });
console.log("errors", errors.slice(0, 4));
await browser.close();
