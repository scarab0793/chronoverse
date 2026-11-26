// ChronoSurvival for the unified game: needs advance with experienced time on
// the shared game clock (design doc §10). Hourly rates are inherited from the
// earlier js/chrono-survival.js prototype and remain calibration values.

export const RATES = Object.freeze({
  hungerPerHour: 2,       // ~50 h from fed to starving
  thirstPerHour: 3,       // ~33 h from hydrated to critical
  fatiguePerHourAwake: 2,
  fatiguePerHourAsleep: -8,
  regenPerHour: 0.5,      // health recovery when needs are met
  suitIllnessRecoveryPerHour: 0.5, // ChronoSuit antibiotics / monitoring
});

export const ITEMS = Object.freeze({
  ration: { name: 'Tápláléktabletta (2032)', hunger: -35 },
  water: { name: 'Ivóvíz (palack)', thirst: -45 },
});

const clamp = v => Math.max(0, Math.min(100, v));

/**
 * Advances the survival block by `hours` (integer steps of up to 1 h).
 * Returns { died: boolean, cause }. Mutates `sv`.
 */
export function tickSurvival(sv, hours, { sleeping = false } = {}) {
  if (sv.dead || hours <= 0) return { died: false };
  let left = hours;
  while (left > 1e-9) {
    const h = Math.min(1, left);
    left -= h;
    sv.hunger = clamp(sv.hunger + RATES.hungerPerHour * h);
    sv.thirst = clamp(sv.thirst + RATES.thirstPerHour * h);
    sv.fatigue = clamp(sv.fatigue + (sleeping ? RATES.fatiguePerHourAsleep : RATES.fatiguePerHourAwake) * h);
    sv.illness = clamp(sv.illness - RATES.suitIllnessRecoveryPerHour * h);
    let damage = 0;
    if (sv.hunger >= 90) damage += 2;
    if (sv.thirst >= 90) damage += 4;
    if (sv.fatigue >= 95) damage += 1;
    damage += sv.injury / 25 + sv.illness / 25;
    const healthy = sv.hunger < 60 && sv.thirst < 60 && sv.fatigue < 80 && sv.injury === 0 && sv.illness < 10;
    sv.health = clamp(sv.health - damage * h + (healthy ? RATES.regenPerHour * h : 0));
    if (sv.health <= 0) {
      const cause = sv.thirst >= 90 ? 'kiszáradás' : sv.hunger >= 90 ? 'éhezés' : sv.illness > 0 ? 'betegség' : sv.injury > 0 ? 'sérülés' : 'kimerültség';
      return { died: true, cause };
    }
  }
  return { died: false };
}

/** Consumes an inventory item. Returns a message or throws. */
export function consume(state, item) {
  const def = ITEMS[item];
  if (!def) throw new Error('Ismeretlen tárgy');
  if (!(state.inventory[item] > 0)) throw new Error('Nincs több: ' + def.name);
  state.inventory[item]--;
  const sv = state.survival;
  if (def.hunger) sv.hunger = clamp(sv.hunger + def.hunger);
  if (def.thirst) sv.thirst = clamp(sv.thirst + def.thirst);
  return def.name + ' elfogyasztva';
}

/**
 * Drinking from a historical source. Pre-modern water carries an infection
 * risk (§10.1); the ChronoSuit detects it and slowly treats it.
 */
export function drinkFrom(state, source, rng = Math.random) {
  const sv = state.survival;
  sv.thirst = clamp(sv.thirst - 45);
  if (!source.safe && rng() < 0.25) {
    sv.illness = clamp(sv.illness + 20);
    return { sick: true, message: `Ittál: ${source.name}. A ChronoSuit fertőzést észlelt – antibiotikum-szintézis folyamatban.` };
  }
  return { sick: false, message: `Ittál: ${source.name}.` };
}
