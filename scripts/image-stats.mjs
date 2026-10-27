import { chromium } from "@playwright/test";
import fs from "node:fs";

const files = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage();
for (const file of files) {
  const b64 = fs.readFileSync(file).toString("base64");
  const stats = await page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = Math.min(240, img.width);
    c.height = Math.round((img.height / img.width) * c.width);
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    let sum = 0;
    let sum2 = 0;
    const colors = new Set();
    for (let i = 0; i < data.length; i += 4) {
      const v = (data[i] + data[i + 1] + data[i + 2]) / 3;
      sum += v;
      sum2 += v * v;
      colors.add(`${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4}`);
    }
    const n = data.length / 4;
    const mean = sum / n;
    return { width: img.width, height: img.height, mean, std: Math.sqrt(sum2 / n - mean * mean), colors: colors.size };
  }, `data:image/png;base64,${b64}`);
  console.log(file, JSON.stringify(stats));
}
await browser.close();
