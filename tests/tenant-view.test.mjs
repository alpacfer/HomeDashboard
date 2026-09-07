import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GESTURE_MS, PERCH_ACTION_MS, peersAt, stableSpots, tenantClassName, worldSpotIds } from '../lib/tenant-view.ts';

test('every gesture and perch action has a positive duration for its class to hold', () => {
  for (const [action, ms] of Object.entries(GESTURE_MS)) assert.ok(Number.isInteger(ms) && ms > 0, action);
  for (const [action, ms] of Object.entries(PERCH_ACTION_MS)) assert.ok(Number.isInteger(ms) && ms > 0, action);
  // The blink is the quickest thing the face does and the doze the slowest.
  assert.equal(Math.min(...Object.values(GESTURE_MS)), GESTURE_MS.blink);
  assert.equal(Math.max(...Object.values(GESTURE_MS)), GESTURE_MS.doze);
});

const perch = { x: 0, y: 0, kind: 'flat', slide: 1 };
const state = (overrides = {}) => ({
  mood: 'awake', pose: 'rest', perch, onTop: false, gesture: null, perchAction: null,
  sitting: false, worldTarget: null, innerHandoff: false, nextDigit: 3, watch: 0, ...overrides,
});
const classes = overrides => tenantClassName(state(overrides)).split(' ');

test('always carries the base classes, and nothing empty', () => {
  const name = tenantClassName(state());
  assert.equal(name, 'tenant mood-awake pose-rest');
  // A stray double space matches nothing and reads as fine.
  assert.ok(!/\s{2}/.test(name));
});

test('names the perch kind only while standing on one', () => {
  assert.ok(!classes({ onTop: false }).includes('on-flat'));
  assert.ok(classes({ onTop: true }).includes('on-flat'));
  assert.ok(classes({ onTop: true, perch: { ...perch, kind: 'round' } }).includes('on-round'));
});

test('a glance is aimed across the colon only for the hour digits', () => {
  const glance = { action: 'glance-digits' };
  // 0 and 1 are the hour: further away, so the eyes have to travel.
  assert.ok(classes({ gesture: glance, nextDigit: 0 }).includes('g-far'));
  assert.ok(classes({ gesture: glance, nextDigit: 1 }).includes('g-far'));
  assert.ok(!classes({ gesture: glance, nextDigit: 2 }).includes('g-far'));
  assert.ok(!classes({ gesture: glance, nextDigit: 3 }).includes('g-far'));
  // g-far belongs to that one gesture, not to the hour.
  assert.ok(!classes({ gesture: { action: 'wave' }, nextDigit: 0 }).includes('g-far'));
});

test('sitting needs the perched pose, not merely the flag', () => {
  assert.ok(classes({ sitting: true, pose: 'perched' }).includes('sitting'));
  assert.ok(!classes({ sitting: true, pose: 'rest' }).includes('sitting'));
  assert.ok(!classes({ sitting: false, pose: 'perched' }).includes('sitting'));
});

test('watching has a side, and zero is not a side', () => {
  assert.ok(classes({ watch: 1 }).includes('w-right'));
  assert.ok(classes({ watch: -1 }).includes('w-left'));
  const still = classes({ watch: 0 });
  assert.ok(!still.includes('w-right') && !still.includes('w-left'));
});

test('a visit and a perch action are named by what they are', () => {
  assert.ok(classes({ worldTarget: { id: 'map' } }).includes('visit-map'));
  assert.ok(classes({ perchAction: { action: 'teeter' } }).includes('pa-teeter'));
  assert.ok(classes({ innerHandoff: true }).includes('inner-handoff'));
});

test('pictures are peered at; text is read head-on', () => {
  assert.equal(peersAt('weather'), true);
  assert.equal(peersAt('map'), true);
  assert.equal(peersAt('transport'), false);
  assert.equal(peersAt('fact'), false);
  assert.equal(peersAt('week'), false);
});

test('only spots that outlive a rotation are stable', () => {
  // These keys are minted in components/clock.tsx. If they are renamed there
  // and not here, the Tenant quietly stops roaming and nothing else notices.
  const safe = [
    { key: 'weather-left' }, { key: 'ribbon-left' }, { key: 'week-3' },
    { key: 'destination-weather' }, { key: 'destination-week' },
    { key: 'transport-0-left' }, { key: 'fact-illustration' }, { key: 'map-frame' },
  ];
  assert.deepEqual(stableSpots(safe).map(spot => spot.key), [
    'weather-left', 'ribbon-left', 'week-3', 'destination-weather', 'destination-week',
  ]);
  // The rotating panel changes under it every thirty seconds.
  assert.equal(stableSpots(safe).some(spot => spot.key.startsWith('transport-')), false);
  assert.deepEqual(stableSpots([]), []);
});

test('world spots reduce to their ids', () => {
  assert.deepEqual(worldSpotIds([{ id: 'map' }, { id: 'weather' }]), ['map', 'weather']);
});
