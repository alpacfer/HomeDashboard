import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COPENHAGEN, copenhagenClock, copenhagenDayKey, copenhagenHour } from '../lib/copenhagen.ts';

// Copenhagen is UTC+2 in summer and UTC+1 in winter, so these fixtures are
// chosen to land on the far side of midnight from UTC. If any of them ever
// reads the device's zone instead, they fail everywhere except in Denmark.
const summerLate = Date.parse('2026-09-06T22:30:00Z');  // 00:30 on the 7th
const winterLate = Date.parse('2026-01-15T23:30:00Z');  // 00:30 on the 16th
const summerNoon = Date.parse('2026-09-06T10:00:00Z');  // 12:00

test('names the zone once, for everything that reads it', () => {
  assert.equal(COPENHAGEN, 'Europe/Copenhagen');
});

test('the hour is the one on the wall, not the device or UTC', () => {
  assert.equal(copenhagenHour(summerNoon), 12);
  assert.equal(copenhagenHour(summerLate), 0);
  assert.equal(copenhagenHour(winterLate), 0);
  assert.equal(copenhagenHour(Date.parse('2026-09-06T21:59:00Z')), 23);
});

test('the day key rolls at Copenhagen midnight, not UTC midnight', () => {
  assert.equal(copenhagenDayKey(summerNoon), '2026-09-06');
  assert.equal(copenhagenDayKey(summerLate), '2026-09-07');
  assert.equal(copenhagenDayKey(winterLate), '2026-01-16');
  // The summer offset is two hours, so 22:00Z is already tomorrow.
  assert.equal(copenhagenDayKey(Date.parse('2026-09-06T21:59:00Z')), '2026-09-06');
});

test('the clock is 24-hour, zero-padded, and midnight is 00:00', () => {
  assert.equal(copenhagenClock(summerNoon), '12:00');
  assert.equal(copenhagenClock(summerLate), '00:30');
  assert.equal(copenhagenClock(winterLate), '00:30');
  assert.equal(copenhagenClock(Date.parse('2026-09-06T06:05:00Z')), '08:05');
});

test('a Date and its timestamp are read the same way', () => {
  for (const at of [summerNoon, winterLate, summerLate]) {
    assert.equal(copenhagenHour(new Date(at)), copenhagenHour(at));
    assert.equal(copenhagenDayKey(new Date(at)), copenhagenDayKey(at));
    assert.equal(copenhagenClock(new Date(at)), copenhagenClock(at));
  }
});
