import { webkit, devices } from "@playwright/test";

const base = process.argv[2] || "https://meme-stage.pages.dev";
const paths = process.argv.slice(3);
const browser = await webkit.launch();
const context = await browser.newContext({ ...devices["iPhone 13"], ignoreHTTPSErrors: true });

for (const path of paths) {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base + path, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(1200);
  const info = await page.evaluate(() => ({
    vw: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  console.log(path, JSON.stringify(info), errors.length ? errors : "");
  await page.close();
}
await browser.close();
