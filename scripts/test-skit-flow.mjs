import { chromium } from "@playwright/test";

const base = "https://meme-stage.pages.dev";
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 160)));

await page.addInitScript(() => {
  window.__played = [];
  HTMLMediaElement.prototype.play = function () {
    window.__played.push(this.currentSrc || this.src);
    setTimeout(() => this.dispatchEvent(new Event("ended")), 240);
    return Promise.resolve();
  };
});

const snapshot = () =>
  page.evaluate(() => {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith("ms.draft.") && k !== "ms.draft.index");
    const items = keys.map((k) => JSON.parse(localStorage.getItem(k)));
    if (items.length === 0) return null;
    const p = items.sort((a, b) => b.savedAt - a.savedAt)[0].project;
    return {
      elements: p.elements.length,
      heights: p.elements.map((el) => Math.round(el.height)),
      events: p.events.length,
      cues: (p.performances?.[0]?.cues ?? []).map((c) => c.text),
    };
  });

await page.goto(`${base}/editor`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="canvas"] canvas');

// 随机熟人 adds one demo character that already ships a voice
for (let i = 0; i < 3; i++) {
  await page.getByRole("button", { name: "随机熟人" }).click();
  await page.waitForTimeout(500);
}
await page.waitForTimeout(1500);
console.log("after adding:", await snapshot());

await page.getByRole("button", { name: "批量", exact: true }).click();
await page.waitForTimeout(400);
console.log("bulk rows:", await page.locator("tbody tr").count());

await page.getByRole("button", { name: "全选" }).click();
await page.waitForTimeout(200);
await page.getByLabel("统一高度").fill("360");
const applyButtons = page.getByRole("button", { name: "应用" });
console.log("apply buttons:", await applyButtons.count());
// 应用 order: 命名前缀, 统一音量, 统一高度
await applyButtons.last().click();
await page.waitForTimeout(900);
console.log("after height:", await snapshot());

await page.getByLabel("互动配方").selectOption("threeRound");
await page.getByRole("button", { name: "一键生成互动" }).click();
await page.waitForTimeout(900);
console.log("after recipe:", await snapshot());

await page.getByRole("button", { name: /^剧本/ }).click();
await page.waitForTimeout(300);
const createBtn = page.getByRole("button", { name: "创建剧本" });
if (await createBtn.count()) await createBtn.click();
await page.waitForTimeout(600);

const importToggle = page.getByRole("button", { name: "导入", exact: true });
if (await importToggle.count()) {
  await importToggle.first().click();
} else {
  await page.getByRole("button", { name: "导入 CSV / JSON" }).click();
}
await page.waitForTimeout(400);
const names = await page.evaluate(() => {
  const keys = Object.keys(localStorage).filter((k) => k.startsWith("ms.draft.") && k !== "ms.draft.index");
  const items = keys.map((k) => JSON.parse(localStorage.getItem(k)));
  const p = items.sort((a, b) => b.savedAt - a.savedAt)[0].project;
  return p.elements.map((el) => el.character?.name ?? "");
});
console.log("cast:", names);

const csv = `order,actor,line,audio,action,waitAfter,spotlight
1,${names[0]},第一句：这波真的不亏,,bounce,120,
2,${names[1]},第二句：我听不懂但是喵,,shake,120,1
3,${names[2]},第三句：下班前发给我,,nod,120,`;
await page.getByLabel("剧本内容").fill(csv);
await page.getByRole("button", { name: "导入并替换剧本" }).click();
await page.waitForTimeout(1200);
console.log("after csv:", await snapshot());

await page.getByRole("button", { name: "试演" }).click();
await page.waitForTimeout(1500);
await page.getByTestId("performance-play").click();
const bubbles = [];
for (let i = 0; i < 14; i++) {
  await page.waitForTimeout(400);
  const texts = await page.locator('[data-testid="bubble"]').allInnerTexts();
  for (const t of texts) {
    const clean = t.replace(/\n/g, "|");
    if (!bubbles.includes(clean)) bubbles.push(clean);
  }
}
const played = await page.evaluate(() => window.__played.map((s) => s.split("/").pop()));
console.log("played:", played);
console.log("bubbles seen:", bubbles);
console.log("button:", (await page.getByTestId("performance-play").innerText()).trim());
await page.screenshot({ path: "shots/performance-3cast.png" });
console.log("errors", errors.slice(0, 5));
await browser.close();
