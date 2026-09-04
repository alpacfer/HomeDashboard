import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DOTS_SPOT, inkBox, inkColumns, landingSpotTarget, msToNextMinute, nextChangingDigit, perchDuration, perchIdleDelay,
  pickDescent, pickHourAction, pickIdle, pickPerch, pickPerchAction, pickStrike, shouldApproach, tenantMood, tenantTargets, topProfile,
  tenantHopArc, tenantTravelRoute, worldSpotTarget,
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

const tally = (pick, n = 1000) => {
  const counts = {};
  for (let i = 0; i < n; i++) { const a = pick(i / n); counts[a] = (counts[a] ?? 0) + 1; }
  return counts;
};

test('idle actions are weighted towards blinking and the timings sit in their bands', () => {
  const counts = tally(pickIdle, 100);
  assert.equal(counts.blink, 28);
  assert.equal(counts['double-blink'], 8);
  assert.equal(counts['glance-digits'], 10);
  assert.equal(counts['look-around'], 8);
  assert.equal(counts.stretch, 5);
  assert.equal(counts.yawn, 3);
  assert.equal(counts.scratch, 5);
  assert.equal(counts.wave, 3);
  assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), 100);
  // Perched, the body stays out of it: no stretch, wiggle, lean or hop.
  const perched = tally(r => pickIdle(r, true));
  for (const body of ['stretch', 'wiggle', 'lean', 'hop', 'scratch', 'sneeze', 'wave', 'doze']) assert.equal(perched[body], undefined, body);
  assert.ok(perched.blink > perched.smile);
  assert.equal(perchDuration(0), 6000);
  assert.ok(perchDuration(0.999) < 14000);
  assert.equal(perchDuration(0, 'ball'), 3500, 'the colon is hard work, so shorter');
  assert.ok(perchDuration(0.999, 'ball') < 6500);
  assert.equal(perchIdleDelay(0), 2200);
  assert.ok(perchIdleDelay(0.999) < 4500);
});

test('what it does up there depends on the shape under its feet', () => {
  const flat = tally(r => pickPerchAction('flat', r));
  assert.ok(flat.pace > 400 && flat.sit > 200 && flat.peer > 250, JSON.stringify(flat));
  assert.equal(flat.teeter, undefined, 'a bar does not wobble');
  const ledge = tally(r => pickPerchAction('ledge', r));
  assert.ok(ledge.teeter > 500 && ledge.peer > 400);
  assert.equal(ledge.pace, undefined, 'no room to pace on a stem');
  const round = tally(r => pickPerchAction('round', r));
  assert.ok(round.slip > 350 && round.peer > 350 && round.teeter > 150);
  const ball = tally(r => pickPerchAction('ball', r));
  assert.ok(ball.teeter > 650 && ball.slip > 250);
  assert.equal(ball.sit, undefined);
});

test('descents: only arches and the colon are slid off; digits are climbed or hopped', () => {
  const round = tally(r => pickDescent('round', r));
  assert.ok(round.slide > 400 && round['hop-off'] > 250 && round['climb-down'] > 200, JSON.stringify(round));
  for (const kind of ['flat', 'ledge']) {
    const counts = tally(r => pickDescent(kind, r));
    assert.equal(counts.slide, undefined, kind);
    assert.ok(counts['climb-down'] > 500 && counts['hop-off'] > 400, kind);
  }
  const strikes = tally(pickStrike);
  assert.ok(strikes.shove > strikes.kick && strikes.kick > 200 && strikes.headbutt > 150);
  const hours = tally(pickHourAction);
  assert.ok(hours.jump > 550 && hours.hops > 350);
});

test('the next perch is usually a digit, sometimes the colon, never out of range', () => {
  const spots = tally(pickPerch);
  assert.deepEqual(Object.keys(spots).map(Number).sort(), [0, 1, 2, 3, DOTS_SPOT]);
  assert.ok(spots[3] > spots[0], 'the minutes, nearest, are favoured');
  assert.ok(spots[DOTS_SPOT] > 100 && spots[DOTS_SPOT] < spots[3]);
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

// A bitmap with the given per-column tops (null for an empty column), drawn
// as opaque columns from the top down to the bottom row.
const bitmap = (tops, height, pad = 2) => {
  const width = tops.length + 2 * pad;
  const rgba = new Uint8ClampedArray(width * (height + 2 * pad) * 4);
  tops.forEach((top, i) => {
    if (top === null) return;
    for (let y = top; y < height; y++) rgba[((y + pad) * width + i + pad) * 4 + 3] = 255;
  });
  return { rgba, width, height: height + 2 * pad };
};

test('ink columns come out of a bitmap with the empty margin and inner gaps handled', () => {
  const { rgba, width, height } = bitmap([3, 0, 0, null, 2], 10);
  assert.deepEqual(inkColumns(rgba, width, height), { left: 2, right: 6, top: 2, bottom: 11, tops: [3, 0, 0, null, 2] });
  assert.equal(inkColumns(new Uint8ClampedArray(4 * 16), 4, 4), null, 'nothing drawn');
});

// Column tops of Space Grotesk Bold digits at 96 px, as the browser reads them.
// The Tenant is .42em wide, so 40 px here.
const GROTESK = {
  0: [19,15,13,11,10,8,7,6,5,5,4,3,3,3,2,2,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,3,3,4,5,5,6,7,8,9,11,12,15,18],
  1: [29,27,25,23,21,18,16,14,12,10,7,5,3,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  3: [45,45,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,40,45],
  4: [40,38,36,35,33,31,29,28,26,24,23,21,19,18,16,14,12,11,9,7,6,4,2,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,43,43,43,43,43,43,43,43,43,43,43],
  6: [17,14,12,10,9,8,7,6,5,4,4,3,3,2,2,2,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,4,4,5,6,6,8,9,10,12,15,46],
  7: Array(49).fill(0),
  8: [44,13,11,9,8,7,6,5,4,4,3,3,2,2,2,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,3,4,4,5,5,6,7,8,10,11,14,46],
};
const profileOf = (digit, height = 69) => topProfile({ left: 0, right: GROTESK[digit].length - 1, top: 0, bottom: height - 1, tops: GROTESK[digit] }, 40);

test('the top of a glyph reads as a bar, a stem or an arch', () => {
  assert.equal(profileOf(7).kind, 'flat');
  assert.equal(profileOf(7).plateau, 1);
  assert.equal(profileOf(7).apex, 0.5);
  assert.equal(profileOf(3).kind, 'flat', 'the serifs on a 3 do not matter');
  assert.equal(profileOf(1).kind, 'ledge', 'the stem of a 1 is narrower than the Tenant');
  assert.ok(profileOf(1).apex > 0.6, 'and it stands on the stem, right of the flag: ' + profileOf(1).apex);
  assert.equal(profileOf(1).slide, -1);
  assert.equal(profileOf(4).kind, 'ledge');
  assert.ok(profileOf(4).apex > 0.55 && profileOf(4).apex < 0.65, 'on the stem of the 4: ' + profileOf(4).apex);
  for (const digit of [0, 6, 8]) {
    const profile = profileOf(digit, 70);
    assert.equal(profile.kind, 'round', String(digit));
    assert.ok(profile.plateau > 0.4 && profile.plateau < 0.55, digit + ' plateau ' + profile.plateau);
    assert.ok(Math.abs(profile.apex - 0.5) < 0.03, digit + ' apex ' + profile.apex);
    assert.equal(profile.slide, 1, 'a symmetric arch slides towards home');
  }
  // A top that falls away to one side slides downhill, that way.
  const slope = Array(30).fill(0).map((_, i) => i + 1);
  const rightward = topProfile({ left: 0, right: 39, top: 0, bottom: 59, tops: [...Array(10).fill(0), ...slope] }, 40);
  assert.equal(rightward.kind, 'round');
  assert.equal(rightward.slide, 1);
  const leftward = topProfile({ left: 0, right: 39, top: 0, bottom: 59, tops: [...slope.slice().reverse(), ...Array(10).fill(0)] }, 40);
  assert.equal(leftward.slide, -1);
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
  assert.equal(targets.perch.length, 4, 'no colon measured, no fifth spot');
  assert.deepEqual(targets.world, []);
  assert.deepEqual(targets.safe, []);
  assert.deepEqual(targets.perch[3], { x: 270 - 343, y: 20 - 100, kind: 'flat', pace: 0, slide: 1 }, 'without a profile, centred and flat');
  assert.deepEqual(targets.perch[2].y, 30 - 100, 'a shorter glyph gives a lower perch');
});

test('world and safe targets put the feet on a measured UI edge', () => {
  const origin = { left: 50, top: 30, right: 450, bottom: 300 };
  const rest = { left: 300, top: 40 };
  const surface = { left: 600, top: 200, right: 900, bottom: 500 };
  assert.deepEqual(worldSpotTarget('map', surface, origin, rest, 50, 0.75), {
    id: 'map', x: 437.5, y: 80, look: -1,
  });
  assert.equal(worldSpotTarget('transport', surface, origin, rest, 50, 0, 'bottom').y, 380);
  assert.deepEqual(landingSpotTarget('edge', surface, origin, rest, 50, 0.25, 'bottom'), {
    key: 'edge', x: 312.5, y: 380,
  });
});

test('a travel hop charges into a parabola and lands exactly on its safe spot', () => {
  const from = { x: 10, y: 80 };
  const to = { x: 210, y: 20 };
  const arc = tenantHopArc(from, to, 50);
  assert.ok(arc.duration >= 620 && arc.duration <= 980);
  assert.equal(arc.quarter.x, 60);
  assert.equal(arc.apex.x, 110);
  assert.equal(arc.threeQuarter.x, 160);
  const straightApex = (from.y + to.y) / 2;
  assert.ok(arc.apex.y < straightApex - 35, 'the apex rises well above a straight path');
  assert.ok(arc.quarter.y < from.y + (to.y - from.y) * 0.25, 'the first quarter has left the ground line');
  assert.ok(arc.threeQuarter.y < from.y + (to.y - from.y) * 0.75, 'the last quarter is still airborne');
});

test('long travel is chained through measured safe spots, while a close target is one jump', () => {
  const from = { x: 0, y: 0 };
  const to = { x: 600, y: 0 };
  const safe = [
    { key: 'one', x: 180, y: 0 },
    { key: 'two', x: 360, y: 0 },
    { key: 'three', x: 500, y: 0 },
  ];
  assert.deepEqual(tenantTravelRoute(from, to, safe, 50), [safe[0], safe[1], safe[2], to]);
  assert.deepEqual(tenantTravelRoute(from, { x: 100, y: 20 }, safe, 50), [{ x: 100, y: 20 }]);
});

test('a gap in the safe-spot graph still uses a real landing pad instead of a direct glide', () => {
  const middle = { key: 'middle', x: 260, y: 80 };
  assert.deepEqual(tenantTravelRoute({ x: 0, y: 0 }, { x: 700, y: 0 }, [middle], 40), [middle, { x: 700, y: 0 }]);
});

test('with profiles the perch is the apex, pacing room comes from the plateau, and the colon is a ball', () => {
  const ink = [
    { left: 10, top: 20, right: 60, bottom: 100 },
    { left: 80, top: 20, right: 130, bottom: 100 },
    { left: 180, top: 30, right: 230, bottom: 100 },
    { left: 250, top: 20, right: 290, bottom: 100 },
  ];
  const lastCell = { left: 240, top: 0, right: 310, bottom: 126 };
  const profiles = [
    { kind: 'flat', apex: 0.5, plateau: 1, slide: 1 },        // a 7: 50 wide, stance 21 -> 14.5 each way
    { kind: 'ledge', apex: 0.68, plateau: 0.6, slide: -1 },   // a 1: stands on the stem
    { kind: 'round', apex: 0.5, plateau: 0.48, slide: 1 },
    null,
  ];
  const dot = { left: 150, top: 45, right: 160, bottom: 55 };
  const targets = tenantTargets(ink, lastCell, 50, 8, profiles, dot);
  assert.deepEqual(targets.perch[0], { x: 35 - 343, y: -80, kind: 'flat', pace: 14.5, slide: 1 });
  assert.deepEqual(targets.perch[1], { x: 80 + 0.68 * 50 - 343, y: -80, kind: 'ledge', pace: 0, slide: -1 });
  assert.equal(targets.perch[2].kind, 'round');
  assert.equal(targets.perch[2].pace, 0);
  assert.equal(targets.perch[3].kind, 'flat', 'a missing profile falls back to a flat centre');
  assert.equal(targets.perch.length, 5);
  assert.deepEqual(targets.perch[DOTS_SPOT], { x: 155 - 343, y: 45 - 100, kind: 'ball', pace: 0, slide: 1 });
  // A plateau narrower than the stance leaves no room to pace.
  const tight = tenantTargets(ink, lastCell, 50, 8, [{ kind: 'flat', apex: 0.5, plateau: 0.3, slide: 1 }]);
  assert.equal(tight.perch[0].pace, 0);
});
