import { chromium } from "@playwright/test";

const base = "https://meme-stage.pages.dev";
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 160)));

const mockSpeech = () => {
  window.__spoken = [];
  class FakeUtterance {
    constructor(text) {
      this.text = text;
      this.rate = 1;
      this.pitch = 1;
      this.volume = 1;
      this.lang = "";
      this.voice = null;
      this.onend = null;
      this.onerror = null;
    }
  }
  Object.defineProperty(window, "SpeechSynthesisUtterance", {
    value: FakeUtterance,
    configurable: true,
  });
  const voices = [
    { voiceURI: "mock-zh", name: "Microsoft Huihui (Mock)", lang: "zh-CN", default: true, localService: true },
    { voiceURI: "mock-en", name: "Microsoft Zira (Mock)", lang: "en-US", default: false, localService: true },
  ];
  const fakeSynth = {
    getVoices: () => voices,
    speak: (u) => {
      window.__spoken.push({
        text: u.text,
        rate: u.rate,
        pitch: u.pitch,
        lang: u.lang,
        voice: u.voice?.voiceURI,
      });
      setTimeout(() => u.onend && u.onend(), 120);
    },
    cancel: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  Object.defineProperty(window, "speechSynthesis", { value: fakeSynth, configurable: true });
  window.__voices = voices;
  HTMLMediaElement.prototype.play = function () {
    setTimeout(() => this.dispatchEvent(new Event("ended")), 100);
    return Promise.resolve();
  };
  HTMLMediaElement.prototype.pause = function () {};
};

await page.addInitScript(mockSpeech);
await page.goto(`${base}/editor`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="canvas"] canvas');
await page.getByRole("button", { name: "随机熟人" }).click();
await page.waitForTimeout(900);
await page.getByRole("button", { name: /文字生成语音/ }).click();
await page.waitForTimeout(600);
await page.getByLabel("语音引擎").selectOption("device");
await page.waitForTimeout(400);
const options = await page.getByLabel("系统音色").locator("option").evaluateAll((els) =>
  els.map((el) => el.textContent),
);
console.log("device voices", options);
await page.getByLabel("语速").selectOption("1.2");
await page.getByLabel("音调").selectOption("1.2");
await page.getByLabel("要朗读的文字").fill("这是浏览器自带的朗读。");
await page.getByRole("button", { name: "生成并添加" }).click();
await page.waitForTimeout(2500);
const draft = await page.evaluate(() => {
  const keys = Object.keys(localStorage).filter((k) => k.startsWith("ms.draft.") && k !== "ms.draft.index");
  const items = keys.map((k) => JSON.parse(localStorage.getItem(k)));
  const d = items.sort((a, b) => b.savedAt - a.savedAt)[0];
  const c = d.project.elements.find((el) => el.type === "character");
  return c.character.voices.map((v) => ({
    source: v.source,
    text: v.text,
    rate: v.rate,
    pitch: v.pitch,
    voiceURI: v.voiceURI,
    lang: v.lang,
  }));
});
console.log("draft voices", JSON.stringify(draft, null, 2));
console.log("spoken in editor", await page.evaluate(() => window.__spoken));
await page.screenshot({ path: "shots/device-voice.png" });

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
await viewer.addInitScript(mockSpeech);
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
await viewer.waitForTimeout(600);
await viewer.mouse.click(cx, cy);
await viewer.waitForTimeout(900);
console.log("viewer spoken", await viewer.evaluate(() => window.__spoken));
console.log("errors", errors);
await viewer.screenshot({ path: "shots/device-voice-published.png" });
await browser.close();
