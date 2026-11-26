// ChronoNavigation (design doc §5). Pure rules: callers pass the state, the
// world view and an RNG; nothing here touches the renderer or storage.
//
// Non-negotiable: no device, upgrade, anchor or error can exceed
// HARD_LIMIT (50 years / 500 km per jump).

import { geodesicKm } from '../world/geo.js';
import { recordEvent } from '../core/EventBus.js';
import { HOURS_PER_YEAR } from '../core/time.js';

export const HARD_LIMIT = Object.freeze({ years: 50, km: 500 });

export const TIERS = Object.freeze([
  Object.freeze({ id: 'Mk0', years: 30, km: 200, timeErrorYears: 2, spaceErrorKm: 20 }),
  Object.freeze({ id: 'Mk1', years: 35, km: 300, timeErrorYears: 1.5, spaceErrorKm: 10 }),
  Object.freeze({ id: 'Mk2', years: 42, km: 400, timeErrorYears: 0.8, spaceErrorKm: 3 }),
  Object.freeze({ id: 'Mk3', years: 50, km: 500, timeErrorYears: 0.2, spaceErrorKm: 0.25 }),
]);

export const ANCHOR_ERROR_MULTIPLIER = 0.05;   // anchors cut spatial error by 95 % (§6.2)
export const LANDING_SEARCH_RADIUS_M = 150;    // §5.7
export const LANDING_SEARCH_STEP_M = 10;
export const MIN_JUMP_YEARS = 1 / HOURS_PER_YEAR; // at least one hour
export const SNAP_TOLERANCE_YEARS = 1;          // targets this far past the range snap to it

/** Effective tier with the hard cap enforced, whatever the stored values. */
export function deviceTier(device) {
  const t = TIERS[device.tier] || TIERS[0];
  return { ...t, years: Math.min(t.years, HARD_LIMIT.years), km: Math.min(t.km, HARD_LIMIT.km) };
}

/** Experience formula from the prototype (calibration value, §5.6). */
export function errorFactor(successfulJumps) {
  return Math.max(0.004, 1 - successfulJumps / 25);
}

export function energyCost(years, tier) { return years / tier.years; }

/** Anchor validity (§6.1): own timeline, not before placement, object still there. */
export function anchorStatus(anchor, state, world, date = state.clock.historicalDate) {
  if (anchor.timelineId !== state.timelineId) return { usable: false, reason: 'Másik idővonalon rögzítve' };
  if (anchor.destroyed) return { usable: false, reason: 'A horgony megsemmisült' };
  if (date < anchor.placedAt) return { usable: false, reason: 'Az elhelyezés előtti időpont' };
  if (!world.objectExists(anchor.objectId, date)) return { usable: false, reason: 'Az objektum ebben az időpontban nem létezik' };
  return { usable: true, reason: 'Aktív' };
}

function reject(code, message) { return { ok: false, code, message }; }

/**
 * Plans a jump. `request` = { targetDate, targetX, targetZ, anchorId? }.
 * Returns { ok:false, code, message } or { ok:true, ... } without mutating state.
 */
export function planJump(state, request, world, rng = Math.random) {
  const d = state.chronoDevice;
  const now = state.clock.historicalDate;
  const here = { x: state.player.x, z: state.player.z };
  if (state.survival.dead) return reject('DEAD', 'A karakter halott.');
  if (state.clock.experiencedHours < d.lockedUntilHours) {
    return reject('LOCKED', `Az időgép az ETR után zárolva még ${Math.ceil(d.lockedUntilHours - state.clock.experiencedHours)} órán át.`);
  }
  const tier = deviceTier(d);
  let { targetDate, targetX, targetZ } = request;
  let anchor = null;
  if (request.anchorId) {
    anchor = state.anchors.find(a => a.id === request.anchorId);
    if (!anchor) return reject('ANCHOR_UNKNOWN', 'Ismeretlen időhorgony.');
    const obj = world.getObject(anchor.objectId);
    if (!obj) return reject('ANCHOR_UNKNOWN', 'A horgonyzott objektum ismeretlen.');
    targetX = obj.x; targetZ = obj.z + obj.d / 2 + 3; // in front of the object
  }
  if (![targetDate, targetX, targetZ].every(Number.isFinite)) return reject('INVALID', 'Érvénytelen cél.');

  let snapped = false;
  let dy = Math.abs(targetDate - now);
  if (dy > tier.years && dy <= tier.years + SNAP_TOLERANCE_YEARS) {
    targetDate = now + Math.sign(targetDate - now) * tier.years;
    dy = tier.years; snapped = true;
  }
  if (dy < MIN_JUMP_YEARS) return reject('TOO_SHORT', 'A célidőpont túl közel van a jelenhez.');
  if (dy > tier.years) return reject('OUT_OF_TIME_RANGE', `Időhatótáv túllépve: ${dy.toFixed(2)} év > ${tier.years} év (${tier.id}).`);
  const km = geodesicKm(here, { x: targetX, z: targetZ });
  if (km > tier.km) return reject('OUT_OF_SPACE_RANGE', `Térbeli hatótáv túllépve: ${km.toFixed(1)} km > ${tier.km} km.`);
  const cost = energyCost(dy, tier);
  if (cost > d.charge + 1e-9) return reject('NO_ENERGY', `Nincs elég energia: ${Math.round(cost * 100)}% kell, ${Math.round(d.charge * 100)}% van.`);
  if (anchor) {
    const st = anchorStatus(anchor, state, world, targetDate);
    if (!st.usable) return reject('ANCHOR_INVALID', 'A horgony a célidőben nem használható: ' + st.reason + '.');
  }

  const factor = errorFactor(d.successfulJumps);
  let arrivalDate = targetDate + (rng() * 2 - 1) * tier.timeErrorYears * factor;
  arrivalDate = Math.min(now + tier.years, Math.max(now - tier.years, arrivalDate)); // never outside range (§5.5)
  if (anchor) {
    arrivalDate = Math.max(arrivalDate, anchor.placedAt); // an anchor cannot pull you before its placement
    if (!world.objectExists(anchor.objectId, arrivalDate)) arrivalDate = targetDate;
  }
  const angle = rng() * Math.PI * 2;
  const errM = Math.sqrt(rng()) * tier.spaceErrorKm * 1000 * factor * (anchor ? ANCHOR_ERROR_MULTIPLIER : 1);
  const aim = { x: targetX + Math.cos(angle) * errM, z: targetZ + Math.sin(angle) * errM };

  const landing = findLanding(aim, arrivalDate, world, p => geodesicKm(here, p) <= tier.km);
  if (!landing) return reject('NO_SAFE_LANDING', 'Nincs biztonságos érkezési pont 150 m-en belül; az ugrás megszakadt, energia nem fogyott.');

  return {
    ok: true, snapped, tier: tier.id, cost, from: { date: now, ...here },
    target: { date: targetDate, x: targetX, z: targetZ }, anchorId: anchor ? anchor.id : null,
    arrival: { date: arrivalDate, x: landing.x, z: landing.z }, spatialErrorM: errM, landingShiftM: landing.shift,
  };
}

/** Spiral search for a safe point within 150 m that stays inside the range. */
export function findLanding(aim, date, world, inRange = () => true) {
  for (let r = 0; r <= LANDING_SEARCH_RADIUS_M; r += LANDING_SEARCH_STEP_M) {
    const steps = r === 0 ? 1 : 16;
    for (let i = 0; i < steps; i++) {
      const p = { x: aim.x + r * Math.cos((i * Math.PI) / 8), z: aim.z + r * Math.sin((i * Math.PI) / 8) };
      if (world.isSafeLanding(p.x, p.z, date) && inRange(p)) return { ...p, shift: r };
    }
  }
  return null;
}

/** Applies a successful plan to the state and logs the event. */
export function applyJump(state, plan) {
  if (!plan.ok) throw new Error('Cannot apply a rejected jump');
  const d = state.chronoDevice;
  state.clock.historicalDate = plan.arrival.date;
  state.player.x = plan.arrival.x;
  state.player.z = plan.arrival.z;
  d.charge = Math.max(0, d.charge - plan.cost);
  d.successfulJumps++;
  d.lastJump = { from: plan.from, arrival: plan.arrival, target: plan.target };
  return recordEvent(state, 'TIME_JUMP_COMPLETED', { from: plan.from, target: plan.target, arrival: plan.arrival, cost: plan.cost, anchorId: plan.anchorId, tier: plan.tier });
}

