import { chromium } from "@playwright/test";

const base = process.argv[2] || "https://meme-stage.pages.dev";
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const page = await context.newPage();
page.on("console", (m) => console.log("[console]", m.type(), m.text().slice(0, 200)));
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto(`${base}/editor`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="canvas"] canvas');
console.log("url after load", page.url());
await page.getByRole("button", { name: "加文字" }).click();
await page.waitForTimeout(4000);
console.log("url after edit", page.url());
console.log(
  "draft keys",
  await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("ms.draft"))),
);
console.log("save status", await page.locator("header").innerText());
await page.screenshot({ path: "shots/debug-editor.png" });
await browser.close();
