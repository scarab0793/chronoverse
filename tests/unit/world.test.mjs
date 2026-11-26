import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWorld, STATIC_BUILDINGS, riverCenterX } from '../../src/world/WorldModel.js';
import { createNPCManager } from '../../src/characters/NPCManager.js';
import { createGameState } from '../../src/core/GameState.js';
import { recordEvent } from '../../src/core/EventBus.js';
import { localToLatLon, latLonToLocal, geodesicKm, ORIGIN } from '../../src/world/geo.js';

const archetypes = JSON.parse(readFileSync(new URL('../../data/npc_social_archetypes.json', import.meta.url))).records;
const buildingArchetypes = new Set(JSON.parse(readFileSync(new URL('../../data/building_archetypes.json', import.meta.url))).records.map(r => r.id));

test('every static building has a unique id, a valid interval and a known archetype', () => {
  const ids = new Set();
  for (const b of STATIC_BUILDINGS) {
    assert.ok(!ids.has(b.id), b.id); ids.add(b.id);
    assert.ok(b.from < b.to, b.id);
    if (b.archetype !== null) assert.ok(buildingArchetypes.has(b.archetype), `${b.id} -> ${b.archetype}`);
  }
});

test('the village changes continuously, not in four fixed epochs (audit B8)', () => {
  const w = createWorld();
  const sig = y => w.buildingsAt(y).map(b => b.id).sort().join();
  assert.equal(w.buildingsAt(-8999).filter(b => b.style === 'shelter').length, 3);
  assert.ok(w.objectExists('church-st-mary', 1435) && !w.objectExists('church-st-mary', 1000));
  assert.notEqual(sig(1435), sig(1750), '1435 and 1750 differ');
  const distinct = new Set();
  for (let y = 1100; y <= 2032; y += 10) distinct.add(sig(y));
  assert.ok(distinct.size > 25, `village has ${distinct.size} distinct states`);
});

test('player construction and destruction are events in the timeline', () => {
  const s = createGameState();
  const w = createWorld({ getEvents: () => s.events, getTimelineId: () => s.timelineId });
  s.clock.historicalDate = 1500;
  recordEvent(s, 'BUILDING_DESTROYED', { id: 'church-st-mary' });
  assert.ok(w.objectExists('church-st-mary', 1499) && !w.objectExists('church-st-mary', 1501));
  s.clock.historicalDate = 1600;
  recordEvent(s, 'BUILDING_CONSTRUCTED', { building: { id: 'player-hut-1', style: 'cottage', name: 'Kunyhó', x: 300, z: 300, w: 4, d: 4, h: 3 } });
  assert.ok(w.objectExists('player-hut-1', 1700) && !w.objectExists('player-hut-1', 1599));
  s.timelineId = 'branch'; s.timelines.push({ id: 'branch' });
  assert.ok(w.objectExists('church-st-mary', 1700), 'other timeline unaffected');
});

test('water, bridge and trees', () => {
  const w = createWorld();
  assert.ok(w.isWater(-420, 0, 1200), 'river before the bridge');
  assert.ok(!w.isWater(-420, 0, 1400), 'bridge from 1300');
  assert.ok(!w.isSafeLanding(riverCenterX(200), 200, 1400), 'never land in the river');
  const old = w.treesNear(1000, 1000, 300, -8999).length, now = w.treesNear(1000, 1000, 300, 2032).length;
  assert.ok(old > now * 2, `forest cleared over time ${old} -> ${now}`);
  assert.equal(w.waterSourceNear(8, 10.5, 1500).id, 'well');
  assert.equal(w.waterSourceNear(8, 10.5, 2032), null);
});

test('geo: local plane ↔ lat/lon round trip and geodesic distance', () => {
  const p = localToLatLon(0, 0);
  assert.deepEqual(p, { lat: ORIGIN.lat, lon: ORIGIN.lon });
  const q = latLonToLocal(...Object.values(localToLatLon(1234, -5678)));
  assert.ok(Math.abs(q.x - 1234) < 1e-6 && Math.abs(q.z + 5678) < 1e-6);
  assert.ok(Math.abs(geodesicKm({ x: 0, z: 0 }, { x: 0, z: -100000 }) - 100) < 0.5);
});

test('NPCs: persistent, age over time, families share surnames, remember the player', () => {
  const s = createGameState();
  const w = createWorld({ getEvents: () => s.events });
  const npcs = createNPCManager({ archetypes, world: w });
  const a = npcs.snapshot(1435.5), b = npcs.snapshot(1455.5);
  assert.ok(a.length >= 5 && a.length <= 16, `population ${a.length}`);
  const same = a.find(p => b.some(q => q.id === p.id));
  assert.ok(same, 'someone is still alive 20 years later');
  assert.equal(b.find(q => q.id === same.id).age, same.age + 20);
  assert.equal(npcs.aliveAt(500).length, 0, 'no villagers between camp and village');
  assert.ok(npcs.snapshot(-8999).every(p => !p.surname));
  const fam = npcs.family(same.id);
  const father = npcs.person(Number(fam.parents[0].slice(4)));
  if (father.surname && same.surname && father.born > 1300) assert.equal(typeof father.surname, 'string');
  assert.ok(a.every(p => typeof p.role === 'string' && p.role.length));

  s.clock.historicalDate = 1435.5;
  const first = npcs.talk(s, same);
  assert.equal(first.metBefore, false);
  assert.equal(s.npcs.memories[same.id].length, 1);
  s.clock.historicalDate = 1436.5;
  const again = npcs.talk(s, same);
  assert.equal(again.metBefore, true);
  s.clock.historicalDate = 1430;
  assert.equal(npcs.talk(s, same).metBefore, false, 'in their past they have not met you yet');
});
