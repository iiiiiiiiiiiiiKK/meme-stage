import { chromium } from "@playwright/test";

// Verifies the CSV character-list import updates existing characters by name.
const base = "https://meme-stage.pages.dev";
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 160)));

await page.goto(`${base}/editor`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="canvas"] canvas');
for (let i = 0; i < 2; i++) {
  await page.getByRole("button", { name: "随机熟人" }).click();
  await page.waitForTimeout(500);
}
await page.waitForTimeout(1200);

const names = await page.evaluate(() => {
  const keys = Object.keys(localStorage).filter((k) => k.startsWith("ms.draft.") && k !== "ms.draft.index");
  const items = keys.map((k) => JSON.parse(localStorage.getItem(k)));
  return items.sort((a, b) => b.savedAt - a.savedAt)[0].project.elements.map((el) => el.character?.name);
});
console.log("cast:", names);

await page.getByRole("button", { name: "批量", exact: true }).click();
await page.waitForTimeout(400);
await page.getByRole("button", { name: "导入人物清单（CSV / JSON）" }).click();
await page.waitForTimeout(300);

const csv = [
  "name,line,bubble,volume,height",
  `${names[0]},清单台词一号,caption,0.5,300`,
  `${names[1]},清单台词二号,thought,0.7,320`,
  "不存在的人,不会生效,,,",
].join("\n");
await page.getByLabel("人物清单内容").fill(csv);
await page.getByRole("button", { name: "按清单更新" }).click();
await page.waitForTimeout(1000);

const result = await page.evaluate(() => {
  const keys = Object.keys(localStorage).filter((k) => k.startsWith("ms.draft.") && k !== "ms.draft.index");
  const items = keys.map((k) => JSON.parse(localStorage.getItem(k)));
  const p = items.sort((a, b) => b.savedAt - a.savedAt)[0].project;
  return p.elements.map((el) => ({
    name: el.character?.name,
    line: el.character?.line,
    bubble: el.character?.bubble.preset,
    volume: el.character?.voices[0]?.volume,
    height: Math.round(el.height),
    width: Math.round(el.width),
  }));
});
console.log("after import:", result);
console.log("dialog closed:", (await page.getByLabel("人物清单内容").count()) === 0);
console.log("errors", errors.slice(0, 4));
await browser.close();
