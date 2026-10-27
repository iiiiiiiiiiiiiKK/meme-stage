import { webkit, devices } from "@playwright/test";

const base = process.argv[2] || "https://meme-stage.pages.dev";
const path = process.argv[3] || "/p/demo";
const browser = await webkit.launch();
const context = await browser.newContext({ ...devices["iPhone 13"], ignoreHTTPSErrors: true });
const page = await context.newPage();
await page.goto(base + path, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="visitor"] canvas');
await page.waitForTimeout(600);
const info = await page.evaluate(() => {
  const vw = window.innerWidth;
  const offenders = [];
  for (const el of document.querySelectorAll("*")) {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.right > vw + 0.5) {
      offenders.push({
        tag: el.tagName,
        cls: (el.getAttribute("class") ?? "").slice(0, 110),
        text: (el.textContent ?? "").trim().slice(0, 40),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        width: Math.round(rect.width),
      });
    }
  }
  return {
    vw,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScroll: document.body.scrollWidth,
    offenders: offenders.slice(0, 20),
  };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
