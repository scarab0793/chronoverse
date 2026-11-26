// ChronoAnchor (design doc §6): touching a durable object places a quantum
// mark. The anchor belongs to the current timeline, is valid from its
// placement date while the object exists, and follows the object.

import { randomId } from '../core/random.js';
import { recordEvent } from '../core/EventBus.js';
import { anchorStatus } from './ChronoNavigation.js';

export const TOUCH_DISTANCE_M = 2;

/** Anchorable object whose wall is within touching distance, or null. */
export function touchableObject(state, world) {
  const { x, z } = state.player;
  let best = null;
  for (const b of world.buildingsAt(state.clock.historicalDate)) {
    if (!b.anchorable) continue;
    const gap = Math.hypot(Math.max(0, Math.abs(x - b.x) - b.w / 2), Math.max(0, Math.abs(z - b.z) - b.d / 2));
    if (gap <= TOUCH_DISTANCE_M && (!best || gap < best.gap)) best = { building: b, gap };
  }
  return best ? best.building : null;
}

export function placeAnchor(state, world) {
  const obj = touchableObject(state, world);
  if (!obj) throw new Error('Érints meg egy tartós objektumot (pl. a templom falát) 2 m-en belül.');
  const existing = state.anchors.find(a => a.objectId === obj.id && a.timelineId === state.timelineId && !a.destroyed);
  if (existing && existing.placedAt <= state.clock.historicalDate) return { anchor: existing, created: false };
  const anchor = {
    id: randomId('anchor'), objectId: obj.id, name: obj.name, timelineId: state.timelineId,
    placedAt: state.clock.historicalDate, placedExperiencedHours: state.clock.experiencedHours, destroyed: false,
  };
  state.anchors.push(anchor);
  recordEvent(state, 'ANCHOR_CREATED', { anchorId: anchor.id, objectId: obj.id }, { affected: [obj.id] });
  return { anchor, created: true };
}

/** Marks anchors whose object no longer exists after its destruction date. */
export function refreshAnchorDestruction(state, world) {
  for (const a of state.anchors) {
    if (a.destroyed || a.timelineId !== state.timelineId) continue;
    const obj = world.getObject(a.objectId);
    if (!obj || obj.to <= a.placedAt) {
      a.destroyed = true;
      recordEvent(state, 'ANCHOR_DESTROYED', { anchorId: a.id, objectId: a.objectId }, { affected: [a.objectId] });
    }
  }
}

export function describeAnchors(state, world) {
  return state.anchors.map(a => ({ ...a, status: anchorStatus(a, state, world) }));
}
