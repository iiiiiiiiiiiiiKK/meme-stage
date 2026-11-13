
import { webkit, devices } from 'playwright';
const browser = await webkit.launch();
const ctx = await browser.newContext({ ...devices['iPhone SE'], ignoreHTTPSErrors: true });
for (const route of ['/', '/sticker', '/sticker/batch', '/editor', '/library']) {
  const page = await ctx.newPage();
  await page.goto('http://localhost:4517' + route, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const m = await page.evaluate(() => {
    const vw = innerWidth;
    const x = document.querySelector('a[href*="x.com/0xkillcoin"]');
    const xb = x ? x.getBoundingClientRect() : null;
    const offenders = [];
    for (const el of document.querySelectorAll('body *')) {
      const b = el.getBoundingClientRect();
      if (b.width < 1 || b.height < 1) continue;
      if (b.right > vw + 1 && getComputedStyle(el).position !== 'fixed') { offenders.push(el.tagName + ':' + (el.className||'').toString().slice(0,30) + ' r=' + Math.round(b.right)); if (offenders.length > 3) break; }
    }
    return { vw, scrollW: document.documentElement.scrollWidth, overflow: document.documentElement.scrollWidth - vw, x: xb ? Math.round(xb.width) + 'x' + Math.round(xb.height) + '@' + Math.round(xb.top) : 'none', offenders };
  });
  console.log(route, JSON.stringify(m));
  await page.close();
}
await browser.close();
