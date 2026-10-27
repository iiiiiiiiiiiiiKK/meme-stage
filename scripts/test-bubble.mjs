import { chromium } from "@playwright/test";

const base = process.argv[2] || "https://meme-stage.pages.dev";
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 160)));

const draftOf = () =>
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
await page.getByRole("button", { name: "随机熟人" }).click();
await page.waitForTimeout(900);

const before = await draftOf();
const project = before.project;
const character = project.elements.find((el) => el.type === "character");
console.log("character", character.character.name, "voices", character.character.voices.length);

await page.getByRole("button", { name: "预览" }).click();
await page.waitForSelector('[data-testid="preview"] canvas');
await page.waitForTimeout(500);

const box = await page.locator('[data-testid="visitor"]').boundingBox();
const scale = Math.min((box.width - 48) / project.width, (box.height - 48) / project.height, 1.4);
const ox = box.x + (box.width - project.width * scale) / 2;
const oy = box.y + (box.height - project.height * scale) / 2;
const charX = ox + (character.x + character.width / 2) * scale;
const charY = oy + (character.y + character.height / 2) * scale;
await page.mouse.click(charX, charY);
await page.waitForTimeout(500);

const bubble = page.locator(".bubble-in").first();
const bubbleBefore = await bubble.boundingBox();
console.log("bubble before", bubbleBefore);
await page.mouse.move(bubbleBefore.x + bubbleBefore.width / 2, bubbleBefore.y + bubbleBefore.height / 2);
await page.mouse.down();
await page.mouse.move(bubbleBefore.x + bubbleBefore.width / 2 + 140, bubbleBefore.y + bubbleBefore.height / 2 - 90, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(700);
const bubbleAfter = await bubble.boundingBox();
console.log("bubble after", bubbleAfter);
console.log("screen delta", [Math.round(bubbleAfter.x - bubbleBefore.x), Math.round(bubbleAfter.y - bubbleBefore.y)]);

const afterDrag = await draftOf();
const dragged = afterDrag.project.elements.find((el) => el.id === character.id);
console.log("placement", dragged.character.bubblePlacement, "scale", scale.toFixed(2));

await page.screenshot({ path: "shots/bubble-drag.png" });
await page.getByRole("button", { name: "退出预览" }).click();
await page.waitForTimeout(500);

const xInput = page.locator("aside").last().getByLabel(/X 偏移/);
const yInput = page.locator("aside").last().getByLabel(/Y 偏移/);
const inspector = { x: await xInput.inputValue().catch(() => null), y: await yInput.inputValue().catch(() => null) };
console.log("inspector offsets", inspector);

const countBefore = (await page.locator('[data-testid="canvas"]').innerText()).match(/(\d+) 个人物/)?.[1];
await page.getByRole("button", { name: /把台词放到画布/ }).click();
await page.waitForTimeout(800);
const afterText = await draftOf();
console.log("elements before/after", project.elements.length, afterText.project.elements.length, "texts", afterText.project.elements.filter((e) => e.type === "text").length);
console.log("count badge", countBefore, (await page.locator('[data-testid="canvas"]').innerText()).match(/(\d+) 个人物/)?.[1]);

await page.getByText("已保存", { exact: true }).first().waitFor({ timeout: 15000 }).catch(() => undefined);
await page.waitForTimeout(1200);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="canvas"] canvas');
await page.waitForTimeout(900);
const reloaded = await draftOf();
const reloadedChar = reloaded.project.elements.find((el) => el.character?.name === character.character.name);
console.log("after reload placement", reloadedChar.character.bubblePlacement);
console.log("errors", errors);
await browser.close();
