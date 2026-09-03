import { test } from 'node:test';
import assert from 'node:assert/strict';
import { debugFlags, pinnedNow } from '../lib/debug-flags.ts';

test('weather is live unless the URL says off, so a typo cannot silence the display', () => {
  assert.equal(debugFlags('').weather, 'live');
  assert.equal(debugFlags('?scene=map').weather, 'live');
  assert.equal(debugFlags('?weather=of').weather, 'live');
  assert.equal(debugFlags('?weather=OFF').weather, 'live');
  assert.equal(debugFlags('?weather=off').weather, 'off');
  assert.equal(debugFlags('?scene=transport&weather=off').weather, 'off');
});

test('the clock can be pinned to a Copenhagen time, and only to one that exists', () => {
  assert.equal(debugFlags('').time, null);
  assert.deepEqual(debugFlags('?time=08:46').time, { hour: 8, minute: 46 });
  assert.deepEqual(debugFlags('?weather=off&time=00:00').time, { hour: 0, minute: 0 });
  assert.equal(debugFlags('?time=24:00').time, null);
  assert.equal(debugFlags('?time=08:60').time, null);
  assert.equal(debugFlags('?time=8:46').time, null);
  assert.equal(debugFlags('?time=now').time, null);
});

test('a pinned time shifts now by whole hours and minutes and keeps the seconds', () => {
  // 19:14:47 UTC is 21:14:47 in Copenhagen on this date.
  const now = new Date(Date.UTC(2026, 8, 3, 19, 14, 47));
  assert.equal(pinnedNow({ hour: 8, minute: 46 }, now).getTime(), Date.UTC(2026, 8, 3, 6, 46, 47));
  assert.equal(pinnedNow({ hour: 23, minute: 30 }, now).getTime(), Date.UTC(2026, 8, 3, 21, 30, 47));
  assert.equal(pinnedNow(null, now), now);
});
