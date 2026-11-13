
import { chromium, webkit, devices } from 'playwright';
import fs from 'node:fs/promises';

const BASE = process.argv[2] || 'http://localhost:4517';
const TAG = process.argv[3] || 'local';
const routes = ['/', '/sticker', '/sticker/batch', '/editor', '/library', '/p/demo'];
const targets = [
  ['iphone13', webkit, devices['iPhone 13']],
  ['iphonese', webkit, devices['iPhone SE']],
  ['pixel7', chromium, devices['Pixel 7']],
];
const dir = 'shots/mobile-audit';
await fs.mkdir(dir, { recursive: true });
const rows = [];
for (const [name, engine, device] of targets) {
  const browser = await engine.launch();
  const ctx = await browser.newContext({ ...device, ignoreHTTPSErrors: true });
  for (const route of routes) {
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message.slice(0, 90)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 90)); });
    let status = 0;
    try {
      const resp = await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 25000 });
      status = resp ? resp.status() : 0;
      await page.waitForTimeout(1500);
    } catch (e) { errors.push('GOTO ' + e.message.slice(0, 60)); }
    const m = await page.evaluate(() => {
      const d = document.documentElement;
      const x = document.querySelector('a[href*="x.com/0xkillcoin"]');
      let xr = null;
      if (x) { const b = x.getBoundingClientRect(); xr = { w: Math.round(b.width), h: Math.round(b.height), top: Math.round(b.top), shown: getComputedStyle(x).display !== 'none' && b.width > 0 }; }
      const small = [...document.querySelectorAll('button, a, [role=button]')].filter(el => { const b = el.getBoundingClientRect(); const cs = getComputedStyle(el); return b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && (b.height < 30 || b.width < 30); });
      const wide = [...document.querySelectorAll('body *')].filter(el => { const b = el.getBoundingClientRect(); return b.width > innerWidth + 2 && getComputedStyle(el).position !== 'fixed' && b.left < 1; }).slice(0, 2).map(el => el.tagName + ':' + Math.round(el.getBoundingClientRect().width));
      return { vw: innerWidth, overflow: d.scrollWidth - d.clientWidth, xr, smallCount: small.length, smallSample: small.slice(0, 3).map(el => (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 14) + ':' + Math.round(el.getBoundingClientRect().height)), wideEls: wide, title: document.title.slice(0, 40) };
    });
    const shot = dir + '/' + TAG + '-' + name + route.replace(/[\/]/g, '_') + '.png';
    await page.screenshot({ path: shot });
    rows.push({ tag: TAG, device: name, route, status, ...m, err: [...new Set(errors)].slice(0, 2), shot });
    await page.close();
  }
  await ctx.close();
  await browser.close();
}
await fs.writeFile(dir + '/report-' + TAG + '.json', JSON.stringify(rows, null, 1));
for (const r of rows) console.log([r.tag, r.device, r.route, 'st=' + r.status, 'vw=' + r.vw, 'ovf=' + r.overflow, 'x=' + (r.xr ? r.xr.w + 'x' + r.xr.h + '@' + r.xr.top : 'none'), 'small=' + r.smallCount, 'err=' + (r.err[0] || '-')].join(' | '));
