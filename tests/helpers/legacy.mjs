// Loads the legacy UMD-style modules in js/ (which are plain scripts, not ES
// modules) inside an isolated VM context and returns their CommonJS exports.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

export function loadLegacy(file) {
  const src = readFileSync(new URL('../../js/' + file, import.meta.url), 'utf8');
  const module = { exports: {} };
  const context = vm.createContext({ module, crypto: webcrypto });
  vm.runInContext(src, context, { filename: file });
  return module.exports;
}

export function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: k => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: k => data.delete(k),
    key: i => [...data.keys()][i] ?? null,
    get length() { return data.size; },
    dump: () => Object.fromEntries(data),
  };
}
