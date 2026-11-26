// Emergency Temporal Recall (design doc §7). Not a normal jump: when the
// player would die, the device may pull them back to 2032. It does not heal,
// locks the device for 48 experienced hours, and can fail.
// The failure probability and energy rules are placeholders until finalised.

import { recordEvent } from '../core/EventBus.js';
import { START_DATE, SPAWN_POINT } from '../core/GameState.js';
import { HOURS_PER_YEAR } from '../core/time.js';

export const ETR_LOCK_HOURS = 48;
export const ETR_FAILURE_PROBABILITY = 0.1;

export function etrAvailable(state) {
  return state.clock.experiencedHours >= state.chronoDevice.lockedUntilHours;
}

/** Called when the survival model reports death. Returns { recalled, message }. */
export function handleFatalState(state, cause, rng = Math.random) {
  if (etrAvailable(state) && rng() >= ETR_FAILURE_PROBABILITY) {
    const from = { date: state.clock.historicalDate, x: state.player.x, z: state.player.z };
    // "Home" 2032 moves on with the player's own lived time.
    const returnDate = START_DATE + state.clock.experiencedHours / HOURS_PER_YEAR;
    state.clock.historicalDate = returnDate;
    state.player.x = SPAWN_POINT.x;
    state.player.z = SPAWN_POINT.z;
    state.survival.health = 5;
    state.chronoDevice.charge = 0;
    state.chronoDevice.lockedUntilHours = state.clock.experiencedHours + ETR_LOCK_HOURS;
    recordEvent(state, 'EMERGENCY_RECALL', { cause, from, to: { date: returnDate, ...SPAWN_POINT } });
    return { recalled: true, message: `ETR aktiválva (${cause}): visszatérés 2032-be. Az időgép 48 órára zárolva, orvosi ellátás szükséges.` };
  }
  state.survival.dead = true;
  state.survival.health = 0;
  state.survival.causeOfDeath = cause;
  recordEvent(state, 'CHARACTER_DEATH', { cause, etrFailed: etrAvailable(state) });
  return { recalled: false, message: `A karakter meghalt (${cause}).` + (etrAvailable(state) ? ' Az ETR meghibásodott.' : ' Az ETR zárolva volt.') };
}
