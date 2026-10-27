import { chromium } from "@playwright/test";

const base = process.argv[2] || "https://meme-stage.pages.dev";
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 160)));
await page.addInitScript(() => {
  window.__played = [];
  HTMLMediaElement.prototype.play = function () {
    window.__played.push({ src: this.currentSrc || this.src, rate: this.playbackRate });
    setTimeout(() => this.dispatchEvent(new Event("ended")), 120);
    return Promise.resolve();
  };
  HTMLMediaElement.prototype.pause = function () {};
});

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

await page.goto(`${base}/editor`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="canvas"] canvas');
await page.getByRole("button", { name: "随机熟人" }).click();
await page.waitForTimeout(900);

await page.getByRole("button", { name: /文字生成语音/ }).click();
await page.getByLabel("要朗读的文字").fill("这是文字生成的语音测试。");
await page.getByLabel("语速").selectOption("1.2");
await page.getByRole("button", { name: "生成并添加" }).click();
await page.waitForTimeout(6000);
console.log("toast", (await page.locator("body").innerText()).match(/语音已生成[^\n]*/)?.[0]);

const draft = await draftOf();
const character = draft.project.elements.find((el) => el.type === "character");
const clips = character.character.voices;
const ttsClip = clips.find((clip) => clip.source === "tts");
console.log(
  JSON.stringify(
    {
      count: clips.length,
      tts: ttsClip
        ? { name: ttsClip.name, line: ttsClip.line, rate: ttsClip.rate, duration: ttsClip.duration, lang: ttsClip.lang, url: ttsClip.url }
        : null,
      badge: await page.getByText("TTS", { exact: true }).count(),
      errors,
    },
    null,
    2,
  ),
);
await page.screenshot({ path: "shots/tts-editor.png" });

// publish and verify the generated clip plays at the chosen speed
const id = page.url().split("/editor/")[1];
const key = await page.evaluate(() => localStorage.getItem("ms.editor.key"));
const project = await page.evaluate(async ({ id, key }) => {
  const res = await fetch(`/api/projects/${id}`, { headers: { "X-Editor-Key": key } });
  return (await res.json()).project.data;
}, { id, key });
const published = await page.evaluate(async ({ id, key, data }) => {
  const res = await fetch(`/api/projects/${id}/publish`, {
    method: "POST",
    headers: { "X-Editor-Key": key, "content-type": "application/json" },
    body: JSON.stringify({ data }),
  });
  return res.json();
}, { id, key, data: project });
console.log("published", published.url);

const viewer = await context.newPage();
await viewer.addInitScript(() => {
  window.__played = [];
  HTMLMediaElement.prototype.play = function () {
    window.__played.push({ src: this.currentSrc || this.src, rate: this.playbackRate });
    setTimeout(() => this.dispatchEvent(new Event("ended")), 100);
    return Promise.resolve();
  };
  HTMLMediaElement.prototype.pause = function () {};
});
await viewer.goto(published.url, { waitUntil: "domcontentloaded" });
await viewer.waitForSelector('[data-testid="visitor"] canvas');
const box = await viewer.locator('[data-testid="visitor"]').boundingBox();
const scale = Math.min((box.width - 48) / project.width, (box.height - 48) / project.height, 1.4);
const vx = box.x + (box.width - project.width * scale) / 2;
const vy = box.y + (box.height - project.height * scale) / 2;
const el = project.elements.find((item) => item.type === "character");
const cx = vx + (el.x + el.width / 2) * scale;
const cy = vy + (el.y + el.height / 2) * scale;
await viewer.mouse.click(cx, cy);
await viewer.waitForTimeout(700);
await viewer.mouse.click(cx, cy);
await viewer.waitForTimeout(700);
const played = await viewer.evaluate(() => window.__played);
console.log("viewer played", played);
console.log("tts rate present", played.some((p) => Math.abs(p.rate - 1.2) < 0.001));
await viewer.screenshot({ path: "shots/tts-published.png" });
await browser.close();
