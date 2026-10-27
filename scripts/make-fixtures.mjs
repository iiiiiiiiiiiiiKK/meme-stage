import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const out = path.resolve("tests/fixtures/people");
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 300, height: 400 }, deviceScaleFactor: 1 });

const colors = ["#ff5a5f", "#4d7cff", "#b6ff3c", "#ff4d9d", "#ffb020", "#2fbf71", "#9b5cff", "#00c2d1"];
for (let i = 0; i < 50; i++) {
  const color = colors[i % colors.length];
  await page.setContent(`<!doctype html><html><body style="margin:0;width:300px;height:400px;background:${color};display:grid;place-items:center;font-family:Arial Black,Arial;color:#07070a">
    <div style="text-align:center">
      <div style="font-size:120px;line-height:1;font-weight:900;text-shadow:6px 6px 0 #fff">${i + 1}</div>
      <div style="font-size:22px;font-weight:900;margin-top:8px">PERSON ${String(i + 1).padStart(2, "0")}</div>
    </div>
  </body></html>`);
  await page.screenshot({ path: path.join(out, `person-${String(i + 1).padStart(2, "0")}.png`) });
}
await browser.close();
console.log("wrote 50 fixtures");
