import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameState, validateGameState, biologicalAge, migrateLegacy, START_DATE } from '../../src/core/GameState.js';
import { createSaveManager } from '../../src/core/SaveManager.js';
import { advanceTime, advanceReal, passHours, TIME_SCALE } from '../../src/core/GameClock.js';
import { recordEvent, JOURNAL_LIMIT } from '../../src/core/EventBus.js';
import { formatDate, splitDate, hourOfDay, HOURS_PER_YEAR } from '../../src/core/time.js';
import { memoryStorage } from '../helpers/legacy.mjs';

test('new game starts in 2032 at noon with a full Mk0 and a valid state', () => {
  const s = createGameState({ name: 'Teszt Elek', ageYears: 34 });
  assert.deepEqual(validateGameState(s), []);
  assert.equal(Math.floor(s.clock.historicalDate), 2032);
  assert.equal(Math.round(hourOfDay(s.clock.historicalDate)), 12);
  assert.equal(s.chronoDevice.tier, 0);
  assert.equal(s.chronoDevice.charge, 1);
  assert.equal(s.events[0].type, 'PLAYER_CREATED');
  assert.equal(formatDate(START_DATE), '2032. máj. 30. 12:00');
});

test('clock: experienced time drives date, age, charge and needs together', () => {
  const s = createGameState({ ageYears: 30 });
  s.chronoDevice.charge = 0;
  advanceTime(s, 8);
  assert.equal(s.clock.experiencedHours, 8);
  assert.ok(Math.abs(s.clock.historicalDate - (START_DATE + 8 / HOURS_PER_YEAR)) < 1e-9);
  assert.ok(Math.abs(s.chronoDevice.charge - 8 / 24) < 1e-9, '8 h restores one third (10-year jump on Mk0)');
  assert.equal(s.survival.hunger, 10 + 16);
  assert.equal(s.survival.thirst, 10 + 24);
  advanceTime(s, 16);
  assert.equal(s.chronoDevice.charge, 1, 'full recharge after 24 experienced hours');
  assert.ok(biologicalAge(s) > 30 && biologicalAge(s) < 30.01);
});

test('clock: one real second is TIME_SCALE game seconds', () => {
  const s = createGameState();
  advanceReal(s, 60);
  assert.ok(Math.abs(s.clock.experiencedHours - TIME_SCALE / 60) < 1e-9);
  assert.equal(s.clock.realPlaySeconds, 60);
});

test('clock: sleeping reduces fatigue, starving eventually kills', () => {
  const s = createGameState();
  s.survival.fatigue = 80;
  passHours(s, 8, { sleeping: true });
  assert.equal(s.survival.fatigue, 16);
  let r = { died: false };
  for (let i = 0; i < 20 && !r.died; i++) r = advanceTime(s, 24);
  assert.ok(r.died);
  assert.equal(r.cause, 'kiszáradás');
});

test('event log keeps causal metadata and trims only journal events', () => {
  const s = createGameState();
  const e = recordEvent(s, 'ANCHOR_CREATED', { x: 1 }, { affected: ['church-st-mary'] });
  assert.equal(e.timelineId, 'main');
  assert.equal(e.seq, 2);
  for (let i = 0; i < JOURNAL_LIMIT + 50; i++) recordEvent(s, 'NPC_INTERACTION', {});
  assert.ok(s.events.some(x => x.type === 'ANCHOR_CREATED'), 'world events are never trimmed');
  assert.equal(s.events.filter(x => x.type === 'NPC_INTERACTION').length, JOURNAL_LIMIT);
  assert.throws(() => recordEvent(s, 'NOT_A_TYPE'));
});

test('save manager: round trip returns an identical state', () => {
  const store = memoryStorage();
  const sm = createSaveManager(store);
  const s = createGameState({ name: 'Mentés' });
  advanceTime(s, 5);
  sm.save(s, 'slot2', 'kézi');
  assert.deepEqual(sm.load('slot2'), JSON.parse(JSON.stringify(s)));
  assert.equal(sm.list().length, 1);
  assert.equal(sm.info('slot2').summary.name, 'Mentés');
  assert.throws(() => sm.save(s, 'nope'));
});

test('save manager: refuses invalid state and corrupt saves', () => {
  const store = memoryStorage();
  const sm = createSaveManager(store);
  const s = createGameState();
  s.chronoDevice.tier = 9;
  assert.throws(() => sm.save(s), /invalid state/);
  store.setItem('chronoverse.game.v1.autosave', JSON.stringify({ format: 'chronoverse-save', state: { schemaVersion: 1 } }));
  assert.throws(() => sm.load(), /Corrupt save/);
});

test('legacy keys are migrated once into a unified save', () => {
  const store = memoryStorage({
    'chronoverse.render.navigation.v1': JSON.stringify({ year: 1435.5, charge: 0.4, jumps: 3, tier: 1, x: 12, z: -7 }),
    'chronoverse.render.anchors.v1': JSON.stringify([{ id: 'church', year: 1435.2, x: 65, z: -28 }]),
    'chronoverse.survival.v1': JSON.stringify({ version: 1, players: { 'local-main': { hours: 40, hunger: 50, thirst: 60, fatigue: 20, health: 90, injury: 0, illness: 0, recallUntil: 0, dead: false } } }),
  });
  const sm = createSaveManager(store);
  const { state, migrated } = sm.loadOrMigrate();
  assert.ok(migrated);
  assert.equal(state.clock.historicalDate, 1435.5);
  assert.deepEqual([state.player.x, state.player.z, state.chronoDevice.tier, state.chronoDevice.successfulJumps], [12, -7, 1, 3]);
  assert.equal(state.anchors[0].objectId, 'church-st-mary');
  assert.equal(state.survival.thirst, 60);
  assert.equal(sm.loadOrMigrate().migrated, false, 'second load uses the unified save');
  assert.equal(migrateLegacy(memoryStorage()), null);
});

test('date helpers handle BC years', () => {
  assert.equal(splitDate(-8998.5).year, -8999);
  assert.ok(formatDate(-8998.5, false).startsWith('Kr. e. 9000.'));
  for (const y of [2032, 1435, -8999]) assert.equal(splitDate(y + 0.0001).year, y);
});
