import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  activeLockout, callWeight, describeLockout, expectedDailySpend, nextUtcMidnight, OPEN_METEO_LIMITS, refusalLockout,
  UNKNOWN_REFUSAL_MS, validLockout,
} from '../lib/open-meteo-quota.ts';
import { DEFAULT_GRID, MAX_GRID_POINTS } from '../lib/precipitation-grid.ts';

test('a point forecast weighs one call, a grid one call per coordinate', () => {
  assert.equal(callWeight({ locations: 1, days: 3, variables: 6 }), 1);
  assert.equal(callWeight({ locations: 1, days: 8, variables: 7 }), 1);
  assert.equal(callWeight({ locations: 400, days: 0.5, variables: 1 }), 400);
  // Open-Meteo's own examples: two weeks with fifteen variables is 1.5 calls,
  // four weeks 3.0.
  assert.equal(callWeight({ locations: 1, days: 14, variables: 15 }), 1.5);
  assert.equal(callWeight({ locations: 1, days: 28, variables: 15 }), 3);
  assert.equal(callWeight({ locations: 0, days: 3, variables: 6 }), 0);
});

test('one grid request stays inside the per-minute limit and a day of the display well inside the daily one', () => {
  const points = DEFAULT_GRID.columns * DEFAULT_GRID.rows;
  assert.ok(MAX_GRID_POINTS < OPEN_METEO_LIMITS.minute);
  assert.ok(callWeight({ locations: points, days: 0.5, variables: 1 }) < OPEN_METEO_LIMITS.minute);
  const day = expectedDailySpend(points);
  assert.equal(day.total, day.grid + day.hours + day.week);
  // Under a quarter of the quota, so the rest of the household can load the
  // map a few times without muting the display.
  assert.ok(day.total < OPEN_METEO_LIMITS.day / 4, String(day.total));
});

const NOW = Date.UTC(2026, 8, 3, 19, 14, 47);

test('a daily refusal locks Open-Meteo out until midnight UTC, hourly and minutely until the next boundary', () => {
  const daily = refusalLockout(429, '{"reason":"Daily API request limit exceeded. Please try again tomorrow.","error":true}', NOW);
  assert.deepEqual(daily, { until: Date.UTC(2026, 8, 4), reason: 'daily limit' });
  assert.equal(nextUtcMidnight(NOW), Date.UTC(2026, 8, 4));
  const hourly = refusalLockout(429, '{"reason":"Hourly API request limit exceeded"}', NOW);
  assert.deepEqual(hourly, { until: Date.UTC(2026, 8, 3, 20), reason: 'hourly limit' });
  const minutely = refusalLockout(429, '{"reason":"Minutely API request limit exceeded"}', NOW);
  assert.deepEqual(minutely, { until: Date.UTC(2026, 8, 3, 19, 15), reason: 'minutely limit' });
});

test('a refusal that names no limit still stops the next request for a while; anything else is not a lockout', () => {
  assert.deepEqual(refusalLockout(429, '', NOW), { until: NOW + UNKNOWN_REFUSAL_MS, reason: 'rate limited' });
  assert.equal(refusalLockout(500, 'daily', NOW), null);
  assert.equal(refusalLockout(200, '{"reason":"Daily API request limit exceeded"}', NOW), null);
});

test('a stored lockout binds until it expires and never for more than a day', () => {
  const lockout = { until: NOW + 60_000, reason: 'minutely limit' };
  assert.deepEqual(activeLockout(lockout, NOW), lockout);
  assert.equal(activeLockout(lockout, NOW + 60_000), null);
  assert.equal(activeLockout(null, NOW), null);
  // A clock that was years wrong when the lockout was written must not mute
  // Open-Meteo for years.
  assert.equal(activeLockout({ until: NOW + 3 * 86_400_000, reason: 'daily limit' }, NOW), null);
});

test('storage is validated like any other input', () => {
  assert.equal(validLockout({ until: NOW, reason: 'daily limit' }), true);
  assert.equal(validLockout({ until: 'tomorrow', reason: 'daily limit' }), false);
  assert.equal(validLockout({ until: NOW }), false);
  assert.equal(validLockout(null), false);
  assert.equal(validLockout('until'), false);
});

test('the reason names the limit and the Copenhagen time it clears', () => {
  // Midnight UTC is 02:00 in Copenhagen in September.
  assert.equal(describeLockout({ until: Date.UTC(2026, 8, 4), reason: 'daily limit' }), 'Open-Meteo daily limit, not asked again before 02:00');
});
