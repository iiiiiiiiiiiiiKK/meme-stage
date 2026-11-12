import { chromium } from "@playwright/test";

// Timing probe: how long does one local item take, and do all items finish?
const base = "https://meme-stage.pages.dev";
const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("pageerror", (e) => console.log("pageerror:", e.message));

await page.goto(`${base}/studio/batch`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);

await page.evaluate(async () => {
  const make = async (label, hue) => {
    const c = document.createElement("canvas");
    c.width = 320;
    c.height = 380;
    const ctx = c.getContext("2d");
    ctx.fillStyle = `hsl(${hue}, 30%, 30%)`;
    ctx.fillRect(0, 0, 320, 380);
    ctx.fillStyle = `hsl(${hue}, 60%, 76%)`;
    ctx.beginPath();
    ctx.arc(160, 140, 70, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `hsl(${(hue + 140) % 360}, 55%, 45%)`;
    ctx.fillRect(90, 230, 140, 150);
    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    return new File([blob], label, { type: "image/png" });
  };
  const zone = [...document.querySelectorAll("label")].find((el) => el.textContent?.includes("拖入图片"));
  const dt = new DataTransfer();
  dt.items.add(await make("a.png", 200));
  dt.items.add(await make("b.png", 60));
  zone.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
});
await page.waitForTimeout(3000);

const start = Date.now();
await page.getByRole("button", { name: "开始处理" }).click();
let snapshots = [];
for (let i = 0; i < 90; i++) {
  await page.waitForTimeout(2000);
  const text = await page.locator("body").innerText();
  const done = Number((text.match(/(\d+) 完成/) ?? [0, 0])[1]);
  const failed = Number((text.match(/(\d+) 失败/) ?? [0, 0])[1]);
  const working = Number((text.match(/(\d+) 处理中/) ?? [0, 0])[1]);
  snapshots.push({ t: Math.round((Date.now() - start) / 1000), done, failed, working });
  if (done + failed >= 2) break;
}
console.log("timeline:", snapshots.slice(-6));
console.log("final:", snapshots.at(-1));
await browser.close();
