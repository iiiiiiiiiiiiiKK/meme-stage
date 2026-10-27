import { chromium } from "@playwright/test";

const base = "https://meme-stage.pages.dev";
const browser = await chromium.launch({
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.grantPermissions(["microphone"], { origin: base });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));
page.on("response", async (res) => {
  if (res.url().includes("/api/assets")) {
    console.log("asset response", res.status(), (await res.text()).slice(0, 250));
  }
});
await page.addInitScript(() => {
  window.__previewStarts = [];
  const original = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...args) {
    window.__previewStarts.push({ args, state: this.context.state });
    try {
      return original.apply(this, args);
    } catch (e) {
      window.__previewStarts.push({ error: String(e) });
      throw e;
    }
  };
  window.__contexts = [];
  const OrigCtx = window.AudioContext;
  window.AudioContext = class extends OrigCtx {
    constructor(...args) {
      super(...args);
      window.__contexts.push(this);
    }
  };
});

await page.goto(`${base}/editor`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="canvas"] canvas');
await page.getByRole("button", { name: "随机熟人" }).click();
await page.waitForTimeout(700);
await page.locator("aside").last().getByRole("button", { name: "录音", exact: true }).click();
await page.getByRole("button", { name: "开始录音" }).click();
await page.waitForTimeout(1500);
await page.getByRole("button", { name: "停止录音" }).click();
await page.getByText("开始点", { exact: true }).waitFor({ timeout: 30000 });
await page.waitForTimeout(500);
console.log(
  "contexts",
  await page.evaluate(() => window.__contexts.map((c) => ({ state: c.state, sampleRate: c.sampleRate }))),
);
await page.getByRole("button", { name: "试听选区" }).click();
await page.waitForTimeout(600);
console.log("preview starts", await page.evaluate(() => window.__previewStarts));
console.log(
  "contexts after",
  await page.evaluate(() => window.__contexts.map((c) => ({ state: c.state, sampleRate: c.sampleRate }))),
);
await page.getByRole("button", { name: "保存到人物" }).click();
await page.waitForTimeout(5000);
const dialogVisible = await page.locator('[role="dialog"]').isVisible().catch(() => false);
const toastText = await page.locator("body").innerText();
console.log("dialog visible after save", dialogVisible);
console.log("error text", toastText.match(/[^\n]*(保存|失败|超过|上传)[^\n]*/g)?.slice(0, 5));
console.log("errors", errors);
await browser.close();
