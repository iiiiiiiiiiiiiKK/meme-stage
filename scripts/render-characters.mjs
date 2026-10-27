// Rasterises the original demo character SVGs into transparent PNGs.
// Usage: node scripts/render-characters.mjs
import { chromium } from "@playwright/test";
import { readdir, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const srcDir = path.join(root, "assets", "characters");
const outDir = path.join(root, "public", "demo");
await mkdir(outDir, { recursive: true });

const files = (await readdir(srcDir)).filter((f) => f.endsWith(".svg"));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 600, height: 800 }, deviceScaleFactor: 2 });

for (const file of files) {
  const name = path.basename(file, ".svg");
  await page.goto(pathToFileURL(path.join(srcDir, file)).href);
  await page.screenshot({
    path: path.join(outDir, `${name}.png`),
    omitBackground: true,
    clip: { x: 0, y: 0, width: 600, height: 800 },
  });
  // square-ish crop for lists / avatars is handled in the UI, keep full body here
  console.log("rendered", name);
}

// small avatar crop (head area) for sidebar lists
for (const file of files) {
  const name = path.basename(file, ".svg");
  await page.goto(pathToFileURL(path.join(srcDir, file)).href);
  await page.screenshot({
    path: path.join(outDir, `${name}-face.png`),
    omitBackground: true,
    clip: { x: 110, y: 120, width: 380, height: 380 },
  });
}

await browser.close();
console.log("done");
