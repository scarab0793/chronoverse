// End-to-end browser test in headless Chromium. Plays through the Phase 1
// acceptance criteria (design doc §40) using the real UI and keyboard, and
// fails on any console error, uncaught exception or failed request.
// The window.chronoverse hook is only used to read state (and, in two marked
// places, to teleport the player so the test does not have to walk).

import { createRequire } from 'node:module';
import { startServer } from './server.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const { server, url } = await startServer();
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let failures = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) failures++; };

async function newPage(ctx) {
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', e => p.errors.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') p.errors.push('console: ' + m.text()); });
  p.on('requestfailed', r => p.errors.push('requestfailed: ' + r.url()));
  p.on('response', r => { if (r.status() >= 400) p.errors.push('HTTP ' + r.status() + ': ' + r.url()); });
  return p;
}
const S = (p, fn, arg) => p.evaluate(fn, arg);
const gameReady = p => p.waitForFunction(() => window.chronoverse && !document.getElementById('loading'));

try {
  // ---- legacy/debug pages still load cleanly
  {
    const ctx = await browser.newContext();
    for (const page of ['debug.html', 'terrain.html']) {
      const p = await newPage(ctx);
      await p.goto(url + page);
      await p.waitForTimeout(2000);
      check(p.errors.length === 0, `${page}: no console errors ${p.errors.length ? JSON.stringify(p.errors) : ''}`);
      if (page === 'debug.html') check(/^16\/16 modul • 808 rekord/.test(await p.textContent('#dbAudit')), 'debug.html: database audit 16/16, 808 records');
      await p.close();
    }
    await ctx.close();
  }

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  let p = await newPage(ctx);

  // 1–2: open the game, create a character
  await p.goto(url);
  check(await p.isHidden('#continuePanel'), '1. launcher opens with no save (no continue button)');
  await p.fill('#name', 'Teszt Anna');
  await p.selectOption('#sex', 'female');
  await p.fill('#age', '34');
  await p.click('button[type=submit]');
  await p.waitForURL(/render\.html/);
  await gameReady(p);
  let s = await S(p, () => window.chronoverse.state);
  check(s.character.name === 'Teszt Anna' && s.character.ageYears === 34, '2. character created from the launcher form');

  // 3: appears in 2032 in a 3D world
  check(Math.floor(s.clock.historicalDate) === 2032, `3. starts in 2032 (${s.clock.historicalDate.toFixed(4)})`);
  await p.waitForTimeout(1500);
  const stats = await S(p, () => window.chronoverse.renderStats());
  check(stats.buildings > 10 && stats.trees > 50, `3. 3D world rendered (${stats.buildings} buildings, ${stats.trees} trees, ${stats.npcs} NPCs)`);
  check((await p.textContent('#lens')).includes('2032'), '3. ChronoLens HUD shows the date');

  // 4: free movement with the keyboard
  const before = await S(p, () => ({ ...window.chronoverse.state.player }));
  await p.locator('#view canvas').focus();
  await p.keyboard.down('w'); await p.waitForTimeout(1200); await p.keyboard.up('w');
  const after = await S(p, () => ({ ...window.chronoverse.state.player }));
  check(Math.hypot(after.x - before.x, after.z - before.z) > 2, `4. W moves the player (${Math.hypot(after.x - before.x, after.z - before.z).toFixed(1)} m)`);

  // 5: talk to an NPC (teleport next to the nearest visible villager)
  await S(p, () => {
    const c = window.chronoverse, s = c.state;
    const n = c.npcs.snapshot(s.clock.historicalDate).find(n => n.visible);
    s.player.x = n.x + 1; s.player.z = n.z;
  });
  await p.waitForTimeout(800);
  await p.keyboard.press('e');
  const talk = await p.textContent('#talk');
  s = await S(p, () => window.chronoverse.state);
  check(Object.keys(s.npcs.memories).length === 1 && /ChronoLens/.test(talk), `5. E talks to an NPC: "${talk.slice(0, 90)}…"`);
  await S(p, () => { const s = window.chronoverse.state; s.player.x = 0; s.player.z = 6; });

  // 12: needs change with time (measured before the jump)
  const needs0 = s.survival;
  await p.waitForTimeout(3000);
  const needs1 = (await S(p, () => window.chronoverse.state)).survival;
  check(needs1.hunger > needs0.hunger && needs1.thirst > needs0.thirst && needs1.fatigue > needs0.fatigue, `12. hunger/thirst/fatigue rise with play time (${needs0.thirst.toFixed(2)} → ${needs1.thirst.toFixed(2)})`);

  // 6–10: open the device with T, target 2002, jump
  await p.keyboard.press('t');
  check(await p.isVisible('#deviceDialog'), '6. T opens the time device');
  const def = Number(await p.inputValue('#jTarget'));
  check(Math.abs(def - (s.clock.historicalDate - 30)) < 0.01, `7. first target defaults to 30 years back (${def.toFixed(3)})`);
  await p.fill('#jTarget', '2002.41');
  await p.click('#jJump');
  await p.waitForTimeout(300);
  const jumpStatus = await p.textContent('#jStatus');
  s = await S(p, () => window.chronoverse.state);
  check(!(await p.isVisible('#deviceDialog')) && s.chronoDevice.successfulJumps === 1, `8. jump executed ${jumpStatus}`);
  check(s.clock.historicalDate >= 2000.4 && s.clock.historicalDate <= 2004.41, `9. arrived in ${s.clock.historicalDate.toFixed(3)} (2002 ± 2)`);
  check(await S(p, () => { const c = window.chronoverse, s = c.state; return c.world.isSafeLanding(s.player.x, s.player.z, s.clock.historicalDate); }), '9. landing point is safe');
  check(s.chronoDevice.charge < 0.05, `10. energy dropped to ${(s.chronoDevice.charge * 100).toFixed(1)}%`);
  await p.waitForTimeout(1200);
  const sig2002 = await S(p, () => window.chronoverse.world.buildingsAt(window.chronoverse.state.clock.historicalDate).map(b => b.id).join());
  check(!sig2002.includes('community') && sig2002.includes('supermarket'), '9. environment matches 2002 (no 2004 community centre yet)');

  // 11: energy recharges with lived time (sleep 8 h via inventory)
  await p.keyboard.press('i');
  await p.click('#invSleep');
  s = await S(p, () => window.chronoverse.state);
  check(Math.abs(s.chronoDevice.charge - (8 / 24)) < 0.05, `11. 8 h of sleep recharges ~33% (${(s.chronoDevice.charge * 100).toFixed(1)}%)`);
  await p.click('#invClose');

  // 13: place a time anchor on the church (teleport to its door)
  await S(p, () => { const s = window.chronoverse.state; s.player.x = 65; s.player.z = -28.6; s.player.yaw = 0; });
  await p.waitForTimeout(300);
  await p.keyboard.press('h');
  s = await S(p, () => window.chronoverse.state);
  check(s.anchors.length === 1 && s.anchors[0].objectId === 'church-st-mary' && s.anchors[0].timelineId === 'main', '13. H places an anchor on the church (timeline-bound)');
  check((await p.textContent('#lens')).includes('Szent Mária-templom: aktív'), '13. ChronoLens lists the anchor as active');

  // 14: manual save to slot 1
  await p.keyboard.press('m');
  await p.locator('#slots .slot').first().getByText('Mentés ide').click();
  check((await p.textContent('#menuNote')).includes('slot1'), '14. manual save to slot 1');
  const saved = await S(p, () => JSON.stringify(window.chronoverse.state)); // time is paused while the menu is open
  await p.click('#menuClose');

  // 15: reload restores the same world state
  await p.goto(url + 'render.html?slot=slot1');
  await gameReady(p);
  const stored = await S(p, () => JSON.parse(localStorage.getItem('chronoverse.game.v1.slot1')).state);
  const loaded = await S(p, () => JSON.parse(JSON.stringify(window.chronoverse.state)));
  const a = JSON.parse(saved), b = loaded;
  const keys = ['player', 'chronoDevice', 'anchors', 'npcs', 'inventory', 'character', 'events', 'timelineId', 'worldId'];
  const diff = keys.filter(k => JSON.stringify(a[k]) !== JSON.stringify(stored[k]));
  check(JSON.stringify(stored) === JSON.stringify(a), `15. slot 1 holds exactly the in-game state ${diff.join(',')}`);
  const diffLoaded = keys.filter(k => k !== 'chronoDevice' && JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  const dt = (b.clock.experiencedHours - a.clock.experiencedHours) * 60;
  check(diffLoaded.length === 0 && dt >= 0 && dt < 1 && Math.abs(b.clock.historicalDate - a.clock.historicalDate) < 1e-5, `15. reload restores position, anchors, NPC memories, inventory, events (clock resumed +${dt.toFixed(2)} game min) ${diffLoaded.join(',')}`);
  const sig = await S(p, () => window.chronoverse.world.buildingsAt(window.chronoverse.state.clock.historicalDate).map(b => b.id).join());
  check(sig === sig2002, '15. same buildings after reload');

  // anchor-assisted return: jump forward 10 years to the church anchor
  await S(p, () => { const s = window.chronoverse.state; s.player.x = 200; s.player.z = 200; s.chronoDevice.charge = 1; });
  await p.keyboard.press('t');
  await p.selectOption('#jAnchor', { index: 1 });
  await p.fill('#jTarget', String((b.clock.historicalDate + 10).toFixed(3)));
  await p.click('#jJump');
  s = await S(p, () => window.chronoverse.state);
  const church = await S(p, () => window.chronoverse.world.getObject('church-st-mary'));
  const dist = Math.hypot(s.player.x - church.x, s.player.z - (church.z + church.d / 2 + 3));
  check(s.chronoDevice.successfulJumps === 2 && dist < 1200, `return to a visited place via anchor: ${dist.toFixed(0)} m from the church door (Mk0 + anchor ≤ 1 km error)`);

  // 16: everything above used the game page only
  check(!p.url().includes('debug'), '16. no developer dashboard used for core gameplay');
  check(p.errors.length === 0, `game page: no console errors ${p.errors.length ? JSON.stringify(p.errors) : ''}`);

  // ETR / death: force a fatal state and verify the recall path
  await S(p, () => { const s = window.chronoverse.state; s.survival.thirst = 100; s.survival.hunger = 100; s.survival.health = 0.01; s.clock.historicalDate = 2010.2; });
  await p.waitForTimeout(1500);
  s = await S(p, () => window.chronoverse.state);
  const recalled = s.events.some(e => e.type === 'EMERGENCY_RECALL'), died = s.events.some(e => e.type === 'CHARACTER_DEATH');
  check(recalled || died, `ETR handled a fatal state (${recalled ? 'recalled to ' + s.clock.historicalDate.toFixed(2) : 'ETR malfunctioned, character died'})`);
  if (recalled) check(s.chronoDevice.lockedUntilHours - s.clock.experiencedHours > 47, 'ETR locks the device for 48 h');

  // Launcher offers "continue" afterwards
  await p.goto(url);
  check(await p.isVisible('#continue'), 'launcher shows Continue for an existing save');
  check(p.errors.length === 0, `launcher: no console errors ${p.errors.length ? JSON.stringify(p.errors) : ''}`);

  // Legacy migration: a browser holding only the old render.html keys
  const legacy = await browser.newContext();
  const lp = await newPage(legacy);
  await lp.goto(url + 'debug.html');
  await S(lp, () => { localStorage.clear(); localStorage.setItem('chronoverse.render.navigation.v1', JSON.stringify({ year: 1435.4, charge: 0.5, jumps: 7, tier: 0, x: 10, z: 4 })); localStorage.setItem('chronoverse.render.anchors.v1', JSON.stringify([{ id: 'church', year: 1435.1, x: 65, z: -28 }])); });
  await lp.goto(url + 'render.html');
  await gameReady(lp);
  s = await S(lp, () => window.chronoverse.state);
  check(s.clock.historicalDate === 1435.4 || Math.abs(s.clock.historicalDate - 1435.4) < 0.001, 'legacy render.html save migrated into the unified GameState');
  check(s.anchors.length === 1 && s.chronoDevice.successfulJumps === 7, 'legacy anchor and jump count migrated');
  await legacy.close();
  await ctx.close();
} catch (e) {
  console.error(e);
  failures++;
} finally {
  await browser.close();
  server.close();
}
console.log(failures ? `${failures} check(s) failed` : 'all browser checks passed');
process.exit(failures ? 1 : 0);
