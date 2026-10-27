import { chromium } from "@playwright/test";

const base = "https://meme-stage.pages.dev";
const browser = await chromium.launch({
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
  ],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.grantPermissions(["microphone"], { origin: base });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 160)));

await page.goto(`${base}/editor`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="canvas"] canvas');
await page.getByRole("button", { name: "随机熟人" }).click();
await page.waitForTimeout(700);

await page.locator("aside").last().getByRole("button", { name: "录音", exact: true }).click();
await page.getByRole("button", { name: "开始录音" }).click();
await page.waitForTimeout(2200);
await page.getByRole("button", { name: "停止录音" }).click();
await page.getByText("开始点", { exact: true }).waitFor({ timeout: 30000 });
await page.waitForTimeout(400);

const setRange = async (label, value) =>
  page.evaluate(
    ({ label, value }) => {
      const el = document.querySelector(`input[aria-label="${label}"]`);
      if (!el) throw new Error(`missing ${label}`);
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(el, String(value));
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    { label, value },
  );

const original = await page.getByText(/选区 .* 原始/).innerText();
await setRange("录音开始点", 0.3);
await setRange("录音结束点", 1.2);
await page.waitForTimeout(300);
const trimmed = await page.getByText(/选区 .* 原始/).innerText();
await page.getByLabel("录音台词").fill("这是我录的一句台词。");
await page.screenshot({ path: "shots/record-dialog.png" });
await page.getByRole("button", { name: "保存到人物" }).click();
await page.locator('[role="dialog"]').waitFor({ state: "detached", timeout: 60000 });
await page.waitForTimeout(1500);

const draft = await page.evaluate(() => {
  const keys = Object.keys(localStorage).filter((k) => k.startsWith("ms.draft.") && k !== "ms.draft.index");
  const items = keys.map((k) => JSON.parse(localStorage.getItem(k)));
  const d = items.sort((a, b) => b.savedAt - a.savedAt)[0];
  const c = d.project.elements.find((el) => el.type === "character");
  return c.character.voices.map((v) => ({
    source: v.source,
    url: v.url,
    duration: v.duration,
    line: v.line,
  }));
});
const rec = draft.find((v) => v.source === "record");
console.log("labels", { original, trimmed });
console.log("recorded", rec);
console.log("badge", await page.getByText("录音", { exact: true }).count());

if (rec?.url) {
  const res = await fetch(base + rec.url);
  const buf = new Uint8Array(await res.arrayBuffer());
  const view = new DataView(buf.buffer);
  const tag = (o) => String.fromCharCode(...buf.subarray(o, o + 4));
  const dataSize = view.getUint32(40, true);
  const byteRate = view.getUint32(28, true);
  console.log("wav", {
    status: res.status,
    type: res.headers.get("content-type"),
    riff: tag(0),
    wave: tag(8),
    bytes: buf.byteLength,
    headerDuration: Number((dataSize / byteRate).toFixed(2)),
  });
}
console.log("errors", errors);
await browser.close();
