import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHECK_FALLBACK_MS, CHECK_MARGIN_MS, CHECK_MIN_MS, CHECK_RETRY_MS, GRID_FALLBACK_MS, MODEL_META_URL,
  nextCheckAt, parseModelRun, shouldFetchGrid,
} from '../lib/forecast-refresh.ts';
import { coversView, GRID_MODEL, isQuietHours, MAP_BOUNDS } from '../lib/precipitation-grid.ts';

// A real metadata payload, captured 3 September 2026: the 12:00Z run became
// available at 14:45:49Z.
const META = {
  chunk_time_length: 90,
  data_end_time: 1788652800,
  last_run_availability_time: 1788446749,
  last_run_initialisation_time: 1788436800,
  last_run_modification_time: 1788446661,
  temporal_resolution_seconds: 3600,
  update_interval_seconds: 10800,
};
const RUN = parseModelRun(META);
const HOUR = 3600_000;
// 15:00 Copenhagen on 3 September 2026 (CEST is UTC+2).
const AFTERNOON = Date.UTC(2026, 8, 3, 13, 0);

test('the metadata file is the one for the model the grid requests', () => {
  assert.equal(MODEL_META_URL, 'https://api.open-meteo.com/data/' + GRID_MODEL + '/static/meta.json');
});

test('parses run metadata into milliseconds and rejects anything incomplete', () => {
  assert.deepEqual(RUN, { initialised: 1788436800_000, available: 1788446749_000, interval: 10800_000 });
  // The interval is optional and defaults to the three hours the model runs at.
  assert.equal(parseModelRun({ last_run_initialisation_time: 1, last_run_availability_time: 2 }).interval, 3 * HOUR);
  assert.equal(parseModelRun({ last_run_initialisation_time: 1 }), null);
  assert.equal(parseModelRun({ last_run_initialisation_time: '1788436800', last_run_availability_time: 1 }), null);
  assert.equal(parseModelRun({ last_run_initialisation_time: 0, last_run_availability_time: 1 }), null);
  assert.equal(parseModelRun(null), null);
  assert.equal(parseModelRun('meta'), null);
  assert.equal(parseModelRun([]), null);
});

test('the grid is fetched only for a reason that changes what is on screen', () => {
  const held = { run: RUN.initialised, fetchedAt: AFTERNOON - HOUR, bounds: { south: 55.5, west: 12, north: 56, east: 13 } };
  const view = MAP_BOUNDS;
  const input = { now: AFTERNOON, grid: held, run: RUN, view, covers: coversView };
  // Same run, view covered: nothing to gain.
  assert.equal(shouldFetchGrid(input), false);
  // No grid at all.
  assert.equal(shouldFetchGrid({ ...input, grid: null }), true);
  // A newer run than the one held.
  assert.equal(shouldFetchGrid({ ...input, run: { ...RUN, initialised: RUN.initialised + 3 * HOUR } }), true);
  // A grid fetched without metadata has no run to compare, so a known run wins.
  assert.equal(shouldFetchGrid({ ...input, grid: { ...held, run: null } }), true);
  // The view grew past the grid: the bare strip must be filled.
  assert.equal(shouldFetchGrid({ ...input, view: { ...view, east: 13.5 } }), true);
  // No view yet (map not laid out) does not force a fetch on its own.
  assert.equal(shouldFetchGrid({ ...input, view: null }), false);
});

test('without metadata the grid falls back to a three-hour cadence', () => {
  const grid = { run: null, fetchedAt: AFTERNOON - GRID_FALLBACK_MS + 60_000, bounds: { south: 55.5, west: 12, north: 56, east: 13 } };
  assert.equal(shouldFetchGrid({ now: AFTERNOON, grid, run: null, view: MAP_BOUNDS, covers: coversView }), false);
  assert.equal(shouldFetchGrid({ now: AFTERNOON + 60_000, grid, run: null, view: MAP_BOUNDS, covers: coversView }), true);
});

test('the next check aims just past the next expected publication', () => {
  // The same run shifted six hours earlier, so every moment in this test falls
  // in the daytime: the 06Z run arrived 08:45:49Z, the next is due about
  // 11:45:49Z, and checked at 11:00 local (09:00Z) the check lands two
  // minutes after that.
  const RUN = { ...parseModelRun(META), initialised: parseModelRun(META).initialised - 6 * HOUR, available: parseModelRun(META).available - 6 * HOUR };
  const expected = RUN.available + RUN.interval + CHECK_MARGIN_MS;
  assert.equal(nextCheckAt(AFTERNOON - 4 * HOUR, RUN), expected);
  // The expected moment has passed and nothing new appeared: retry soon.
  assert.equal(nextCheckAt(expected + 60_000, RUN), expected + 60_000 + CHECK_RETRY_MS);
  // Overdue by more than a whole interval means stuck, not late: back off.
  assert.equal(nextCheckAt(expected + RUN.interval + 60_000, RUN), expected + RUN.interval + 60_000 + CHECK_FALLBACK_MS);
  // No metadata: hourly.
  assert.equal(nextCheckAt(AFTERNOON, null), AFTERNOON + CHECK_FALLBACK_MS);
  // Never sooner than the floor, even if the expected moment is seconds away.
  assert.equal(nextCheckAt(expected - 1000, RUN), expected - 1000 + CHECK_MIN_MS);
  assert.ok(CHECK_RETRY_MS >= CHECK_MIN_MS);
});

test('a check that would land in the quiet hours waits for them to end', () => {
  // 22:30 local on 3 September: a retry five minutes later is fine, but a run
  // expected at 23:45 local is not checked until 06:00.
  const lateEvening = Date.UTC(2026, 8, 3, 20, 30);
  const run = { initialised: 0, available: lateEvening + 75 * 60_000 - 3 * HOUR, interval: 3 * HOUR };
  const at = nextCheckAt(lateEvening, run);
  assert.equal(isQuietHours(at), false);
  assert.equal(at, Date.UTC(2026, 8, 4, 4, 0), 'resumes at 06:00 CEST');
  // A check due before 23:00 is not delayed.
  const early = { ...run, available: run.available - 60 * 60_000 };
  assert.equal(nextCheckAt(lateEvening, early), lateEvening + 15 * 60_000 + CHECK_MARGIN_MS);
});
