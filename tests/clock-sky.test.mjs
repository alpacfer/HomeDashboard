import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clockSky, parsePinnedSky, skyFall, skyLight, skyWeather, SKY_MOONS } from '../lib/clock-sky.ts';
import { moonPhase, skyArc } from '../lib/sky-arc.ts';
import { FORECAST_LATITUDE, FORECAST_LONGITUDE } from '../lib/weather.ts';

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

test('?sky= pins any of the four in any order, and ignores anything else', () => {
  assert.deepEqual(parsePinnedSky(null), {});
  assert.deepEqual(parsePinnedSky(''), {});
  assert.deepEqual(parsePinnedSky('bogus'), {});
  assert.deepEqual(parsePinnedSky('night'), { light: 'night' });
  assert.deepEqual(parsePinnedSky('NIGHT'), { light: 'night' });
  assert.deepEqual(parsePinnedSky('night,snow,heavy'), { light: 'night', weather: 'snow', fall: 'heavy' });
  assert.deepEqual(parsePinnedSky('heavy, snow ,night'), { light: 'night', weather: 'snow', fall: 'heavy' });
  // "light" is a rate, not a time of day, and must not be read as one.
  assert.deepEqual(parsePinnedSky('light'), { fall: 'light' });
  // And the moon, which is a fraction rather than a name once parsed.
  assert.deepEqual(parsePinnedSky('new'), { lit: 0 });
  assert.deepEqual(parsePinnedSky('full'), { lit: 1 });
  assert.deepEqual(parsePinnedSky('night,gibbous'), { light: 'night', lit: SKY_MOONS.gibbous });
  assert.ok(SKY_MOONS.crescent < 0.5 && SKY_MOONS.gibbous > 0.5,
    'the two named moons either side of half are what the stylesheet branches on');
});

test('a pin overrides the real sky, and only where it says something', () => {
  const winterNight = Date.UTC(2026, 11, 21, 0, 0);
  // The arc is checked separately below; these three are what the stylesheet
  // reads as attributes, and naming them one at a time is what keeps this test
  // about the pin rather than about the shape of the object.
  const named = sky => ({ light: sky.light, weather: sky.weather, fall: sky.fall });
  assert.deepEqual(named(clockSky(winterNight, 'clear', 'dry')), { light: 'night', weather: 'clear', fall: 'none' });
  assert.deepEqual(named(clockSky(winterNight, 'clear', 'dry', parsePinnedSky('day'))),
    { light: 'day', weather: 'clear', fall: 'none' });
  assert.deepEqual(named(clockSky(winterNight, 'clear', 'dry', parsePinnedSky('snow,heavy'))),
    { light: 'night', weather: 'snow', fall: 'heavy' });
});

test('both bodies are reported at every hour, and a pin moves neither', () => {
  const noon = Date.UTC(2026, 5, 21, 10, 0);
  const { sun, moon } = clockSky(noon, 'clear', 'dry');
  assert.ok(sun.cross > 0.4 && sun.cross < 0.6, 'a midsummer midday should be mid-crossing, got ' + sun.cross);
  assert.ok(sun.climb > 0.9, 'and high, got ' + sun.climb);

  // The card draws both discs and lets the traced horizon mask hide whichever
  // one is under the land, so each is simply where that body is. Neither
  // follows the light phase, and that is the whole point: a moon at four in the
  // afternoon is a real moon in a real afternoon sky, so ?sky=night at noon
  // repaints the sky without moving anything standing in it.
  const pinned = clockSky(noon, 'clear', 'dry', parsePinnedSky('night'));
  assert.deepEqual(pinned.sun, sun, 'a pin repaints the sky; it does not move the sun');
  assert.deepEqual(pinned.moon, moon, 'nor the moon');

  // Deep midwinter midnight. Both are still reported, each on its own arc, and
  // the two never collapse onto one another -- which is exactly what the single
  // `arc` this replaced could not express. Where each one actually stands, and
  // that the sun is under the land at this hour, is tests/sky-arc.test.mjs's
  // business and is checked there.
  const midnight = Date.UTC(2026, 11, 21, 0, 0);
  const reported = clockSky(midnight, 'clear', 'dry');
  assert.equal(reported.light, 'night');
  assert.deepEqual(reported.sun, skyArc(midnight, 'sun', FORECAST_LATITUDE, FORECAST_LONGITUDE));
  assert.deepEqual(reported.moon, skyArc(midnight, 'moon', FORECAST_LATITUDE, FORECAST_LONGITUDE));
  assert.notDeepEqual(reported.moon, reported.sun, 'two bodies, two places');

  // The phase rides along with the position, so what the drawn moon is lit like
  // cannot drift from where the drawn moon is.
  assert.deepEqual(reported.phase, moonPhase(midnight, FORECAST_LATITUDE, FORECAST_LONGITUDE));
});

test('a pinned phase changes the shape and nothing else', () => {
  // The real moon takes a fortnight to cross from a crescent to a gibbous, and
  // those are the two sides of the branch app/clock-hillside.css draws, so the
  // pin is the only way either is ever photographed on purpose. It must pin the
  // lit fraction and leave the tilt alone: which way the moon leans is a fact
  // about the hour, not the month, and a pinned crescent has to keep rolling
  // over an evening or the flag would be lying about two things to check one.
  const at = Date.UTC(2026, 8, 25, 21, 0);
  const real = clockSky(at, 'clear', 'dry');
  const pinned = clockSky(at, 'clear', 'dry', parsePinnedSky('crescent'));
  assert.equal(pinned.phase.illuminated, SKY_MOONS.crescent);
  assert.equal(pinned.phase.tilt, real.phase.tilt);
  assert.deepEqual(pinned.moon, real.moon, 'and it does not move the moon either');
});
