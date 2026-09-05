import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clockSky, parsePinnedSky, skyFall, skyLight, skyWeather } from '../lib/clock-sky.ts';

test('the light comes from the sun, not the hour on the clock', () => {
  // Midsummer noon and midwinter midnight over Copenhagen are not close calls
  // in either direction, at any latitude this display is ever shown at.
  assert.equal(skyLight(Date.UTC(2026, 5, 21, 10, 0)), 'day');
  assert.equal(skyLight(Date.UTC(2026, 11, 21, 0, 0)), 'night');
  // Midwinter *noon* is still day in Copenhagen, barely, and midsummer
  // midnight is still not: the phases have to follow the season, which is the
  // whole reason this is computed rather than read off a table of hours.
  assert.equal(skyLight(Date.UTC(2026, 11, 21, 11, 0)), 'day');
  assert.notEqual(skyLight(Date.UTC(2026, 5, 21, 22, 0)), 'day');
});

test('a whole equinox day passes through the four phases, in order and once each', () => {
  const start = Date.UTC(2026, 2, 20, 0, 0);
  const phases = [];
  for (let minute = 0; minute < 24 * 60; minute += 5) {
    const phase = skyLight(start + minute * 60_000);
    if (phases[phases.length - 1] !== phase) phases.push(phase);
  }
  assert.deepEqual(phases, ['night', 'dawn', 'day', 'dusk', 'night']);
});

test('the ten kinds the card knows collapse to the eight the sky can paint', () => {
  assert.equal(skyWeather('drizzle'), 'rain');
  assert.equal(skyWeather('rain'), 'rain');
  assert.equal(skyWeather('heavy-rain'), 'rain');
  assert.equal(skyWeather('snow'), 'snow');
  assert.equal(skyWeather('sleet'), 'sleet');
  assert.equal(skyWeather('partly'), 'partly');
  assert.equal(skyWeather('fog'), 'fog');
  // No forecast yet is a quiet sky, never a blank one.
  assert.equal(skyWeather(null), 'partly');
});

test('only a sky with something to drop drops anything', () => {
  assert.equal(skyFall('rain', 'moderate'), 'moderate');
  assert.equal(skyFall('heavy-rain', 'heavy'), 'heavy');
  assert.equal(skyFall('drizzle', 'trace'), 'light');
  assert.equal(skyFall('snow', 'light'), 'light');
  assert.equal(skyFall('sleet', 'moderate'), 'moderate');
  // A dry hour, and a band arriving against a kind that cannot rain.
  assert.equal(skyFall('clear', 'dry'), 'none');
  assert.equal(skyFall('cloudy', 'heavy'), 'none');
  assert.equal(skyFall('fog', 'light'), 'none');
  assert.equal(skyFall(null, null), 'none');
  assert.equal(skyFall('rain', null), 'none');
});

test('?sky= pins any of the three in any order, and ignores anything else', () => {
  assert.deepEqual(parsePinnedSky(null), {});
  assert.deepEqual(parsePinnedSky(''), {});
  assert.deepEqual(parsePinnedSky('bogus'), {});
  assert.deepEqual(parsePinnedSky('night'), { light: 'night' });
  assert.deepEqual(parsePinnedSky('NIGHT'), { light: 'night' });
  assert.deepEqual(parsePinnedSky('night,snow,heavy'), { light: 'night', weather: 'snow', fall: 'heavy' });
  assert.deepEqual(parsePinnedSky('heavy, snow ,night'), { light: 'night', weather: 'snow', fall: 'heavy' });
  // "light" is a rate, not a time of day, and must not be read as one.
  assert.deepEqual(parsePinnedSky('light'), { fall: 'light' });
});

test('a pin overrides the real sky, and only where it says something', () => {
  const winterNight = Date.UTC(2026, 11, 21, 0, 0);
  assert.deepEqual(clockSky(winterNight, 'clear', 'dry'), { light: 'night', weather: 'clear', fall: 'none' });
  assert.deepEqual(clockSky(winterNight, 'clear', 'dry', parsePinnedSky('day')),
    { light: 'day', weather: 'clear', fall: 'none' });
  assert.deepEqual(clockSky(winterNight, 'clear', 'dry', parsePinnedSky('snow,heavy')),
    { light: 'night', weather: 'snow', fall: 'heavy' });
});
