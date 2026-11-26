// Browser smoke test: loads every page in headless Chromium, fails on any
// console error / uncaught exception / failed request, and checks basic flows.
import { createRequire } from 'node:module';
// CommonJS require so a globally installed Playwright (NODE_PATH) is found too.
const { chromium } = createRequire(import.meta.url)('playwright');
import { startServer } from './server.mjs';

const { server, url } = await startServer();
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let failures = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) failures++; };

async function open(page) {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  p.on('requestfailed', r => errors.push('requestfailed: ' + r.url()));
  p.on('response', r => { if (r.status() >= 400) errors.push('HTTP ' + r.status() + ': ' + r.url()); });
  await p.goto(url + page);
  return { ctx, p, errors };
}

try {
  for (const page of ['index.html', 'render.html', 'terrain.html']) {
    const { ctx, p, errors } = await open(page);
    await p.waitForTimeout(2500);
    check(errors.length === 0, `${page}: no console errors ${errors.length ? JSON.stringify(errors) : ''}`);
    if (page === 'index.html') {
      const audit = await p.textContent('#dbAudit');
      check(/^16\/16 modul • 808 rekord/.test(audit), `index.html: database audit "${audit}"`);
    }
    if (page === 'render.html') {
      const hud = await p.textContent('#hud');
      check(hud.includes('2032'), `render.html: 3D HUD running "${hud}"`);
      await p.click('#device');
      await p.fill('#targetYear', '2002');
      await p.click('#jump3');
      const status = await p.textContent('#deviceStatus');
      check(!status.startsWith('Érvénytelen'), `render.html: 2032 → 2002 jump request accepted "${status}"`);
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log(failures ? `${failures} check(s) failed` : 'all browser checks passed');
process.exit(failures ? 1 : 0);
