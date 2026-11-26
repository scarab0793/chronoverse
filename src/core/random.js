// Deterministic pseudo-random helpers. The world must look the same every time
// a place/date is visited, so procedural content is derived from hashes, never
// from Math.random().

/** Seeded PRNG (mulberry32). Returns a function producing floats in [0, 1). */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable hash of integers/strings to a float in [0, 1). */
export function hash01(...parts) {
  let h = 2166136261 >>> 0;
  for (const p of parts) {
    const s = String(p);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    h ^= 0x9e3779b9;
    h = Math.imul(h ^ (h >>> 16), 2246822507) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
    h ^= h >>> 16;
  }
  return (h >>> 0) / 4294967296;
}

export function randomId(prefix = 'id') {
  const c = globalThis.crypto;
  const raw = c && c.randomUUID ? c.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `${prefix}-${raw}`;
}
