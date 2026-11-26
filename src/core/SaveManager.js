// Unified save system (design doc §21): one JSON document per slot containing
// the whole GameState. Replaces the ten separate legacy localStorage keys.

import { migrateGameState, validateGameState, migrateLegacy } from './GameState.js';

export const SAVE_PREFIX = 'chronoverse.game.v1.';
export const AUTOSAVE = 'autosave';
export const MANUAL_SLOTS = ['slot1', 'slot2', 'slot3'];

export function createSaveManager(storage) {
  const key = slot => {
    if (slot !== AUTOSAVE && !MANUAL_SLOTS.includes(slot)) throw new Error('Unknown save slot: ' + slot);
    return SAVE_PREFIX + slot;
  };

  function save(state, slot = AUTOSAVE, label = '') {
    const errors = validateGameState(state);
    if (errors.length) throw new Error('Refusing to save invalid state: ' + errors.join('; '));
    const doc = { format: 'chronoverse-save', savedAt: new Date().toISOString(), label, summary: summarize(state), state };
    storage.setItem(key(slot), JSON.stringify(doc));
    return doc;
  }

  function load(slot = AUTOSAVE) {
    const raw = storage.getItem(key(slot));
    if (raw === null) return null;
    const doc = JSON.parse(raw);
    if (doc.format !== 'chronoverse-save') throw new Error('Not a CHRONOVERSE save');
    const state = migrateGameState(doc.state);
    const errors = validateGameState(state);
    if (errors.length) throw new Error('Corrupt save: ' + errors.join('; '));
    return state;
  }

  function info(slot) {
    try {
      const raw = storage.getItem(key(slot));
      if (raw === null) return null;
      const d = JSON.parse(raw);
      return { slot, savedAt: d.savedAt, label: d.label, summary: d.summary };
    } catch (e) { return { slot, error: e.message }; }
  }

  function list() { return [AUTOSAVE, ...MANUAL_SLOTS].map(info).filter(Boolean); }
  function remove(slot) { storage.removeItem(key(slot)); }

  /** Loads the autosave, or converts legacy keys once if no unified save exists. */
  function loadOrMigrate() {
    const s = load(AUTOSAVE);
    if (s) return { state: s, migrated: false };
    const legacy = migrateLegacy(storage);
    if (legacy) { save(legacy, AUTOSAVE, 'migrated'); return { state: legacy, migrated: true }; }
    return { state: null, migrated: false };
  }

  return { save, load, info, list, remove, loadOrMigrate };
}

export function summarize(s) {
  return { name: s.character.name, historicalDate: s.clock.historicalDate, experiencedHours: s.clock.experiencedHours, dead: s.survival.dead };
}
