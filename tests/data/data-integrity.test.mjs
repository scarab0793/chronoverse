// Validates every JSON database listed in data/manifest.json with the same
// validator the browser uses (js/chrono-db.js), plus a few cross-checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadLegacy } from '../helpers/legacy.mjs';

const { validate } = loadLegacy('chrono-db.js');
const root = new URL('../../', import.meta.url);
const read = p => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const manifest = read('data/manifest.json');

test('manifest lists 16 modules', () => {
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.modules.length, 16);
});

for (const m of manifest.modules) {
  test(`module ${m.id} passes ChronoDB validation`, () => {
    const d = read(m.path);
    assert.doesNotThrow(() => validate(d, m));
  });
}

test('total record count matches manifest (808)', () => {
  const total = manifest.modules.reduce((s, m) => s + read(m.path).records.length, 0);
  const expected = manifest.modules.reduce((s, m) => s + m.expected_records, 0);
  assert.equal(total, expected);
  assert.equal(total, 808);
});

test('record ids are unique across all modules', () => {
  const seen = new Map();
  for (const m of manifest.modules) for (const r of read(m.path).records) {
    assert.ok(!seen.has(r.id), `duplicate id ${r.id} in ${m.id} and ${seen.get(r.id)}`);
    seen.set(r.id, m.id);
  }
});

test('industry dependencies only reference existing recipes', () => {
  const d = read('data/chronoindustry.json');
  const ids = new Set(d.records.map(r => r.id));
  for (const r of d.records) for (const dep of r.dependencies) assert.ok(ids.has(dep), `${r.id} -> ${dep}`);
});
