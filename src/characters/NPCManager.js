// ChronoNPC for the 3D world. Persistent villagers are generated from a
// deterministic "birth slot" sequence, so any date can be reconstructed on
// demand (design doc §23.1, "other periods: on-demand reconstruction") and
// the same person is met again older when the player returns years later.
// Each villager has an id, name, birth/death date, sex, parents (an earlier
// slot), household, role (from data/npc_social_archetypes.json), schedule,
// home/work building and memories of the player (stored in the GameState).

import { hash01 } from '../core/random.js';
import { hourOfDay, formatYear, HOURS_PER_YEAR } from '../core/time.js';
import { recordEvent } from '../core/EventBus.js';

const BASE_YEAR = -9600;
const SPACING = 6;              // one birth slot every 6 years -> ~8-12 living villagers
const MIN_VISIBLE_AGE = 6;
const INHABITED = [[-9400, -8600], [1120, 1e6]];
const REFERENCE_EPOCHS = [-8999, 1435, 1885, 2032];

const NAMES = [
  { until: -3000, m: ['Aru', 'Tesk', 'Orin', 'Varo', 'Hosk', 'Kalu'], f: ['Mana', 'Ilka', 'Seni', 'Edra', 'Lusa', 'Neva'], surnames: null },
  { until: 1550, m: ['John', 'William', 'Thomas', 'Robert', 'Richard', 'Henry', 'Walter', 'Geoffrey'], f: ['Agnes', 'Joan', 'Alice', 'Margaret', 'Isabel', 'Matilda', 'Emma', 'Cecily'], surnames: ['Smith', 'Miller', 'Thatcher', 'Cooper', 'Fletcher', 'Baker', 'Ward', 'Carter', 'Fuller', 'Turner', 'Reeve', 'Wright'] },
  { until: 1800, m: ['John', 'William', 'Thomas', 'Edward', 'James', 'Francis'], f: ['Mary', 'Elizabeth', 'Anne', 'Sarah', 'Susan', 'Hannah'], surnames: ['Smith', 'Miller', 'Cooper', 'Baker', 'Turner', 'Wright'] },
  { until: 1930, m: ['George', 'Albert', 'Arthur', 'Frederick', 'Alfred', 'Walter'], f: ['Ellen', 'Florence', 'Emily', 'Ada', 'Edith', 'Lucy'], surnames: ['Smith', 'Turner', 'Wright', 'Baker'] },
  { until: 1e6, m: ['Oliver', 'Harry', 'Jack', 'Noah', 'Leo', 'Daniel', 'Samuel'], f: ['Amelia', 'Olivia', 'Isla', 'Grace', 'Chloe', 'Sophie', 'Ruby'], surnames: ['Smith', 'Turner', 'Wright', 'Baker', 'Patel', 'Nowak'] },
];

const pick = (arr, h) => arr[Math.floor(h * arr.length) % arr.length];
const nearestEpoch = date => REFERENCE_EPOCHS.reduce((a, b) => (Math.abs(b - date) < Math.abs(a - date) ? b : a));
const inhabited = date => INHABITED.some(([a, b]) => date >= a && date < b);

export function createNPCManager({ archetypes = [], world }) {
  const cache = new Map();

  function person(k) {
    if (cache.has(k)) return cache.get(k);
    const h = key => hash01('npc', k, key);
    const born = BASE_YEAR + k * SPACING + h('born') * SPACING;
    const lifespan = born < 1800 ? 38 + h('life') * 40 : born < 1950 ? 55 + h('life') * 32 : 70 + h('life') * 26;
    const sex = h('sex') < 0.5 ? 'f' : 'm';
    const pool = NAMES.find(n => born < n.until);
    const fatherSlot = k - Math.round((24 + h('gen') * 12) / SPACING);
    const motherSlot = fatherSlot - 1;
    let surname = null;
    if (pool.surnames) {
      const father = fatherSlot >= 0 ? person(fatherSlot) : null;
      surname = father && father.surname && h('newfamily') > 0.12 ? father.surname : pick(pool.surnames, h('surname'));
    }
    const p = {
      id: `npc-${k}`, slot: k, born, death: born + lifespan, sex,
      givenName: pick(pool[sex], h('given')), surname,
      parents: [`npc-${fatherSlot}`, `npc-${motherSlot}`], layer: 'simulated',
    };
    p.name = surname ? `${p.givenName} ${surname}` : p.givenName;
    cache.set(k, p);
    return p;
  }

  function roleFor(p, date) {
    const age = date - p.born;
    if (age < 14) return { role: 'Gyermek', archetypeId: null };
    const epoch = nearestEpoch(date);
    const roles = archetypes.filter(a => a.year === epoch);
    if (!roles.length) return { role: 'Lakos', archetypeId: null };
    const a = pick(roles, hash01('role', p.slot, epoch));
    return { role: a.role, archetypeId: a.id, language: a.language_context };
  }

  /** Living villagers at a date (only while the site is inhabited). */
  function aliveAt(date) {
    if (!inhabited(date)) return [];
    const out = [];
    const kMax = Math.floor((date - MIN_VISIBLE_AGE - BASE_YEAR) / SPACING);
    const kMin = Math.max(0, Math.floor((date - 120 - BASE_YEAR) / SPACING));
    for (let k = kMin; k <= kMax; k++) {
      const p = person(k);
      if (p.born + MIN_VISIBLE_AGE <= date && date < p.death) out.push(p);
    }
    return out;
  }

  function placeOf(building) { return building ? { x: building.x, z: building.z + building.d / 2 + 1.5, id: building.id } : { x: 20, z: 4, id: null }; }

  /** Snapshot with age, role, activity and world position for rendering. */
  function snapshot(date) {
    const buildings = world.buildingsAt(date);
    const homes = buildings.filter(b => b.residential || b.style === 'shelter');
    const works = buildings.filter(b => !b.residential && b.style !== 'bridge' && b.style !== 'well' && b.style !== 'shelter');
    const hour = hourOfDay(date);
    return aliveAt(date).map(p => {
      const age = date - p.born;
      const r = roleFor(p, date);
      const household = (p.surname || p.givenName) + Math.floor((p.slot * SPACING) / 60);
      const home = placeOf(homes.length ? pick(homes, hash01('home', household)) : null);
      const work = placeOf(works.length ? pick(works, hash01('work', p.slot, nearestEpoch(date))) : null);
      let activity, t = 0;
      if (age < 14) { activity = hour < 8 || hour >= 20 ? 'Alvás' : 'Játék'; }
      else if (hour < 6.5 || hour >= 22) activity = 'Alvás';
      else if (hour < 7.5) { activity = 'Úton a munkába'; t = hour - 6.5; }
      else if (hour < 17.5) { activity = 'Munka'; t = 1; }
      else if (hour < 18.5) { activity = 'Úton hazafelé'; t = 1 - (hour - 17.5); }
      else activity = 'Pihenés';
      const wobble = hash01('w', p.slot, Math.floor(hour * 4));
      const x = home.x + (work.x - home.x) * t + Math.sin(hour * 3 + p.slot) * 2 + (wobble - 0.5);
      const z = home.z + (work.z - home.z) * t + Math.cos(hour * 2 + p.slot) * 1.2;
      return { ...p, age: Math.floor(age), ...r, activity, visible: activity !== 'Alvás', x, z, homeId: home.id, workId: work.id };
    });
  }

  function greeting(date) {
    if (date < 0) return { text: '„…" – ismeretlen őskori nyelv. A ChronoLens nem tud fordítani; csak gesztusokkal érthetitek meg egymást.', lens: 'nincs fordítás' };
    if (date < 1550) return { text: '„God gif yow good day, straunger." – Isten adjon jó napot, idegen! Nem idevalósi vagy, ugye?', lens: 'középangol → magyar' };
    if (date < 1950) return { text: '„Good day to you." – Jó napot! Messziről jött?', lens: 'angol → magyar' };
    return { text: '„Hi there!" – Szia! Szép napunk van, nem?', lens: 'angol → magyar' };
  }

  /**
   * Talks to an NPC: builds the line from memory of earlier meetings (only
   * memories formed at or before the current date count – meeting someone in
   * their past means they have not met you yet) and stores a new memory.
   */
  function talk(state, npc) {
    const date = state.clock.historicalDate;
    const mem = (state.npcs.memories[npc.id] || []).filter(m => m.timelineId === state.timelineId && m.date <= date);
    const g = greeting(date);
    let line = g.text;
    const last = mem[mem.length - 1];
    if (last) {
      const years = date - last.date;
      const recall = Math.exp(-years / 30) * (npc.age > 70 ? 0.6 : 1);
      if (years < 1 / 365) line = 'Ismét itt? Az előbb beszéltünk.';
      else if (hash01('recall', npc.id, Math.floor(date)) < recall) {
        line = `Emlékszem magára! ${formatYear(Math.floor(last.date))} körül beszéltünk.`;
        const playerAged = (state.clock.experiencedHours - last.experiencedHours) / HOURS_PER_YEAR;
        if (years > 5 && playerAged < years / 3) line += ' Maga semmit sem öregedett… hogy lehet ez?';
      } else line = 'Ismerős az arca… de nem tudom, honnan.';
    }
    if (!last || date - last.date >= 1 / 365) {
      (state.npcs.memories[npc.id] ||= []).push({ date, experiencedHours: state.clock.experiencedHours, timelineId: state.timelineId, kind: 'conversation' });
    }
    recordEvent(state, 'NPC_INTERACTION', { npcId: npc.id, kind: 'conversation' }, { affected: [npc.id] });
    return { speaker: `${npc.name} (${npc.age}, ${npc.role.toLowerCase()})`, line, lens: g.lens, metBefore: !!last };
  }

  function family(id) {
    const k = Number(id.replace('npc-', ''));
    const p = person(k);
    const children = [];
    for (let c = k + 1; c <= k + 12; c++) if (person(c).parents.includes(id)) children.push(person(c).id);
    return { person: p, parents: p.parents, children };
  }

  return { person: k => person(k), aliveAt, snapshot, talk, family, greeting };
}
