import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EVENT_GAP_MS, QUIET_MARGIN_MS, SET_PIECES, delayToQuiet, eligibleSetPieces, fitsQuietWindow, flapSequence,
  nextEventDelay, pickSetPiece, setPieceById,
} from '../lib/clock-events.ts';

const atSecond = seconds => new Date(Date.UTC(2026, 8, 3, 16, 47, 0) + seconds * 1000);

test('every piece has an id, a positive duration and lands inside a minute', () => {
  for (const piece of SET_PIECES) {
    assert.ok(piece.duration > 0 && piece.duration + 2 * QUIET_MARGIN_MS < 60000, piece.id);
  }
  assert.equal(setPieceById('domino').duration, 2600);
  assert.equal(setPieceById('missing').id, SET_PIECES[0].id);
});

test('hour pieces only run at the hour, morph pieces only on a variable outfit', () => {
  const everyday = eligibleSetPieces(false, false).map(piece => piece.id);
  assert.ok(!everyday.includes('quake') && !everyday.includes('flap'), 'hour pieces stay out of the everyday pool');
  assert.ok(!everyday.includes('morph'), 'a static face cannot morph');
  assert.ok(eligibleSetPieces(true, false).map(piece => piece.id).includes('morph'));
  assert.deepEqual(eligibleSetPieces(true, true).map(piece => piece.id), ['quake', 'flap']);
});

test('the pick never repeats the last piece unless nothing else is eligible', () => {
  const seen = new Set();
  for (let i = 0; i < 100; i++) seen.add(pickSetPiece(true, false, i / 100, 'domino').id);
  assert.ok(!seen.has('domino'));
  assert.equal(seen.size, 5);
  assert.equal(pickSetPiece(false, true, 0.9, 'flap').id, 'quake');
  assert.equal(pickSetPiece(false, true, 0.9, 'quake').id, 'flap');
  assert.ok(pickSetPiece(true, false, 1, null), 'random of exactly 1 still picks');
});

test('quiet windows keep clear of the minute roll on both sides', () => {
  assert.equal(fitsQuietWindow(atSecond(0.5), 2600), false, 'too soon after the roll');
  assert.equal(fitsQuietWindow(atSecond(2), 2600), true);
  assert.equal(fitsQuietWindow(atSecond(55), 2600), true, 'ends at 57.6 s, margin holds');
  assert.equal(fitsQuietWindow(atSecond(56), 2600), false, 'would end 1.4 s before the roll');
  assert.equal(delayToQuiet(atSecond(2), 2600), 0);
  assert.equal(delayToQuiet(atSecond(0.5), 2600), 1500, 'wait for the leading margin');
  assert.equal(delayToQuiet(atSecond(58), 2600), 4000, 'wait past the roll and its margin');
});

test('the flap sequence counts through three wrong digits and lands on the real time', () => {
  assert.deepEqual(flapSequence('18:47'), ['2958', '3069', '4170', '1847']);
  assert.deepEqual(flapSequence('––:––', 1), ['––––', '––––'], 'placeholders pass through untouched');
});

test('event gaps land between five and fifteen minutes', () => {
  assert.equal(nextEventDelay(0), EVENT_GAP_MS.min);
  assert.ok(nextEventDelay(0.999) < EVENT_GAP_MS.max);
  assert.ok(nextEventDelay(NaN) >= EVENT_GAP_MS.min);
});
