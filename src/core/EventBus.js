// In-process publish/subscribe plus the persistent event log stored in the
// GameState (event-sourcing foundation, design doc §30).

export const EVENT_TYPES = Object.freeze([
  'PLAYER_CREATED', 'PLAYER_MOVED', 'TIME_ADVANCED', 'TIME_JUMP_REQUESTED', 'TIME_JUMP_COMPLETED',
  'TIME_JUMP_REJECTED', 'ANCHOR_CREATED', 'ANCHOR_DESTROYED', 'NPC_BORN', 'NPC_DIED', 'NPC_MOVED',
  'NPC_INTERACTION', 'RELATIONSHIP_CHANGED', 'MARRIAGE_CREATED', 'PROPERTY_TRANSFERRED',
  'BUILDING_CONSTRUCTED', 'BUILDING_DESTROYED', 'ITEM_PRODUCED', 'ITEM_TRADED', 'ITEM_CONSUMED',
  'TECHNOLOGY_UNLOCKED', 'TIMELINE_FORKED', 'TEMPORAL_RIPPLE', 'EMERGENCY_RECALL', 'CHARACTER_DEATH',
  'GAME_SAVED', 'GAME_LOADED',
]);

/** Events that only form a journal; older ones may be trimmed to bound save size. */
const JOURNAL_ONLY = new Set(['TIME_JUMP_REQUESTED', 'TIME_JUMP_REJECTED', 'NPC_INTERACTION', 'ITEM_CONSUMED', 'GAME_SAVED', 'GAME_LOADED', 'TIME_ADVANCED', 'PLAYER_MOVED']);
export const JOURNAL_LIMIT = 300;

export class EventBus {
  constructor() { this.handlers = new Map(); }
  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.handlers.get(type).delete(fn);
  }
  emit(type, payload) {
    for (const key of [type, '*']) for (const fn of this.handlers.get(key) || []) fn(payload, type);
  }
}

/**
 * Appends an event to the state's log with causal ordering metadata and
 * returns it. `causes` lists ids of preceding events this one depends on.
 */
export function recordEvent(state, type, data = {}, { affected = [], causes = [] } = {}) {
  if (!EVENT_TYPES.includes(type)) throw new Error('Unknown event type: ' + type);
  state.eventSeq = (state.eventSeq || 0) + 1;
  const event = {
    id: `ev-${state.eventSeq}`,
    seq: state.eventSeq,
    type,
    timelineId: state.timelineId,
    historicalDate: state.clock.historicalDate,
    experiencedHours: state.clock.experiencedHours,
    affected,
    causes,
    data,
  };
  state.events.push(event);
  if (JOURNAL_ONLY.has(type)) trimJournal(state);
  return event;
}

function trimJournal(state) {
  let journal = 0;
  for (const e of state.events) if (JOURNAL_ONLY.has(e.type)) journal++;
  if (journal <= JOURNAL_LIMIT) return;
  let drop = journal - JOURNAL_LIMIT;
  state.events = state.events.filter(e => !(JOURNAL_ONLY.has(e.type) && drop-- > 0));
}
