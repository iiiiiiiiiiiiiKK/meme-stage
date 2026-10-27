import { chromium } from "@playwright/test";

const base = process.argv[2] || "https://meme-stage.pages.dev";
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

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
await page.waitForTimeout(700);
const initial = await draftOf();
const character = initial.project.elements.find((el) => el.type === "character");

await page.getByRole("button", { name: "预览" }).click();
await page.waitForSelector('[data-testid="preview"] canvas');
await page.waitForTimeout(400);
const pbox = await page.locator('[data-testid="visitor"]').boundingBox();
const ps = Math.min((pbox.width - 48) / initial.project.width, (pbox.height - 48) / initial.project.height, 1.4);
const px = pbox.x + (pbox.width - initial.project.width * ps) / 2;
const py = pbox.y + (pbox.height - initial.project.height * ps) / 2;
await page.mouse.click(px + (character.x + character.width / 2) * ps, py + (character.y + character.height / 2) * ps);
await page.waitForTimeout(400);
const bb = await page.locator(".bubble-in").first().boundingBox();
await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
await page.mouse.down();
await page.mouse.move(bb.x + bb.width / 2 + 150, bb.y + bb.height / 2 - 100, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(800);
await page.getByRole("button", { name: "退出预览" }).click();
await page.waitForTimeout(1800);

const id = page.url().split("/editor/")[1];
const key = await page.evaluate(() => localStorage.getItem("ms.editor.key"));
const current = await page.evaluate(async ({ id, key }) => {
  const res = await fetch(`/api/projects/${id}`, { headers: { "X-Editor-Key": key } });
  return res.json();
}, { id, key });
const project = current.project.data;
const saved = project.elements.find((el) => el.id === character.id);
const place = saved.character.bubblePlacement;

const published = await page.evaluate(async ({ id, key, data }) => {
  const res = await fetch(`/api/projects/${id}/publish`, {
    method: "POST",
    headers: { "X-Editor-Key": key, "content-type": "application/json" },
    body: JSON.stringify({ data }),
  });
  return res.json();
}, { id, key, data: project });
console.log("published", published.url, "placement", place);

const viewerContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const viewer = await viewerContext.newPage();
await viewer.addInitScript(() => {
  HTMLMediaElement.prototype.play = function () {
    setTimeout(() => this.dispatchEvent(new Event("ended")), 100);
    return Promise.resolve();
  };
  HTMLMediaElement.prototype.pause = function () {};
});
await viewer.goto(published.url, { waitUntil: "domcontentloaded" });
await viewer.waitForSelector('[data-testid="visitor"] canvas');
await viewer.waitForTimeout(500);
const box = await viewer.locator('[data-testid="visitor"]').boundingBox();
const scale = Math.min((box.width - 48) / project.width, (box.height - 48) / project.height, 1.4);
const vx = box.x + (box.width - project.width * scale) / 2;
const vy = box.y + (box.height - project.height * scale) / 2;
const cx = vx + (saved.x + saved.width / 2) * scale;
const cy = vy + (saved.y + saved.height / 2) * scale;
await viewer.mouse.click(cx, cy);
await viewer.waitForTimeout(700);
const bubble = await viewer.locator(".bubble-in").first().boundingBox();
const expectedX = vx + (saved.x + saved.width / 2 + place.offsetX) * scale;
const expectedBottom = vy + (saved.y + place.offsetY) * scale - 8;
const result = {
  saved: { x: saved.x, y: saved.y, w: saved.width, h: saved.height },
  viewport: { vx, vy, scale, box },
  click: { cx, cy },
  placement: place,
  bubble,
  actualCenterX: bubble.x + bubble.width / 2,
  expectedX,
  actualBottom: bubble.y + bubble.height,
  expectedBottom,
  dx: Math.round(bubble.x + bubble.width / 2 - expectedX),
  dy: Math.round(bubble.y + bubble.height - expectedBottom),
  bubbleText: await viewer.locator(".bubble-in").first().innerText(),
  errors,
};
console.log(JSON.stringify(result, null, 2));
await viewer.screenshot({ path: "shots/bubble-published.png" });
await browser.close();
