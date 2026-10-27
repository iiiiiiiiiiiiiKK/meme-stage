import { chromium } from "@playwright/test";

const base = "https://meme-stage.pages.dev";
const slug = process.argv[2] || "meme-1iro";
const project = (await fetch(`${base}/api/public/${slug}`).then((r) => r.json())).project.data;
const el = project.elements.find((item) => item.type === "character");
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.on("pageerror", (e) => console.log("pageerror", e.message));
page.on("console", (m) => m.type() === "error" && console.log("console", m.text().slice(0, 160)));
await page.addInitScript(() => {
  window.__spoken = [];
  window.__played = [];
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
  Object.defineProperty(window, "SpeechSynthesisUtterance", { value: FakeUtterance, configurable: true });
  const voices = [{ voiceURI: "mock-zh", name: "Mock", lang: "zh-CN", default: true, localService: true }];
  const synth = {
    getVoices: () => voices,
    speak: (u) => {
      window.__spoken.push({ text: u.text, rate: u.rate, pitch: u.pitch, lang: u.lang, voice: u.voice?.voiceURI });
      setTimeout(() => u.onend && u.onend(), 100);
    },
    cancel: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
  HTMLMediaElement.prototype.play = function () {
    window.__played.push(this.currentSrc || this.src);
    setTimeout(() => this.dispatchEvent(new Event("ended")), 100);
    return Promise.resolve();
  };
  HTMLMediaElement.prototype.pause = function () {};
});
await page.goto(`${base}/p/${slug}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="visitor"] canvas');
const box = await page.locator('[data-testid="visitor"]').boundingBox();
const scale = Math.min((box.width - 48) / project.width, (box.height - 48) / project.height, 1.4);
const vx = box.x + (box.width - project.width * scale) / 2;
const vy = box.y + (box.height - project.height * scale) / 2;
const cx = vx + (el.x + el.width / 2) * scale;
const cy = vy + (el.y + el.height / 2) * scale;
console.log("element", el.character.name, "voices", el.character.voices.length, "click", cx, cy, "scale", scale);
for (let i = 0; i < 4; i++) {
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(800);
  console.log(
    i,
    "spoken", await page.evaluate(() => window.__spoken),
    "played", await page.evaluate(() => window.__played),
    "bubble", (await page.locator("body").innerText()).match(/设备朗读|老板|这波|喵|别问/g),
  );
}
await page.screenshot({ path: "shots/debug-device.png" });
await browser.close();
