// Regression tests for the legacy js/ modules (dashboard sandboxes).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLegacy, memoryStorage } from '../helpers/legacy.mjs';

test('ChronoSurvival: needs grow per hour, ETR triggers once then death', () => {
  const s = loadLegacy('chrono-survival.js').create(memoryStorage());
  let r = s.act('local-main', 'wait', 8);
  assert.deepEqual([r.state.hours, r.state.hunger, r.state.thirst, r.state.fatigue], [8, 16, 24, 16]);
  for (let i = 0; i < 20 && !r.recalled; i++) r = s.act('local-main', 'wait', 48);
  assert.ok(r.recalled, 'first fatal state triggers ETR');
  assert.equal(r.state.recallUntil, r.state.hours + 48);
});

test('ChronoPersistence: round-trip and rejects invalid tier', () => {
  const p = loadLegacy('chrono-persistence.js').create(memoryStorage());
  const state = { year: 2032, lat: 52.62, lon: 1.73, charge: 1, jumps: 0, anchors: [] };
  p.save(state, 0);
  assert.equal(JSON.stringify(p.load().state), JSON.stringify(state));
  assert.throws(() => p.save(state, 4));
});

test('ChronoWorld: build/destroy events form a dated snapshot', () => {
  const w = loadLegacy('chrono-world.js').create(memoryStorage());
  const id = w.build('local-main', 1435, 'Ház', 100, 100);
  w.destroy('local-main', 1500, id);
  assert.equal(w.snapshot('local-main', 1400).length, 0);
  assert.equal(w.snapshot('local-main', 1450).length, 1);
  assert.equal(w.snapshot('local-main', 1600).length, 0);
});
