// The single source of truth for a running game (design doc §29). Every
// subsystem reads and writes this object; nothing keeps its own copy.

import { dateToYear, HOURS_PER_YEAR } from './time.js';
import { randomId } from './random.js';
import { recordEvent } from './EventBus.js';

export const SCHEMA_VERSION = 1;
export const START_DATE = dateToYear(2032, 5, 30, 12); // 30 May 2032, 12:00
export const SPAWN_POINT = Object.freeze({ x: 0, z: 6 });

export const DEFAULT_CHARACTER = Object.freeze({
  name: 'Utazó',
  sex: 'unspecified',
  ageYears: 30,
  heightCm: 175,
  weightKg: 72,
  appearance: '',
  background: 'kutató',
  attributes: { strength: 5, endurance: 5, intelligence: 6 },
  languages: { hu: 1, en: 0.9 },
  skills: { navigation: 0.2, medicine: 0.1, crafting: 0.1, trade: 0.1 },
});

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function createGameState(character = {}, { now = new Date().toISOString(), worldId = randomId('world') } = {}) {
  const c = { ...DEFAULT_CHARACTER, ...character };
  c.name = String(c.name || DEFAULT_CHARACTER.name).trim().slice(0, 40) || DEFAULT_CHARACTER.name;
  c.ageYears = clamp(Number(c.ageYears) || 30, 18, 80);
  c.heightCm = clamp(Number(c.heightCm) || 175, 140, 215);
  c.weightKg = clamp(Number(c.weightKg) || 72, 40, 160);
  const state = {
    schemaVersion: SCHEMA_VERSION,
    worldId,
    timelineId: 'main',
    timelines: [{ id: 'main', parentId: null, forkDate: null, createdAt: now }],
    createdAt: now,
    character: { id: randomId('char'), ...c },
    clock: { historicalDate: START_DATE, experiencedHours: 0, realPlaySeconds: 0 },
    player: { x: SPAWN_POINT.x, z: SPAWN_POINT.z, yaw: 0, pitch: 0 },
    survival: { hunger: 10, thirst: 10, fatigue: 10, health: 100, injury: 0, illness: 0, dead: false, causeOfDeath: null },
    inventory: { ration: 3, water: 3 },
    finances: { GBP_DECIMAL_PENCE: 25000 },
    properties: [],
    chronoDevice: { model: 'Mk0', tier: 0, charge: 1, successfulJumps: 0, lockedUntilHours: 0, lastJump: null },
    anchors: [],
    npcs: { memories: {} },
    events: [],
    eventSeq: 0,
  };
  recordEvent(state, 'PLAYER_CREATED', { characterId: state.character.id, name: c.name });
  return state;
}

export function biologicalAge(state) {
  return state.character.ageYears + state.clock.experiencedHours / HOURS_PER_YEAR;
}

const finite = v => typeof v === 'number' && Number.isFinite(v);

/** Returns a list of problems; empty means the state is structurally valid. */
export function validateGameState(s) {
  const errors = [];
  const req = (cond, msg) => { if (!cond) errors.push(msg); };
  if (!s || typeof s !== 'object') return ['state is not an object'];
  req(s.schemaVersion === SCHEMA_VERSION, 'unsupported schemaVersion ' + s.schemaVersion);
  req(typeof s.worldId === 'string' && s.worldId, 'worldId');
  req(typeof s.timelineId === 'string' && Array.isArray(s.timelines) && s.timelines.some(t => t.id === s.timelineId), 'timelineId must reference a timeline');
  req(s.character && typeof s.character.name === 'string' && finite(s.character.ageYears), 'character');
  req(s.clock && finite(s.clock.historicalDate) && finite(s.clock.experiencedHours) && s.clock.experiencedHours >= 0, 'clock');
  req(s.player && finite(s.player.x) && finite(s.player.z) && finite(s.player.yaw) && finite(s.player.pitch), 'player position');
  const sv = s.survival;
  req(sv && ['hunger', 'thirst', 'fatigue', 'health', 'injury', 'illness'].every(k => finite(sv[k]) && sv[k] >= 0 && sv[k] <= 100), 'survival values 0..100');
  const d = s.chronoDevice;
  req(d && Number.isInteger(d.tier) && d.tier >= 0 && d.tier <= 3 && finite(d.charge) && d.charge >= 0 && d.charge <= 1 && Number.isInteger(d.successfulJumps) && d.successfulJumps >= 0 && finite(d.lockedUntilHours), 'chronoDevice');
  req(s.inventory && typeof s.inventory === 'object' && Object.values(s.inventory).every(n => Number.isInteger(n) && n >= 0), 'inventory');
  req(Array.isArray(s.anchors) && s.anchors.every(a => a && typeof a.id === 'string' && typeof a.objectId === 'string' && typeof a.timelineId === 'string' && finite(a.placedAt)), 'anchors');
  req(s.npcs && typeof s.npcs.memories === 'object', 'npcs');
  req(Array.isArray(s.events) && Number.isInteger(s.eventSeq), 'events');
  return errors;
}

/** Brings older saves up to the current schema (only v1 exists so far). */
export function migrateGameState(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid save');
  if (raw.schemaVersion > SCHEMA_VERSION) throw new Error('Save is from a newer game version');
  return raw;
}

/**
 * Builds a unified state from the pre-ChronoWorldSync localStorage keys
 * (render.html navigation + anchors, ChronoSurvival). Returns null if none.
 */
export function migrateLegacy(storage) {
  const read = k => { try { return JSON.parse(storage.getItem(k) || 'null'); } catch { return null; } };
  const nav = read('chronoverse.render.navigation.v1');
  const anchors = read('chronoverse.render.anchors.v1');
  const surv = read('chronoverse.survival.v1');
  if (!nav && !anchors && !surv) return null;
  const s = createGameState({ name: 'Utazó (régi mentés)' });
  if (nav && finite(nav.year)) {
    s.clock.historicalDate = nav.year;
    if (finite(nav.charge)) s.chronoDevice.charge = clamp(nav.charge, 0, 1);
    if (Number.isInteger(nav.jumps) && nav.jumps >= 0) s.chronoDevice.successfulJumps = nav.jumps;
    if (Number.isInteger(nav.tier) && nav.tier >= 0 && nav.tier <= 3) s.chronoDevice.tier = nav.tier;
    if (finite(nav.x) && finite(nav.z)) { s.player.x = nav.x; s.player.z = nav.z; }
  }
  if (Array.isArray(anchors)) for (const a of anchors) {
    if (a && a.id === 'church' && finite(a.year)) s.anchors.push({ id: randomId('anchor'), objectId: 'church-st-mary', name: 'Szent Mária-templom', timelineId: 'main', placedAt: a.year, placedExperiencedHours: 0, destroyed: false });
  }
  const p = surv && surv.players && surv.players['local-main'];
  if (p) {
    for (const k of ['hunger', 'thirst', 'fatigue', 'health', 'injury', 'illness']) if (finite(p[k])) s.survival[k] = clamp(p[k], 0, 100);
    if (finite(p.hours)) s.clock.experiencedHours = Math.max(0, p.hours);
    s.survival.dead = !!p.dead;
  }
  s.migratedFrom = 'legacy-localStorage';
  return s;
}
