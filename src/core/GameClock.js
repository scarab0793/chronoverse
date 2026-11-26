// The shared game clock (design doc §20, §27.5). One place advances time and
// keeps these quantities consistent:
//   - real time            -> realPlaySeconds
//   - experienced time     -> experiencedHours (drives ageing, charge, needs)
//   - historical date      -> historicalDate (moves with experienced time,
//                             jumps only through ChronoNavigation)
//   - biological age       -> derived from experiencedHours (GameState)
//   - device recharge      -> 24 experienced hours for a full charge

import { HOURS_PER_YEAR } from './time.js';
import { tickSurvival } from '../survival/Survival.js';
import { recordEvent } from './EventBus.js';

/** Game hours per real second while playing. Calibratable (1 s = 1 game minute). */
export const TIME_SCALE = 60;
export const FULL_RECHARGE_HOURS = 24;

/**
 * Advances experienced time by `hours`. Returns { died, cause }.
 * Survival is stepped hour by hour so long waits behave like short ones.
 */
export function advanceTime(state, hours, { sleeping = false } = {}) {
  if (!(hours > 0) || state.survival.dead) return { died: false };
  const result = tickSurvival(state.survival, hours, { sleeping });
  state.clock.experiencedHours += hours;
  state.clock.historicalDate += hours / HOURS_PER_YEAR;
  const d = state.chronoDevice;
  if (state.clock.experiencedHours >= d.lockedUntilHours) d.charge = Math.min(1, d.charge + hours / FULL_RECHARGE_HOURS);
  return result;
}

/** Advances by real seconds of play using TIME_SCALE. */
export function advanceReal(state, seconds, opts) {
  state.clock.realPlaySeconds += seconds;
  return advanceTime(state, (seconds * TIME_SCALE) / 3600, opts);
}

/** A deliberate wait/sleep action of whole hours, logged as one event. */
export function passHours(state, hours, { sleeping = false } = {}) {
  const r = advanceTime(state, hours, { sleeping });
  recordEvent(state, 'TIME_ADVANCED', { hours, sleeping });
  return r;
}
