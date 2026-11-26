// ChronoWorld model for the 3D game: terrain, water, roads, buildings with
// unique ids and historical validity intervals, and deterministic vegetation.
//
// Data layers (design doc §17.1):
//  - "reconstructed": plausible village history of the synthetic test area,
//    every building linked to a record in data/building_archetypes.json;
//  - "simulated": buildings constructed/destroyed by the player (events).
// Nothing here is a surveyed historical reconstruction yet; the layer flag
// makes that explicit so real data can replace it later.

import { hash01 } from '../core/random.js';

export const FOREVER = 1e6;
export const ROAD_HALF_WIDTH = 3.5;
export const ROAD_FROM = 1100; // first dirt road through the village
export const ROAD_PAVED_FROM = 1920;
export const RIVER_HALF_WIDTH = 12;
export const BRIDGE_FROM = 1300;
const TREE_CELL = 30;

// ---------------------------------------------------------------- terrain
export function riverCenterX(z) { return -420 + 160 * Math.sin(z / 600); }

function baseHeight(x, z) {
  return 3 * Math.sin(x / 65) * Math.sin(z / 85) + 6 * Math.sin(x / 1300) * Math.cos(z / 1700);
}

export function terrainHeight(x, z) {
  const d = Math.abs(x - riverCenterX(z));
  const carve = d < 26 ? 3 * (1 - d / 26) : 0;
  return baseHeight(x, z) - carve;
}

export function waterLevel(z) { return baseHeight(riverCenterX(z), z) - 1.2; }

// -------------------------------------------------------------- buildings
function def(id, archetype, style, name, x, z, w, d, h, from, to, extra = {}) {
  return Object.freeze({ id, archetype, style, name, x, z, w, d, h, from, to, layer: 'reconstructed', ...extra });
}

/** Static reconstructed history of the 4 × 4 km test village. */
export const STATIC_BUILDINGS = (() => {
  const b = [
    // Early Mesolithic seasonal hunting camp
    def('camp-shelter-1', '-8999-shelter', 'shelter', 'Vadásztábor – menedék', 30, -25, 4, 4, 2.2, -9400, -8600),
    def('camp-shelter-2', '-8999-shelter', 'shelter', 'Vadásztábor – menedék', 41, -31, 4, 4, 2.2, -9300, -8650),
    def('camp-shelter-3', '-8999-shelter', 'shelter', 'Vadásztábor – menedék', 23, -35, 4, 4, 2.2, -9200, -8700),
    def('camp-windbreak', '-8999-windbreak', 'windbreak', 'Szélfogó', 48, -21, 6, 1, 1.6, -9350, -8600),
    def('camp-hearth', '-8999-hearth', 'hearth', 'Szabadtéri tűzhely', 34, -19, 1.6, 1.6, 0.4, -9400, -8600),
    // Medieval core
    def('church-st-mary', '1435-church', 'church', 'Szent Mária-templom', 65, -42, 14, 24, 9, 1120, FOREVER, { anchorable: true }),
    def('church-st-mary-tower', '1435-church', 'tower', 'Templomtorony', 65, -56.5, 5, 5, 17, 1350, FOREVER, { anchorable: true }),
    def('manor', '1435-manor', 'manor', 'Udvarház', -40, -45, 18, 12, 7, 1290, 1795),
    def('villa', '1885-villa', 'villa', 'Villa', -40, -45, 16, 12, 9, 1812, FOREVER),
    def('inn', '1435-inn', 'inn', 'Fogadó', -30, 22, 12, 9, 6, 1380, 1888),
    def('pub', '1885-pub', 'pub', 'Kocsma', -30, 22, 12, 9, 7, 1891, 1999),
    def('community', '2032-community', 'modern', 'Közösségi központ (ivókút)', -30, 22, 16, 11, 6, 2004, FOREVER, { water: true }),
    def('well', '1435-well', 'well', 'Falusi kút', 8, 8, 2, 2, 1, 1150, 1905, { water: true }),
    def('smithy', '1435-smithy', 'smithy', 'Kovácsműhely', -15, -22, 9, 7, 4.5, 1300, 1868),
    def('workshop-1885', '1885-workshop', 'terrace', 'Kézműves műhely', -15, -22, 9, 7, 5, 1874, 1985),
    def('workshop-2032', '2032-workshop', 'modern', 'Javítóműhely', -15, -22, 10, 8, 5, 1990, FOREVER),
    def('windmill', '1435-windmill', 'windmill', 'Bakos szélmalom', 150, -60, 5, 5, 10, 1400, 1880),
    def('watermill', '1435-watermill', 'watermill', 'Vízimalom', -398, -40, 8, 8, 6, 1250, 1890),
    // Industrial era and modern village
    def('factory', '1885-factory', 'factory', 'Gyárépület', 100, 35, 22, 15, 8, 1852, 1978),
    def('logistics', '2032-logistics', 'logistics', 'Logisztikai csarnok', 100, 40, 30, 20, 9, 1992, FOREVER),
    def('pumphouse', '1885-pumphouse', 'pump', 'Szivattyúház (közkút)', 60, 14, 5, 5, 4, 1868, 1960, { water: true }),
    def('school-1885', '1885-school', 'terrace', 'Iskola', -70, -20, 16, 10, 7, 1878, 1972),
    def('school-2032', '2032-school', 'modern', 'Modern iskola', -70, -20, 18, 12, 7, 1975, FOREVER),
    def('supermarket', '2032-supermarket', 'logistics', 'Szupermarket', -62, 34, 24, 18, 6, 1985, FOREVER),
    def('bridge', null, 'bridge', 'Közúti híd', -420, 0, 32, 7, 0.6, BRIDGE_FROM, FOREVER, { walkable: true }),
  ];
  // Twelve house plots along the road, each rebuilt over the centuries.
  for (let p = 0; p < 12; p++) {
    const x = 18 + (p % 6) * 18, z = p < 6 ? -18 : 18;
    const r = k => hash01('plot', p, k);
    const aFrom = Math.round(1180 + r('a') * 140), aTo = Math.round(1660 + r('b') * 150);
    const bFrom = aTo + Math.round(5 + r('c') * 25), bTo = Math.round(1925 + r('d') * 60);
    const cFrom = bTo + Math.round(2 + r('e') * 8);
    b.push(def(`plot-${p}-cottage`, '1435-cottage', 'cottage', 'Parasztház', x, z, 10, 7, 5, aFrom, aTo, { residential: true }));
    b.push(def(`plot-${p}-terrace`, p % 3 === 0 ? '1885-farmhouse' : '1885-terrace', 'terrace', p % 3 === 0 ? 'Farmház' : 'Sorház', x, z, 10, 8, 6, bFrom, bTo, { residential: true }));
    b.push(def(`plot-${p}-house`, '2032-house', 'modern', 'Családi ház', x, z, 10, 8, 6, cFrom, FOREVER, { residential: true }));
  }
  return Object.freeze(b);
})();

const exists = (b, date) => b.from <= date && date < b.to;

/**
 * Creates a world view over the static layer plus the player's building
 * events. `getEvents()` returns the event list of the active timeline.
 */
export function createWorld({ getEvents = () => [], getTimelineId = () => 'main' } = {}) {
  function playerBuildings() {
    const tl = getTimelineId();
    const map = new Map();
    for (const e of getEvents()) {
      if (e.timelineId !== tl) continue;
      if (e.type === 'BUILDING_CONSTRUCTED') map.set(e.data.building.id, { ...e.data.building, from: e.historicalDate, to: FOREVER, layer: 'simulated' });
      if (e.type === 'BUILDING_DESTROYED') {
        const b = map.get(e.data.id) || STATIC_BUILDINGS.find(s => s.id === e.data.id);
        if (b) map.set(b.id, { ...b, to: Math.min(b.to, e.historicalDate), destroyedBy: e.id });
      }
    }
    return map;
  }

  function allBuildings() {
    const overrides = playerBuildings();
    const list = STATIC_BUILDINGS.map(b => overrides.get(b.id) || b);
    for (const [id, b] of overrides) if (!STATIC_BUILDINGS.some(s => s.id === id)) list.push(b);
    return list;
  }

  function buildingsAt(date) { return allBuildings().filter(b => exists(b, date)); }
  function getObject(id) { return allBuildings().find(b => b.id === id) || null; }
  function objectExists(id, date) { const b = getObject(id); return !!b && exists(b, date); }

  function roadAt(x, z, date) { return date >= ROAD_FROM && Math.abs(z) < ROAD_HALF_WIDTH && Math.abs(x) < 4000; }

  function isWater(x, z, date) {
    if (Math.abs(x - riverCenterX(z)) >= RIVER_HALF_WIDTH) return false;
    const bridge = buildingsAt(date).find(b => b.style === 'bridge');
    return !(bridge && Math.abs(x - bridge.x) < bridge.w / 2 && Math.abs(z - bridge.z) < bridge.d / 2);
  }

  function inFootprint(b, x, z, pad) { return Math.abs(x - b.x) < b.w / 2 + pad && Math.abs(z - b.z) < b.d / 2 + pad; }

  /** Deterministic tree in a 30 m cell, or null. Trees are felled over time. */
  function treeInCell(cx, cz, date, built) {
    const h = hash01('tree', cx, cz);
    if (h > 0.6) return null;
    const fell = h < 0.16 ? FOREVER : 900 + hash01('fell', cx, cz) * 1100;
    if (date >= fell) return null;
    const x = cx * TREE_CELL + 4 + hash01('tx', cx, cz) * (TREE_CELL - 8);
    const z = cz * TREE_CELL + 4 + hash01('tz', cx, cz) * (TREE_CELL - 8);
    if (Math.abs(x - riverCenterX(z)) < RIVER_HALF_WIDTH + 3) return null;
    if (date >= ROAD_FROM && (Math.abs(z) < 12 || Math.hypot(x - 20, z) < 160)) return null;
    if (built.some(b => inFootprint(b, x, z, 4))) return null;
    return { x, z, scale: 0.75 + hash01('ts', cx, cz) * 0.6, kind: hash01('tk', cx, cz) < 0.35 ? 'broadleaf' : 'conifer' };
  }

  function treesNear(x, z, radius, date) {
    const built = buildingsAt(date);
    const out = [];
    const c0x = Math.floor((x - radius) / TREE_CELL), c1x = Math.floor((x + radius) / TREE_CELL);
    const c0z = Math.floor((z - radius) / TREE_CELL), c1z = Math.floor((z + radius) / TREE_CELL);
    for (let cx = c0x; cx <= c1x; cx++) for (let cz = c0z; cz <= c1z; cz++) {
      const t = treeInCell(cx, cz, date, built);
      if (t) out.push(t);
    }
    return out;
  }

  function isBlocked(x, z, date, pad = 0.4) {
    for (const b of buildingsAt(date)) if (!b.walkable && inFootprint(b, x, z, pad)) return true;
    for (const t of treesNear(x, z, 2, date)) if (Math.hypot(t.x - x, t.z - z) < 0.6 + pad) return true;
    return false;
  }

  /** Safe materialisation point (§5.7): not in water, walls, trees or objects. */
  function isSafeLanding(x, z, date) {
    if (![x, z].every(Number.isFinite)) return false;
    return !isWater(x, z, date) && !isBlocked(x, z, date, 1.0);
  }

  /** Nearest drinkable source within reach: a well/fountain or the river bank. */
  function waterSourceNear(x, z, date, reach = 3) {
    const b = buildingsAt(date).find(b => b.water && inFootprint(b, x, z, reach));
    if (b) return { kind: 'building', id: b.id, name: b.name, safe: date >= 1900 };
    if (Math.abs(x - riverCenterX(z)) < RIVER_HALF_WIDTH + reach) return { kind: 'river', id: 'river', name: 'Folyó', safe: false };
    return null;
  }

  return { buildingsAt, allBuildings, getObject, objectExists, roadAt, isWater, isBlocked, isSafeLanding, treesNear, waterSourceNear, terrainHeight };
}
