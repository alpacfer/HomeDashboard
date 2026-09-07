import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MAP_ART_BOUNDS, MAP_ART_PLATES, MAP_LIGHTS_Z, MAP_LIGHT_SHEETS, MAP_SHADOW_SHEETS, MAP_SHADOW_Z,
  MAP_WATER_SHEETS, MAP_WATER_Z,
} from '../lib/forecast-map-art.ts';
import { SKY_LIGHTS } from '../lib/clock-sky.ts';
import { MAP_BOUNDS, coversView } from '../lib/precipitation-grid.ts';

test('the illustrated extent contains the whole forecast area', () => {
  assert.ok(coversView(MAP_ART_BOUNDS, MAP_BOUNDS));
  // All three labels must remain inside the painting with room for a caption.
  for (const [lat, lon] of [[55.73825, 12.53836], [55.6761, 12.5683], [55.9279, 12.3008]]) {
    assert.ok(lat > MAP_ART_BOUNDS.south && lat < MAP_ART_BOUNDS.north);
    assert.ok(lon > MAP_ART_BOUNDS.west && lon < MAP_ART_BOUNDS.east);
  }
});

test('the basemap is a local compressed WebP within the display asset budget', () => {
  assert.deepEqual(Object.keys(MAP_ART_PLATES).sort(), [...SKY_LIGHTS].sort());
  for (const url of Object.values(MAP_ART_PLATES)) {
    const bytes = readFileSync(new URL('../public' + url, import.meta.url));
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
    assert.ok(bytes.length < 600_000, 'Each static plate should stay below 600 KB');
  }
});

test('every living-map sheet is a WebP that actually carries an alpha channel', () => {
  // The shape IS the alpha: there is no runtime mask, so a sheet encoded
  // without one would paint a rectangle of glitter over the whole county.
  for (const url of [...MAP_WATER_SHEETS, ...MAP_LIGHT_SHEETS, ...MAP_SHADOW_SHEETS]) {
    const bytes = readFileSync(new URL('../public' + url, import.meta.url));
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF', url);
    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP', url);
    // Either an extended file carrying an ALPH chunk, or a lossless VP8L,
    // which always has one.
    const head = bytes.toString('ascii', 12, 16);
    const alpha = head === 'VP8L' || bytes.toString('ascii', 0, 200).includes('ALPH');
    assert.ok(alpha, url + ' has no alpha channel');
    assert.ok(bytes.length < 120_000, url + ' is over the 120 KB sheet budget');
  }
});

test('three sheets each, because two cannot dissolve in one direction', () => {
  // Three phases of one travelling pattern, cross-faded in turn, read as
  // movement. Two only read as a pulse, and the CSS delays in app/globals.css
  // are written as thirds of one cycle.
  assert.equal(MAP_WATER_SHEETS.length, 3);
  assert.equal(MAP_LIGHT_SHEETS.length, 3);
  assert.equal(MAP_SHADOW_SHEETS.length, 3);
});

test('the sheets sit above the plate and below the rain', () => {
  // Leaflet gives the plate z-index 1 and leaflet.css computes the
  // precipitation canvas to 100. Anything outside 2..99 either hides under the
  // painting or paints over the forecast.
  const bands = [[MAP_WATER_Z, MAP_WATER_SHEETS], [MAP_LIGHTS_Z, MAP_LIGHT_SHEETS], [MAP_SHADOW_Z, MAP_SHADOW_SHEETS]];
  for (const [base, sheets] of bands) {
    for (const z of [base, base + sheets.length - 1]) {
      assert.ok(z > 1 && z < 100, 'z-index ' + z + ' is outside the overlay pane band');
    }
  }
  for (let index = 1; index < bands.length; index += 1) {
    const [previous, sheets] = bands[index - 1];
    assert.ok(bands[index][0] > previous + sheets.length - 1, 'the sheet kinds must not interleave');
  }
});

test('the cross-fade is two thirds of a cycle wide, and its ramp composites flat', () => {
  // Three hats a third of a cycle wide would TILE the cycle rather than overlap
  // it, and the water would go fully off and back three times a lap. And three
  // sheets do not add, they composite, so a pair at half strength shows less
  // than one at full unless the ramp is 1-(1-a)^u. Both were shipped wrong
  // once, and nothing else in the repository can see a cross-fade: npm run
  // motion samples draw cadence and element position and never reads opacity,
  // and a screenshot cannot see a blink. So this reads the real keyframes, the
  // real delays and the real --sheet-a values out of the stylesheet and
  // simulates the stack.
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  const block = /@keyframes map-sheet\s*\{([\s\S]*?)\n\}/.exec(css);
  assert.ok(block, 'app/globals.css must define @keyframes map-sheet');
  const stops = [...block[1].matchAll(/([\d.]+)%\s*\{\s*opacity:\s*([^;]+);/g)].map(([, at, value]) => {
    const scale = /\*\s*([\d.]+)/.exec(value);
    return { at: Number(at) / 100, share: value.includes('--sheet-a') ? Number(scale?.[1] ?? 1) : 0 };
  });
  assert.ok(stops.length >= 5, 'expected a sampled ramp, not two stops');
  const peak = stops.reduce((best, stop) => (stop.share > best.share ? stop : best), stops[0]);
  const ends = stops.find(stop => stop.at > peak.at && stop.share === 0);
  assert.ok(ends && ends.at > 0.6, 'the hat must be about two thirds of a cycle wide, not one third');

  // Every kind's delays must be the thirds the hat is built for. A hat of the
  // right width with the wrong delays is the same failure by another route.
  const cycles = new Map([...css.matchAll(/\.forecast-map-sheet\.is-([\w-]+)\s*\{[^}]*--sheet-ms:\s*([\d.]+)s/g)]
    .map(([, kind, seconds]) => [kind, Number(seconds)]));
  assert.ok(cycles.size >= 3, 'expected a cycle length per kind of sheet');
  const shifts = new Map();
  for (const [, kind, phase, delay] of css.matchAll(/\.is-([\w-]+)\.phase-(\d)\s*\{\s*animation-delay:\s*(-?[\d.]+)s/g)) {
    shifts.set(kind + phase, Math.abs(Number(delay)) / cycles.get(kind));
  }
  for (const [kind, cycle] of cycles) {
    for (const [phase, want] of [[2, 1 / 3], [3, 2 / 3]]) {
      const got = shifts.get(kind + phase);
      assert.ok(got !== undefined, kind + ' phase ' + phase + ' has no delay');
      assert.ok(Math.abs(got - want) < 0.01,
        kind + ' phase ' + phase + ' is offset ' + got.toFixed(3) + ' of its ' + cycle + 's cycle, not ' + want.toFixed(3));
    }
  }

  const at = (phase, a) => {
    for (let index = 1; index < stops.length; index += 1) {
      if (phase > stops[index].at) continue;
      const before = stops[index - 1], after = stops[index];
      const span = after.at - before.at || 1;
      return a * (before.share + (after.share - before.share) * ((phase - before.at) / span));
    }
    return 0;
  };
  // The strengths the stylesheet actually declares, not a round number.
  const strengths = [...new Set([...css.matchAll(/--sheet-a:\s*([\d.]+)/g)].map(([, value]) => Number(value)))];
  assert.ok(strengths.length >= 4, 'expected several --sheet-a values to check');
  for (const a of strengths) {
    let low = Infinity, high = 0;
    for (let step = 0; step <= 600; step += 1) {
      const time = step / 600;
      let out = 0;
      for (const shift of [0, 1 / 3, 2 / 3]) out += at((time + shift) % 1, a) * (1 - out);
      low = Math.min(low, out);
      high = Math.max(high, out);
    }
    // The absolute swing in composited alpha, because that is what the eye
    // sees: a tenth of a faint shadow is nothing and a tenth of the day's
    // water is a visible breath. The stops are sampled from 1-(1-a)^u at
    // a=0.6, so the fit is exact in the middle of the declared range and
    // loosest at its ends; every declared strength still comes in under 0.08,
    // against 0.13 and 0.18 for a linear ramp at the two strongest.
    assert.ok(high - low < 0.09, 'at --sheet-a ' + a + ' the stack swings ' + (high - low).toFixed(4)
      + ' of composited alpha, ' + ((high - low) / ((high + low) / 2)).toFixed(3) + ' of its mean');
  }
});
