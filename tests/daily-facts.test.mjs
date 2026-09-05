import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DAILY_FACT_CATEGORIES, DAILY_FACT_COUNT, dailyDateKey, mediaShape, pinnedDateKey, validDailyFacts, yearsAgo } from '../lib/daily-facts.ts';
import { FACTS_PER_DAY } from '../scripts/lib/fact-selection.mjs';

test('every calendar day stores five sourced, illustrated, modern facts', async () => {
  let dates = 0;
  let modern = 0;
  let recent = 0;
  const thisYear = new Date().getUTCFullYear();
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
        if (thisYear - fact.year >= 1 && thisYear - fact.year <= 5) recent++;
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
  // 'world' is the catch-all: the bucket an entry lands in when none of the six
  // reasons-to-care matched, which is why it carries a -45 score penalty. The
  // bar was 0.35 when a day held three facts and the calendar sat at 31%.
  // Five facts a day moved it to 40%, because the fourth and fifth slots are
  // filled from further down the ranking: the share by slot runs 17, 29, 44,
  // 51, 61 per cent. This is recalibrated, not relaxed — a refresh that drifts
  // past 45% is still drifting, and the fix then is better category terms
  // rather than a looser number.
  assert.ok((categories.get('world') ?? 0) / ids.size < 0.45, 'too many facts fall back to the catch-all category');
  // The other half of the same point: modern also means the calendar did not
  // stop five years ago. The supply is thin — the calendar pages carry only a
  // couple of hundred recent entries that are neither grim nor political — so
  // the bar is set well under what a refresh actually produces. See
  // RECENT_YEARS and RECENT_FLOOR in scripts/lib/fact-selection.mjs.
  assert.ok(recent >= 25, `only ${recent} facts are from the last five years`);
});

test('every editorial seed is still on its date after a refresh', async () => {
  // A seed whose Commons file has been deleted or renamed is passed over and
  // an automatic pick quietly takes its place, which is the one way the
  // curated entries can disappear without the generator failing.
  const { facts: seeds } = JSON.parse(await readFile(new URL('../data/daily-fact-overrides.json', import.meta.url), 'utf8'));
  for (const seed of seeds) {
    const file = JSON.parse(await readFile(new URL(`../public/facts/daily/${seed.date}.json`, import.meta.url), 'utf8'));
    const fact = file.facts.find(candidate => candidate.title === seed.title);
    assert.ok(fact, `${seed.date}: the seed "${seed.title}" is not in the file`);
    assert.equal(fact.year, seed.year, seed.title);
    assert.equal(fact.category, seed.category, seed.title);
    if (seed.alt) assert.equal(fact.image.alt, seed.alt, seed.title);
  }
});

test('a clip is laid out by its own shape, and a picture never is', () => {
  // The real transcodes in the calendar, at the sizes Commons serves them.
  assert.equal(mediaShape(426, 214), 'wide', 'the Mars horizon panorama, 1.99:1');
  assert.equal(mediaShape(426, 240), 'wide', '16:9');
  assert.equal(mediaShape(354, 240), 'boxy', 'Ariane 5 at 1.48 stays in the layout the panel was built around');
  assert.equal(mediaShape(320, 240), 'boxy', 'academy 4:3');
  assert.equal(mediaShape(240, 320), 'tall');
  assert.equal(mediaShape(1080, 1920), 'tall', 'a phone-shot clip, if one ever reaches the calendar');
  assert.equal(mediaShape(240, 240), 'boxy', 'square is not tall');
  // A shape is asked for before a clip has loaded, so bad numbers must not
  // throw or invent a layout: they fall back to the one a still would get.
  for (const bad of [[0, 100], [100, 0], [-1, 5], [Number.NaN, 10], [Infinity, 10]]) {
    assert.equal(mediaShape(...bad), 'boxy', JSON.stringify(bad));
  }
});

test('the browser and the generator agree on how many facts a day holds', () => {
  // lib/ may not import from scripts/, and the generator runs as plain Node
  // and cannot import a .ts module, so the two constants are written twice.
  // A mismatch would make validDailyFacts reject every file the generator
  // writes, and the panel would show "temporarily unavailable" for good.
  assert.equal(DAILY_FACT_COUNT, FACTS_PER_DAY);
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
  const facts = Array.from({ length: DAILY_FACT_COUNT }, (_, index) => ({ ...fact, id: `id-${index}` }));
  const file = { date: '09-05', dateLabel: '5 September', facts };
  assert.equal(validDailyFacts(file, '09-05'), true);
  assert.equal(validDailyFacts(file, '09-06'), false);
  assert.equal(validDailyFacts({ ...file, facts: facts.slice(1) }, '09-05'), false, 'a short day is refused');
  assert.equal(validDailyFacts({ ...file, facts: [...facts, fact] }, '09-05'), false, 'so is a long one');
  assert.equal(validDailyFacts({ ...file, facts: facts.map(() => fact) }, '09-05'), false, 'and one repeated fact');
  // A clip is optional, so absent stays valid; present and malformed does not.
  // The panel reads width and height before a frame has loaded to shape the
  // row, so a file that omits them would lay the row out from undefined.
  const clip = { src: 'https://upload.wikimedia.org/a.webm', poster: 'https://upload.wikimedia.org/a.jpg', width: 426, height: 240, seconds: 16,
    credit: 'NASA', source: 'https://commons.wikimedia.org/x', license: 'Public domain', licenseUrl: 'https://commons.wikimedia.org/x' };
  const withClip = size => ({ ...file, facts: facts.map((f, i) => i ? f : { ...f, video: { ...clip, ...size } }) });
  assert.equal(validDailyFacts(withClip({}), '09-05'), true);
  for (const bad of [{ width: undefined }, { height: undefined }, { width: 0 }, { height: -240 }, { width: 426.5 }, { width: '426' }]) {
    assert.equal(validDailyFacts(withClip(bad), '09-05'), false, JSON.stringify(bad));
  }
  for (const bad of [{ src: 'http://insecure/a.webm' }, { poster: 'not a url' }]) {
    assert.equal(validDailyFacts(withClip(bad), '09-05'), false, JSON.stringify(bad));
  }
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
