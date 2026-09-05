import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moodContext } from '../lib/clock-conditions.ts';
import { tenantMood } from '../lib/clock-tenant.ts';

// 2026-08-31T22:00:00Z is 00:00 the next day in Copenhagen: the hour has to
// come from the zone, not from the device or the UTC stamp.
test('the hour is Copenhagen-local, not the device or UTC hour', () => {
  assert.equal(moodContext(new Date('2026-08-31T22:00:00Z'), null).hour, 0);
  assert.equal(moodContext(new Date('2026-08-31T12:00:00Z'), null).hour, 14);
  // January is CET, one hour ahead rather than two.
  assert.equal(moodContext(new Date('2026-01-31T12:00:00Z'), null).hour, 13);
});

test('a missing forecast reads as neither warm, cold nor wet', () => {
  assert.deepEqual(moodContext(new Date('2026-08-31T12:00:00Z'), null),
    { hour: 14, temperature: null, wet: false });
  assert.deepEqual(moodContext(new Date('2026-08-31T12:00:00Z'), { temperature: null, wet: false }),
    { hour: 14, temperature: null, wet: false });
});

test('the context it builds is the one the Tenant reads its mood from', () => {
  const noon = new Date('2026-08-31T12:00:00Z');
  assert.equal(tenantMood(moodContext(noon, { temperature: 18, wet: true })), 'rain');
  assert.equal(tenantMood(moodContext(noon, { temperature: 28, wet: false })), 'hot');
  assert.equal(tenantMood(moodContext(noon, { temperature: -3, wet: false })), 'cold');
  assert.equal(tenantMood(moodContext(noon, { temperature: 18, wet: false })), 'awake');
  // Sleep beats the sky: 01:00 Copenhagen is asleep however wet it is.
  assert.equal(tenantMood(moodContext(new Date('2026-08-30T23:00:00Z'), { temperature: 18, wet: true })), 'asleep');
});
