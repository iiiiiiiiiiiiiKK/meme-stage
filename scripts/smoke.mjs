import { chromium } from "@playwright/test";

const url = process.argv[2] || "https://meme-stage.pages.dev/";
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
const failed = [];
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});
page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
page.on("requestfailed", (req) => failed.push(`${req.method()} ${req.url()} ${req.failure()?.errorText}`));
await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
await page.waitForTimeout(1200);
console.log("title:", await page.title());
console.log("h1:", (await page.locator("h1").first().textContent())?.replace(/\s+/g, " ").slice(0, 120));
console.log("canvas count:", await page.locator("canvas").count());
console.log("buttons:", (await page.locator("button, a").allTextContents()).slice(0, 20).map((t) => t.trim()).filter(Boolean));
console.log("console errors:", errors);
console.log("failed requests:", failed);
await page.screenshot({ path: "shots/home-desktop.png", fullPage: false });
await browser.close();
