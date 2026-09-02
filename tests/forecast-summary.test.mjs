import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRibbon, copenhagenHour, rainHeadline, RIBBON_HOURS, temperatureTrack } from '../lib/forecast-summary.ts';
import { RIBBON_CEILING_MM } from '../lib/weather.ts';

// 2026-09-02T04:00Z is 06:00 in Copenhagen summer time.
const START = Date.UTC(2026, 8, 2, 4, 0, 0);

function hours(count = 30, shape = () => ({})) {
  return Array.from({ length: count }, (_, index) => ({
    timestamp: START + index * 3600000,
    temperature: 15 + index * 0.5,
    cloud: 1, visibility: 50000,
    rain: 0, snow: 0, graupel: 0, precipitation: 0, precipitationType: null,
    ...shape(index),
  }));
}

function wet(indices, millimetres = 1, field = 'rain') {
  return index => indices.includes(index) ? { [field]: millimetres, precipitation: millimetres } : {};
}

test('the window is a fixed count of hours starting at the current hour', () => {
  // The old 06:00-18:00 clock window shrank from seven rows to one over a day.
  // A rolling window has the same length at every hour of the day.
  for (const offset of [0, 3, 9, 12, 17, 23]) {
    const at = new Date(START + offset * 3600000 + 37 * 60000);
    const ribbon = buildRibbon(hours(48), at);
    assert.equal(ribbon.length, RIBBON_HOURS, 'length changed at offset ' + offset);
    assert.equal(ribbon[0].timestamp, START + offset * 3600000, 'first bar is not the current hour at offset ' + offset);
  }
});

test('refuses to render a partial window as if it were complete', () => {
  assert.deepEqual(buildRibbon(hours(RIBBON_HOURS - 1), new Date(START)), []);
  // A hole in the series would silently compress the time axis.
  const gapped = hours(30).filter((_, index) => index !== 5);
  assert.deepEqual(buildRibbon(gapped, new Date(START)), []);
  // A run that ended before now has nothing to show.
  assert.deepEqual(buildRibbon(hours(30), new Date(START + 40 * 3600000)), []);
});

test('labels every third hour and marks midnight', () => {
  const ribbon = buildRibbon(hours(48), new Date(START));
  assert.deepEqual(ribbon.map(entry => entry.hour), [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);
  assert.deepEqual(ribbon.filter(entry => entry.label).map(entry => entry.label), ['06', '09', '12', '15', '18', '21']);
  assert.equal(ribbon.some(entry => entry.midnight), false);
  const overnight = buildRibbon(hours(48), new Date(START + 12 * 3600000));
  const midnight = overnight.filter(entry => entry.midnight);
  assert.equal(midnight.length, 1);
  assert.equal(copenhagenHour(midnight[0].timestamp), 0);
});

test('bar heights are clamped to a fixed ceiling so they mean the same thing every day', () => {
  const ribbon = buildRibbon(hours(30, index => {
    const millimetres = [0, 0.2, 1, RIBBON_CEILING_MM, RIBBON_CEILING_MM * 3][index] ?? 0;
    return { rain: millimetres, precipitation: millimetres };
  }), new Date(START));
  assert.deepEqual(ribbon.slice(0, 5).map(entry => entry.height), [0, 0.05, 0.25, 1, 1]);
  assert.deepEqual(ribbon.slice(0, 5).map(entry => entry.band), ['dry', 'trace', 'moderate', 'heavy', 'heavy']);
});

test('the temperature track spans the bars and reports its own extremes', () => {
  const ribbon = buildRibbon(hours(30), new Date(START));
  const track = temperatureTrack(ribbon);
  assert.equal(track.points.split(' ').length, RIBBON_HOURS);
  assert.equal(track.low, ribbon[0].temperature);
  assert.equal(track.high, ribbon[ribbon.length - 1].temperature);
  // First and last points sit at the centres of the first and last bars.
  const [firstX] = track.points.split(' ')[0].split(',');
  assert.equal(Number(firstX).toFixed(2), (0.5 / RIBBON_HOURS * 100).toFixed(2));
  assert.equal(temperatureTrack([]), null);
  // A flat series must not divide by a zero range.
  const flat = temperatureTrack(buildRibbon(hours(30, () => ({ temperature: 12 })), new Date(START)));
  assert.ok(flat.points.split(' ').every(point => point.endsWith(',50.00')));
});

test('a dry window says how long it stays dry, in words rather than a clock time', () => {
  // A window with no wet hour says "through", not "until": nothing is coming
  // that the window can see, so "until" would promise rain that is not there.
  const ribbon = buildRibbon(hours(30), new Date(START));
  assert.deepEqual(rainHeadline(ribbon, new Date(START)), { text: 'Dry through this evening', wet: false });
  const afternoon = new Date(START + 8 * 3600000);
  assert.deepEqual(rainHeadline(buildRibbon(hours(48), afternoon), afternoon), { text: 'Dry through tomorrow morning', wet: false });
  // A window ending in the small hours is "tonight" whichever calendar date
  // those hours fall on.
  const midday = new Date(START + 6 * 3600000);
  assert.deepEqual(rainHeadline(buildRibbon(hours(48), midday), midday), { text: 'Dry through tonight', wet: false });
});

test('a dry start names the hour the rain arrives', () => {
  const ribbon = buildRibbon(hours(30, wet([4, 5, 6])), new Date(START));
  assert.deepEqual(rainHeadline(ribbon, new Date(START)), { text: 'Dry until 10:00, then rain', wet: false });
  const snow = buildRibbon(hours(30, wet([4, 5], 1, 'snow')), new Date(START));
  assert.deepEqual(rainHeadline(snow, new Date(START)), { text: 'Dry until 10:00, then snow', wet: false });
});

test('a wet start names the hour it stops', () => {
  const ribbon = buildRibbon(hours(30, wet([0, 1, 2])), new Date(START));
  assert.deepEqual(rainHeadline(ribbon, new Date(START)), { text: 'Rain until 09:00', wet: true });
  const drizzle = buildRibbon(hours(30, wet([0], 0.15)), new Date(START));
  assert.deepEqual(rainHeadline(drizzle, new Date(START)), { text: 'Drizzle until 07:00', wet: true });
});

test('rain that outlasts the window gets a day-part phrase instead of a false end time', () => {
  const ribbon = buildRibbon(hours(30, () => ({ rain: 0.5, precipitation: 0.5 })), new Date(START));
  assert.deepEqual(rainHeadline(ribbon, new Date(START)), { text: 'Rain into this evening', wet: true });
});

test('names the heaviest hour only for a long run with a real peak', () => {
  const long = buildRibbon(hours(30, index => {
    const millimetres = [1, 1, 6, 1][index] ?? 0;
    return { rain: millimetres, precipitation: millimetres };
  }), new Date(START));
  assert.deepEqual(rainHeadline(long, new Date(START)), { text: 'Heavy rain until 10:00, heaviest 08:00', wet: true });
  // A short shower, or one that peaks in its first hour, stays terse.
  const short = buildRibbon(hours(30, wet([0, 1], 6)), new Date(START));
  assert.deepEqual(rainHeadline(short, new Date(START)), { text: 'Heavy rain until 08:00', wet: true });
});

test('an empty ribbon has no headline to state', () => {
  assert.equal(rainHeadline([], new Date(START)), null);
});
