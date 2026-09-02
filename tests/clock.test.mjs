import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clockDate, clockFrame, changedDigits } from '../lib/clock-motion.ts';

const at = time => new Date('2026-08-31T' + time + 'Z');
test('first load has four stable digit slots and no outgoing digits', () => {
  const loading = clockFrame(null);
  assert.equal(changedDigits(loading).length, 4);
  const loaded = clockFrame(at('10:09:00'), loading);
  assert.equal(loaded.text, '12:09');
  assert.ok(changedDigits(loaded).every(digit => digit.previous === null));
});
test('only changed digits roll on minute and hour boundaries', () => {
  const simple = clockFrame(at('10:08:00'), clockFrame(at('10:07:00')));
  assert.deepEqual(changedDigits(simple).map(d => d.previous), [null, null, null, '7']);
  const carry = clockFrame(at('10:10:00'), clockFrame(at('10:09:00')));
  assert.deepEqual(changedDigits(carry).map(d => d.previous), [null, null, '0', '9']);
  const midnight = clockFrame(new Date('2026-08-31T22:00:00Z'), clockFrame(at('21:59:00')));
  assert.equal(midnight.text, '00:00');
  assert.deepEqual(changedDigits(midnight).map(d => d.previous), ['2', '3', '5', '9']);
});
test('seconds do not restart animations and resuming does not replay missed minutes', () => {
  const frame = clockFrame(at('10:08:00'), clockFrame(at('10:07:00')));
  assert.equal(clockFrame(at('10:08:30'), frame), frame);
  assert.equal(clockFrame(at('11:08:00'), frame).previous, null);
  assert.equal(clockFrame(at('10:06:00'), frame).previous, null);
});
test('date follows Copenhagen and includes the numeric day and month', () => {
  assert.deepEqual(clockDate(new Date('2026-08-31T22:00:00Z')), { label: '1 September', dateTime: '2026-09-01' });
  assert.deepEqual(clockDate(null), { label: '—' });
});
