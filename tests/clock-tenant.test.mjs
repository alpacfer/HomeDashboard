import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  climbDelay, idleDelay, inkBox, msToNextMinute, nextChangingDigit, perchDuration, pickIdle,
  shouldApproach, tenantMood, tenantTargets,
} from '../lib/clock-tenant.ts';

const at = time => new Date('2026-09-03T' + time + 'Z');

test('mood: sleep first, then rain, then temperature', () => {
  assert.equal(tenantMood({ hour: 3, temperature: 30, wet: true }), 'asleep');
  assert.equal(tenantMood({ hour: 23, temperature: 10, wet: false }), 'asleep');
  assert.equal(tenantMood({ hour: 6, temperature: 10, wet: false }), 'awake');
  assert.equal(tenantMood({ hour: 14, temperature: -2, wet: true }), 'rain');
  assert.equal(tenantMood({ hour: 14, temperature: -2, wet: false }), 'cold');
  assert.equal(tenantMood({ hour: 14, temperature: 26, wet: false }), 'hot');
  assert.equal(tenantMood({ hour: 14, temperature: null, wet: false }), 'awake');
});

test('idle actions are weighted towards blinking and the timings sit in their bands', () => {
  const counts = {};
  for (let i = 0; i < 100; i++) { const a = pickIdle(i / 100); counts[a] = (counts[a] ?? 0) + 1; }
  assert.equal(counts.blink, 50);
  assert.equal(counts['double-blink'], 15);
  assert.equal(counts['glance-digits'], 15);
  assert.equal(counts['glance-up'], 10);
  assert.equal(counts.smile, 10);
  assert.equal(idleDelay(0), 3000);
  assert.ok(idleDelay(0.999) < 8000);
  assert.equal(climbDelay(0), 25000);
  assert.ok(climbDelay(0.999) < 45000);
  assert.equal(perchDuration(0), 5000);
});

test('the approach begins on exactly one one-second tick per minute', () => {
  // Whatever phase the parent's tick has, one and only one tick per minute
  // falls in the window.
  for (const phase of [0, 130, 500, 999]) {
    let hits = 0;
    for (let second = 0; second < 60; second++) {
      if (shouldApproach(new Date(Date.UTC(2026, 8, 3, 16, 47, second, phase)))) hits++;
    }
    assert.equal(hits, 1, 'phase ' + phase);
  }
  assert.equal(msToNextMinute(at('16:47:00.000')), 60000);
  assert.equal(msToNextMinute(at('16:47:59.250')), 750);
});

test('the glance aims at the leftmost digit that will change', () => {
  assert.equal(nextChangingDigit(at('16:47:30')), 3, '18:47 to 18:48');
  assert.equal(nextChangingDigit(at('16:49:30')), 2, '18:49 to 18:50');
  assert.equal(nextChangingDigit(at('16:59:30')), 1, '18:59 to 19:00');
  assert.equal(nextChangingDigit(at('21:59:30')), 0, '23:59 to 00:00');
});

test('ink boxes come from the centred glyph and its baseline', () => {
  // A 70 x 126 cell whose glyph advances 60, sits 2 left of its start, and
  // stands 80 above the baseline. Font ascent 100 and descent 26 make a
  // 126-tall content area, centred in a 126 line box: baseline at top + 100.
  const cell = { left: 100, top: 0, right: 170, bottom: 126 };
  const metrics = {
    width: 60, actualBoundingBoxLeft: -2, actualBoundingBoxRight: 58,
    actualBoundingBoxAscent: 80, actualBoundingBoxDescent: 0,
    fontBoundingBoxAscent: 100, fontBoundingBoxDescent: 26,
  };
  assert.deepEqual(inkBox(cell, metrics, 126), { left: 107, right: 163, top: 20, bottom: 100 });
  // A taller line box adds half the extra leading above the content area.
  assert.equal(inkBox(cell, metrics, 146).bottom, 100 - 10 + 10, 'the cell centre moves the baseline with it');
});

test('targets put the Tenant against the last digit and on top of any digit', () => {
  const ink = [
    { left: 10, top: 20, right: 60, bottom: 100 },
    { left: 80, top: 20, right: 130, bottom: 100 },
    { left: 180, top: 30, right: 230, bottom: 100 },
    { left: 250, top: 20, right: 290, bottom: 100 },
  ];
  const lastCell = { left: 240, top: 0, right: 310, bottom: 126 };
  const targets = tenantTargets(ink, lastCell, 50, 8);
  assert.deepEqual(targets.rest, { left: 318, top: 50 }, 'rests right of the last cell with its feet on the baseline');
  // Left edge 318 has to land on 290 plus 14% overlap of 50 = 297.
  assert.equal(targets.pushX, -21);
  assert.equal(targets.perch.length, 4);
  assert.deepEqual(targets.perch[3], { x: 270 - 343, y: 20 - 100 });
  assert.deepEqual(targets.perch[2], { x: 205 - 343, y: 30 - 100 }, 'a shorter glyph gives a lower perch');
});
