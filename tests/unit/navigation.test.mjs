import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameState, START_DATE } from '../../src/core/GameState.js';
import { createWorld } from '../../src/world/WorldModel.js';
import { planJump, applyJump, TIERS, HARD_LIMIT, deviceTier, errorFactor, anchorStatus, findLanding } from '../../src/navigation/ChronoNavigation.js';
import { placeAnchor, touchableObject } from '../../src/navigation/ChronoAnchor.js';
import { handleFatalState, ETR_LOCK_HOURS } from '../../src/navigation/EmergencyRecall.js';
import { advanceTime } from '../../src/core/GameClock.js';
import { seededRandom } from '../../src/core/random.js';
import { geodesicKm } from '../../src/world/geo.js';

const setup = () => {
  const state = createGameState();
  const world = createWorld({ getEvents: () => state.events, getTimelineId: () => state.timelineId });
  return { state, world };
};

test('Mk0–Mk3 table matches the design document and never exceeds 50 y / 500 km', () => {
  assert.deepEqual(TIERS.map(t => [t.id, t.years, t.km, t.timeErrorYears, t.spaceErrorKm]), [
    ['Mk0', 30, 200, 2, 20], ['Mk1', 35, 300, 1.5, 10], ['Mk2', 42, 400, 0.8, 3], ['Mk3', 50, 500, 0.2, 0.25]]);
  for (let tier = 0; tier < 4; tier++) {
    const t = deviceTier({ tier });
    assert.ok(t.years <= HARD_LIMIT.years && t.km <= HARD_LIMIT.km);
  }
  assert.equal(errorFactor(0), 1);
  assert.equal(errorFactor(1000), 0.004);
});

test('first jump 2032 → 2002 succeeds reliably on Mk0 (audit B1–B3)', () => {
  let ok = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const { state, world } = setup();
    advanceTime(state, 0.5); // some play time before jumping (the B1 drift)
    const plan = planJump(state, { targetDate: START_DATE - 30, targetX: 0, targetZ: 6 }, world, seededRandom(seed));
    if (!plan.ok) { assert.fail(`seed ${seed}: ${plan.code} ${plan.message}`); }
    ok++;
    assert.ok(Math.abs(plan.arrival.date - state.clock.historicalDate) <= 30 + 1e-9, 'arrival within range');
    assert.ok(Math.abs(plan.arrival.date - (START_DATE - 30)) <= 2 + 1e-6, 'time error ≤ ±2 years');
    assert.ok(geodesicKm(state.player, plan.arrival) <= 200);
    assert.ok(world.isSafeLanding(plan.arrival.x, plan.arrival.z, plan.arrival.date));
    assert.ok(Math.abs(plan.cost - 1) < 1e-3, '30-year jump uses the full charge');
  }
  assert.equal(ok, 200);
});

test('energy: a 10-year Mk0 jump costs one third; insufficient charge is rejected without cost', () => {
  const { state, world } = setup();
  const plan = planJump(state, { targetDate: START_DATE - 10, targetX: 0, targetZ: 6 }, world, seededRandom(4));
  assert.ok(plan.ok);
  assert.ok(Math.abs(plan.cost - 1 / 3) < 1e-9);
  applyJump(state, plan);
  assert.ok(Math.abs(state.chronoDevice.charge - 2 / 3) < 1e-9);
  assert.equal(state.chronoDevice.successfulJumps, 1);
  const far = planJump(state, { targetDate: state.clock.historicalDate - 25, targetX: 0, targetZ: 6 }, world, seededRandom(5));
  assert.equal(far.code, 'NO_ENERGY');
  assert.ok(Math.abs(state.chronoDevice.charge - 2 / 3) < 1e-9);
});

test('range limits: time and geodesic space', () => {
  const { state, world } = setup();
  assert.equal(planJump(state, { targetDate: START_DATE - 40, targetX: 0, targetZ: 0 }, world).code, 'OUT_OF_TIME_RANGE');
  assert.equal(planJump(state, { targetDate: START_DATE - 5, targetX: 250000, targetZ: 0 }, world).code, 'OUT_OF_SPACE_RANGE');
  state.chronoDevice.tier = 3;
  assert.equal(planJump(state, { targetDate: START_DATE - 51.5, targetX: 0, targetZ: 0 }, world).code, 'OUT_OF_TIME_RANGE');
  assert.equal(planJump(state, { targetDate: START_DATE - 5, targetX: 0, targetZ: -510000 }, world).code, 'OUT_OF_SPACE_RANGE');
  const snap = planJump(state, { targetDate: START_DATE - 50.5, targetX: 0, targetZ: 6 }, world, seededRandom(1));
  assert.ok(snap.ok && snap.snapped && Math.abs(snap.target.date - (START_DATE - 50)) < 1e-9);
});

test('landing never in water, walls or trees; aborts when nothing safe within 150 m', () => {
  const { state, world } = setup();
  const p = findLanding({ x: 65, z: -42 }, 1500, world); // inside the church
  assert.ok(p && world.isSafeLanding(p.x, p.z, 1500) && p.shift > 0);
  const river = findLanding({ x: -420, z: 300 }, 1500, world);
  assert.ok(river && !world.isWater(river.x, river.z, 1500));
  const none = findLanding({ x: 0, z: 0 }, 1500, { isSafeLanding: () => false });
  assert.equal(none, null);
  const before = state.chronoDevice.charge;
  const plan = planJump(state, { targetDate: START_DATE - 5, targetX: 0, targetZ: 6 }, { ...world, isSafeLanding: () => false }, seededRandom(2));
  assert.equal(plan.code, 'NO_SAFE_LANDING');
  assert.equal(state.chronoDevice.charge, before);
});

test('anchors: bound to timeline and placement date, cut spatial error by 95 %', () => {
  const { state, world } = setup();
  state.clock.historicalDate = 1435.3;
  state.player.x = 65; state.player.z = -28.5; // just outside the church door
  assert.equal(touchableObject(state, world).id, 'church-st-mary');
  const { anchor, created } = placeAnchor(state, world);
  assert.ok(created);
  assert.equal(state.events.at(-1).type, 'ANCHOR_CREATED');
  assert.ok(anchorStatus(anchor, state, world).usable);
  assert.equal(anchorStatus(anchor, state, world, 1400).usable, false, 'not before placement');
  state.timelineId = 'other'; state.timelines.push({ id: 'other' });
  assert.equal(anchorStatus(anchor, state, world).usable, false, 'other timeline');
  state.timelineId = 'main';
  state.player.x = 2000; state.player.z = 0; state.clock.historicalDate = 1460;
  const plan = planJump(state, { targetDate: 1440, targetX: 0, targetZ: 0, anchorId: anchor.id }, world, seededRandom(9));
  assert.ok(plan.ok, plan.message);
  assert.ok(plan.arrival.date >= anchor.placedAt);
  assert.ok(plan.spatialErrorM <= 20000 * 0.05);
  const early = planJump(state, { targetDate: 1434, targetX: 0, targetZ: 0, anchorId: anchor.id }, world);
  assert.equal(early.code, 'ANCHOR_INVALID');
  assert.throws(() => { state.player.x = 500; placeAnchor(state, world); }, /Érints meg/);
});

test('ETR: returns to 2032 without healing and locks the device for 48 h', () => {
  const { state, world } = setup();
  state.clock.historicalDate = 2005.2;
  state.survival.thirst = 100; state.survival.health = 0;
  const r = handleFatalState(state, 'kiszáradás', () => 0.99);
  assert.ok(r.recalled);
  assert.ok(state.clock.historicalDate >= START_DATE);
  assert.equal(state.survival.health, 5);
  assert.equal(state.survival.thirst, 100, 'no automatic healing');
  assert.equal(state.chronoDevice.lockedUntilHours, ETR_LOCK_HOURS);
  assert.equal(planJump(state, { targetDate: 2010, targetX: 0, targetZ: 6 }, world).code, 'LOCKED');
  const r2 = handleFatalState(state, 'kiszáradás', () => 0.99);
  assert.ok(!r2.recalled && state.survival.dead, 'second fatal event while locked is death');
});

test('ETR can malfunction', () => {
  const { state } = setup();
  const r = handleFatalState(state, 'sérülés', () => 0.01);
  assert.ok(!r.recalled && state.survival.dead);
});
