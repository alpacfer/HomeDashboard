import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DAILY_FACT_CATEGORIES, DAILY_FACT_COUNT, dailyDateKey, pinnedDateKey, validDailyFacts, yearsAgo } from '../lib/daily-facts.ts';

test('every calendar day stores three sourced, illustrated, modern facts', async () => {
  let dates = 0;
  let modern = 0;
  const ids = new Set();
  const categories = new Map();
  for (let month = 1; month <= 12; month++) {
    const dayCount = new Date(Date.UTC(2024, month, 0)).getUTCDate();
    for (let day = 1; day <= dayCount; day++) {
      const key = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const file = JSON.parse(await readFile(new URL(`../public/facts/daily/${key}.json`, import.meta.url), 'utf8'));
      assert.equal(validDailyFacts(file, key), true, key);
      for (const fact of file.facts) {
        assert.equal(ids.has(fact.id), false, fact.id);
        ids.add(fact.id);
        categories.set(fact.category, (categories.get(fact.category) ?? 0) + 1);
        assert.ok(DAILY_FACT_CATEGORIES.includes(fact.category), fact.id);
        assert.ok(fact.year >= 1000 && fact.year <= new Date().getUTCFullYear(), `${fact.id}: year ${fact.year}`);
        assert.ok(fact.title.length <= 60, `${fact.id}: headline too long for the panel`);
        assert.ok(fact.body.split(/\s+/).length <= 48, fact.id);
        assert.equal(/^\d{3,4}\s*[:–-]/.test(fact.body), false, `${fact.id}: the year is shown on its own, not in the sentence`);
        assert.ok(fact.image.credit && fact.image.license && fact.image.alt.length > 15, fact.id);
        assert.equal(new URL(fact.image.source).hostname, 'commons.wikimedia.org', fact.id);
        assert.equal(new URL(fact.source.url).hostname, 'en.wikipedia.org', fact.id);
        if (fact.year >= 1900) modern++;
      }
      dates++;
    }
  }
  assert.equal(dates, 366);
  assert.equal(ids.size, 366 * DAILY_FACT_COUNT);
  // The whole point of the rework: this is a modern, curious calendar, not a
  // list of medieval councils. A regeneration that quietly drifts back to
  // antiquity fails here rather than on the wall.
  assert.ok(modern / ids.size > 0.85, `only ${Math.round(100 * modern / ids.size)}% of facts are from 1900 or later`);
  assert.ok((categories.get('world') ?? 0) / ids.size < 0.35, 'too many facts fall back to the catch-all category');
});

test('the display date follows Copenhagen, including across UTC midnight', () => {
  assert.equal(dailyDateKey(new Date('2026-01-01T00:30:00+01:00')), '01-01');
  assert.equal(dailyDateKey(new Date('2026-06-30T22:30:00Z')), '07-01');
});

test('an anniversary is shown as a distance, counted in Copenhagen', () => {
  const now = new Date('2026-09-05T10:00:00+02:00');
  assert.equal(yearsAgo(2005, now), '21 years ago');
  assert.equal(yearsAgo(2025, now), '1 year ago');
  assert.equal(yearsAgo(2026, now), '');
  assert.equal(yearsAgo(0, now), '');
  // 1 January in Copenhagen is still 31 December in UTC.
  assert.equal(yearsAgo(2000, new Date('2027-01-01T00:30:00+01:00')), '27 years ago');
});

test('a file with the wrong shape is refused before it reaches the screen', () => {
  const fact = {
    id: 'x', date: '09-05', dateLabel: '5 September', category: 'tech', categoryName: 'Tech', year: 2005,
    title: 'T', body: 'B',
    source: { name: 'n', url: 'https://en.wikipedia.org/wiki/X', calendarUrl: 'https://en.wikipedia.org/wiki/September_5', license: { name: 'l', url: 'https://example.org' } },
    image: { src: 'https://a/b.jpg', alt: 'a picture of something', credit: 'c', source: 'https://commons.wikimedia.org/x', license: 'l', licenseUrl: 'https://commons.wikimedia.org/x' },
  };
  const file = { date: '09-05', dateLabel: '5 September', facts: [fact, { ...fact, id: 'y' }, { ...fact, id: 'z' }] };
  assert.equal(validDailyFacts(file, '09-05'), true);
  assert.equal(validDailyFacts(file, '09-06'), false);
  assert.equal(validDailyFacts({ ...file, facts: [fact, { ...fact, id: 'y' }] }, '09-05'), false);
  assert.equal(validDailyFacts({ ...file, facts: [fact, fact, fact] }, '09-05'), false);
  assert.equal(validDailyFacts({ ...file, facts: file.facts.map(f => ({ ...f, category: 'denmark' })) }, '09-05'), false);
  assert.equal(validDailyFacts({ ...file, facts: file.facts.map(f => ({ ...f, year: 0 })) }, '09-05'), false);
  assert.equal(validDailyFacts({ ...file, facts: file.facts.map(f => ({ ...f, image: { ...f.image, src: 'http://a/b.jpg' } })) }, '09-05'), false);
});

test('a pinned date reaches a fact that is not today\u2019s, and a bad one is ignored', () => {
  assert.equal(pinnedDateKey('?scene=fact&date=05-28'), '05-28');
  assert.equal(pinnedDateKey('?date=02-29'), '02-29', 'the calendar has all 366 days');
  assert.equal(pinnedDateKey(''), null);
  assert.equal(pinnedDateKey('?date=13-01'), null);
  assert.equal(pinnedDateKey('?date=02-30'), null);
  assert.equal(pinnedDateKey('?date=1-1'), null);
  assert.equal(pinnedDateKey('?date=nonsense'), null);
});
