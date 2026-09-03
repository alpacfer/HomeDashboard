import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_OUTFIT, DRESS_MS, OUTFITS, OUTFIT_GAP_MS, isHoliday, nextOutfitDelay, outfitById, outfitDate,
  outfitWeights, pickOutfit, wardrobeContext,
} from '../lib/clock-wardrobe.ts';

// 2026-09-03 is a Thursday. 18:47 Copenhagen summer time is 16:47Z.
const thursdayEvening = new Date('2026-09-03T16:47:00Z');

test('every outfit has a unique id and the default exists', () => {
  const ids = OUTFITS.map(outfit => outfit.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes(DEFAULT_OUTFIT));
  assert.equal(outfitById('nonsense').id, OUTFITS[0].id, 'an unknown id falls back to the first outfit');
});

test('context is read in Copenhagen time, not the device zone', () => {
  const context = wardrobeContext(thursdayEvening, { temperature: 18, wet: false });
  assert.equal(context.hour, 18);
  assert.equal(context.weekday, 4);
  assert.equal(context.month, 9);
  assert.equal(context.day, 3);
  // 23:30Z on 31 Dec is already 1 January in Copenhagen.
  const newYear = wardrobeContext(new Date('2026-12-31T23:30:00Z'), null);
  assert.equal(newYear.month, 1);
  assert.equal(newYear.day, 1);
  assert.equal(newYear.hour, 0);
  assert.equal(newYear.temperature, null);
  assert.equal(newYear.wet, false);
});

test('weights follow the table: night is quiet, weekend mornings are editorial, weather adds', () => {
  const base = { month: 9, day: 3, temperature: 18, wet: false };
  const night = outfitWeights({ ...base, hour: 2, weekday: 4 });
  assert.equal(night.terminal, 3);
  assert.equal(night.neon, undefined, 'nothing loud at night');
  assert.equal(night.grotesk, undefined);

  const sundayMorning = outfitWeights({ ...base, hour: 9, weekday: 0 });
  assert.equal(sundayMorning.editorial, 3);
  assert.equal(sundayMorning.fashion, 2);

  const fridayNight = outfitWeights({ ...base, hour: 20, weekday: 5 });
  assert.equal(fridayNight.neon, 3);

  const weekday = outfitWeights({ ...base, hour: 14, weekday: 2 });
  assert.equal(weekday.grotesk, 3, 'the home outfit leads on an ordinary afternoon');

  const rainy = outfitWeights({ ...base, hour: 14, weekday: 2, wet: true });
  assert.equal(rainy.wet, 4);
  assert.equal(rainy.grotesk, 3, 'weather adds to the base rather than replacing it');

  const hot = outfitWeights({ ...base, hour: 14, weekday: 2, temperature: 29 });
  assert.equal(hot.burned, 4);
  const freezing = outfitWeights({ ...base, hour: 14, weekday: 2, temperature: -3 });
  assert.equal(freezing.crt, 1);
  assert.equal(freezing.burned, undefined);
});

test('holidays replace the table outright', () => {
  assert.equal(isHoliday({ month: 10, day: 31 }), 'halloween');
  assert.equal(isHoliday({ month: 12, day: 25 }), 'christmas');
  assert.equal(isHoliday({ month: 12, day: 27 }), null);
  const weights = outfitWeights({ hour: 14, weekday: 2, month: 10, day: 31, temperature: 30, wet: true });
  assert.deepEqual(weights, { halloween: 1 });
});

test('the pick is weighted, never repeats the current outfit, and is deterministic for a given random', () => {
  const context = { hour: 14, weekday: 2, month: 9, day: 3, temperature: 18, wet: false };
  const counts = {};
  for (let i = 0; i < 1000; i++) {
    const id = pickOutfit(context, i / 1000, 'grotesk');
    counts[id] = (counts[id] ?? 0) + 1;
  }
  assert.equal(counts.grotesk, undefined, 'the outfit already worn is excluded');
  assert.equal(Object.keys(counts).length, 5);
  for (const id of ['poster', 'casual', 'doodle', 'stencil', 'editorial']) assert.equal(counts[id], 200, id);
  assert.equal(pickOutfit(context, 0.5, null), pickOutfit(context, 0.5, null));
  // On a holiday the only outfit is allowed to repeat.
  assert.equal(pickOutfit({ ...context, month: 12, day: 24 }, 0.9, 'christmas'), 'christmas');
  // Out-of-range randomness never throws or returns undefined.
  assert.ok(pickOutfit(context, 1, null));
  assert.ok(pickOutfit(context, NaN, null));
});

test('gaps land between 20 and 40 minutes and the dress time is one second', () => {
  assert.equal(nextOutfitDelay(0), OUTFIT_GAP_MS.min);
  assert.ok(nextOutfitDelay(0.999) < OUTFIT_GAP_MS.max);
  assert.ok(nextOutfitDelay(0.999) > OUTFIT_GAP_MS.min);
  assert.equal(DRESS_MS, 1000);
});

test('each date style formats in Copenhagen with its own shape', () => {
  assert.deepEqual(outfitDate('grotesk', thursdayEvening), { label: 'Thursday 3 September', dateTime: '2026-09-03' });
  assert.equal(outfitDate('editorial', thursdayEvening).label, 'Thursday, 3 September');
  assert.equal(outfitDate('terminal', thursdayEvening).label, '2026-09-03 Thu');
  assert.equal(outfitDate('arcade', thursdayEvening).label, 'Thu 03 Sep');
  assert.equal(outfitDate('neon', thursdayEvening).label, 'Thu 3 Sep');
  // Copenhagen midnight crossing, seen from UTC.
  assert.equal(outfitDate('terminal', new Date('2026-08-31T22:00:00Z')).label, '2026-09-01 Tue');
  assert.deepEqual(outfitDate('grotesk', null), { label: '—' });
});
