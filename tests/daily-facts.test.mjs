import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DAILY_FACT_COUNTRIES, dailyDateKey, validDailyFacts } from '../app/daily-facts.ts';

const countries = ['spain', 'denmark', 'greece'];

test('every calendar day stores one sourced, illustrated fact per country', async () => {
  let dates = 0;
  const ids = new Set();
  for (let month = 1; month <= 12; month++) {
    const dayCount = new Date(Date.UTC(2024, month, 0)).getUTCDate();
    for (let day = 1; day <= dayCount; day++) {
      const key = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const file = JSON.parse(await readFile(new URL(`../public/facts/daily/${key}.json`, import.meta.url), 'utf8'));
      assert.equal(validDailyFacts(file, key), true, key);
      assert.equal(file.facts.length, DAILY_FACT_COUNTRIES);
      assert.deepEqual(file.facts.map(fact => fact.country), countries);
      for (const fact of file.facts) {
        assert.equal(ids.has(fact.id), false, fact.id);
        ids.add(fact.id);
        assert.ok(fact.body.split(/\s+/).length <= 48, fact.id);
        assert.ok(fact.image.credit && fact.image.license && fact.image.alt.length > 15, fact.id);
        assert.equal(new URL(fact.image.source).hostname, 'commons.wikimedia.org', fact.id);
        assert.ok(['en.wikipedia.org', 'gml.noaa.gov', 'www.retsinformation.dk', 'www.goarch.org'].includes(new URL(fact.source.url).hostname), fact.id);
      }
      dates++;
    }
  }
  assert.equal(dates, 366);
  assert.equal(ids.size, 366 * DAILY_FACT_COUNTRIES);
});

test('the display date follows Copenhagen, including across UTC midnight', () => {
  assert.equal(dailyDateKey(new Date('2026-01-01T00:30:00+01:00')), '01-01');
  assert.equal(dailyDateKey(new Date('2026-06-30T22:30:00Z')), '07-01');
});
