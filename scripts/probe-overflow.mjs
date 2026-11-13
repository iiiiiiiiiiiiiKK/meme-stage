
import { chromium } from 'playwright';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 320, height: 568 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' });
for (const route of ['/sticker', '/editor']) {
  const page = await ctx.newPage();
  await page.goto('http://localhost:4517' + route, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const info = await page.evaluate(() => {
    const vw = innerWidth;
    const bad = [];
    for (const el of document.querySelectorAll('body *')) {
      const b = el.getBoundingClientRect();
      if (b.width < 1 || b.height < 1) continue;
      if (b.right > vw + 1) {
        bad.push({ tag: el.tagName, cls: (el.className || '').toString().slice(0, 80), left: Math.round(b.left), right: Math.round(b.right), w: Math.round(b.width), pos: getComputedStyle(el).position, scrollW: el.scrollWidth, clientW: el.clientWidth });
      }
    }
    return { vw, scrollW: document.documentElement.scrollWidth, count: bad.length, top: bad.filter(b => b.pos !== 'fixed').slice(0, 12) };
  });
  console.log(route, JSON.stringify(info, null, 1));
  await page.close();
}
await browser.close();
