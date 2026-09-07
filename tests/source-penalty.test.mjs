import { test } from 'node:test';
import assert from 'node:assert/strict';
import { penaltyUntil, readySources } from '../lib/source-penalty.ts';

const sources = [{ name: 'Google' }, { name: 'DMI' }, { name: 'Open-Meteo' }, { name: 'MET Norway' }];

test('a penalised provider is skipped until its penalty expires, in preference order', () => {
  const penalised = new Map([['DMI', 2_000]]);
  assert.deepEqual(readySources(sources, penalised, 1_000).map(entry => entry.name), ['Google', 'Open-Meteo', 'MET Norway']);
  // The penalty ends at the instant named, inclusive.
  assert.deepEqual(readySources(sources, penalised, 2_000).map(entry => entry.name), ['Google', 'DMI', 'Open-Meteo', 'MET Norway']);
});

test('when every provider is penalised they are all asked: no forecast is worse than a stale penalty', () => {
  const penalised = new Map(sources.map(entry => [entry.name, 9_000]));
  assert.deepEqual(readySources(sources, penalised, 1_000).map(entry => entry.name), sources.map(entry => entry.name));
  // And the answer is a copy, so a caller cannot reorder the table.
  assert.notEqual(readySources(sources, penalised, 1_000), sources);
});

test('a refusal that named its own limit is honoured; otherwise the standard penalty applies', () => {
  assert.equal(penaltyUntil(1_000, 3_600_000), 3_601_000);
  assert.equal(penaltyUntil(1_000, 3_600_000, 5_000), 5_000);
});
