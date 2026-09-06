import test from 'node:test';
import assert from 'node:assert/strict';
import { bodyElevation, bodyEquatorial, peakElevation, skyArc } from '../lib/sky-arc.ts';
import { FORECAST_LATITUDE, FORECAST_LONGITUDE, solarElevation } from '../lib/weather.ts';

const LAT = FORECAST_LATITUDE;
const LON = FORECAST_LONGITUDE;
const arc = timestamp => skyArc(timestamp, 'sun', LAT, LON);

// Solar noon is found rather than written down. It is not 12:00, it is not the
// same each day, and an almanac figure typed in by hand is a second thing to
// get wrong -- the first draft of this file had December's forty minutes out,
// which failed the test and told the truth about the constant rather than
// about the code.
function solarNoon(year, month, day) {
  let best = null;
  for (let minutes = 0; minutes < 24 * 60; minutes += 1) {
    const at = Date.UTC(year, month, day) + minutes * 60000;
    const elevation = solarElevation(at);
    if (!best || elevation > best.elevation) best = { at, elevation };
  }
  return best.at;
}
const MIDSUMMER_NOON = solarNoon(2026, 5, 21);
const MIDWINTER_NOON = solarNoon(2026, 11, 21);

test('the sun formulae are the same ones lib/weather.ts publishes', () => {
  for (const hour of [0, 6, 11, 17, 23]) {
    const at = Date.UTC(2026, 3, 12, hour, 0, 0);
    assert.equal(bodyElevation('sun', at, LAT, LON), solarElevation(at),
      'solarElevation must be the delegating front door, not a second copy');
  }
});

test('the sun stands where it should at the solstices', () => {
  // Midsummer noon is the highest the sun ever gets here, which is what climb
  // is measured against, so it reads 1. Midwinter noon is the lowest, and has
  // to read low rather than being renormalised back to the top of the card.
  const summer = arc(MIDSUMMER_NOON);
  assert.ok(Math.abs(summer.cross - 0.5) < 0.02, 'solar noon is the middle of the crossing, got ' + summer.cross);
  assert.ok(summer.climb > 0.99, 'midsummer noon should reach the top of the arc, got ' + summer.climb);

  const winter = arc(MIDWINTER_NOON);
  assert.ok(Math.abs(winter.cross - 0.5) < 0.02, 'solar noon is the middle of the crossing in December too, got ' + winter.cross);
  assert.ok(winter.climb > 0.14 && winter.climb < 0.25,
    'midwinter noon should skim the ridge, not climb the card, got ' + winter.climb);
});

test('the crossing runs left to right once a day, whatever the season', () => {
  for (const [label, noon] of [['midsummer', MIDSUMMER_NOON], ['midwinter', MIDWINTER_NOON]]) {
    let previous = -1;
    for (let minutes = -11 * 60; minutes <= 11 * 60; minutes += 10) {
      const { cross } = arc(noon + minutes * 60000);
      assert.ok(cross >= previous - 1e-9, label + ' ran backwards at ' + minutes + ' minutes from noon');
      assert.ok(cross >= 0 && cross <= 1, label + ' left the card at ' + minutes + ' minutes from noon');
      previous = cross;
    }
    assert.ok(arc(noon - 11 * 3600000).cross < 0.02, label + ' should start at the left');
    assert.ok(arc(noon + 11 * 3600000).cross > 0.98, label + ' should end at the right');
  }
});

test('the crossing only ever restarts under the land', () => {
  // The hour angle wraps at solar midnight, so cross drops from 1 back to 0
  // once a day. That is the next day beginning and not a fault -- but it would
  // be a visible fault if it happened anywhere the disc could be seen, so what
  // is worth pinning is that every restart is deep under the horizon. A
  // sidereal day is four minutes short of a solar one, which is why the wrap
  // walks slowly through the small hours rather than sitting at one time.
  let restarts = 0;
  let previous = arc(Date.UTC(2026, 0, 1)).cross;
  for (let minute = 1; minute < 60 * 24 * 40; minute += 1) {
    const at = Date.UTC(2026, 0, 1) + minute * 60000;
    const { cross, climb } = arc(at);
    if (cross < previous - 1e-9) {
      restarts += 1;
      assert.ok(climb <= -0.17, 'the crossing restarted at climb ' + climb + ', which is not safely under the land');
    }
    previous = cross;
  }
  assert.ok(restarts >= 39 && restarts <= 41, 'expected one restart a day over forty days, got ' + restarts);
});

test('the disc reaches the horizon exactly when the sun does', () => {
  // climb crosses zero at elevation zero by construction; what matters is that
  // it happens at the sunrise the rest of the display agrees on.
  let crossings = 0;
  for (let minutes = 0; minutes < 24 * 60; minutes += 1) {
    const at = Date.UTC(2026, 2, 20, 0, 0, 0) + minutes * 60000;
    const before = solarElevation(at - 60000) > 0;
    const now = solarElevation(at) > 0;
    if (before === now) continue;
    crossings += 1;
    assert.ok(Math.abs(arc(at).climb) < 0.01, 'climb should be at the horizon when the sun is, got ' + arc(at).climb);
  }
  assert.equal(crossings, 2, 'an equinox day has one sunrise and one sunset');
});

test('a set sun is reported below the land, and stays bounded', () => {
  // Midnight, deep midwinter: about 50 degrees under the horizon. The value has
  // to stop somewhere, because app/horizon.css turns it into a position and an
  // unbounded one would put the disc a card and a half below the picture.
  const midnight = arc(Date.UTC(2026, 11, 21, 23, 50, 0));
  assert.ok(midnight.climb <= -0.17, 'a midnight sun should be well under the horizon, got ' + midnight.climb);
  assert.ok(midnight.climb >= -0.18, 'climb must stop at the floor, got ' + midnight.climb);
  for (let hour = 0; hour < 24 * 40; hour += 1) {
    const { cross, climb } = arc(Date.UTC(2026, 0, 1) + hour * 3600000);
    assert.ok(cross >= 0 && cross <= 1, 'cross left [0,1] at hour ' + hour);
    assert.ok(climb >= -0.18 && climb <= 1, 'climb left its bounds at hour ' + hour);
  }
});

test('the sun sits on the ecliptic where the calendar says it does', () => {
  // Declination is the sun's own position against the stars, with the
  // observer's rotation taken out of it, so these are four figures that can be
  // checked against any almanac. A degree of slack covers both the abridged
  // series and the solstice not falling exactly on the day named.
  const declination = at => bodyEquatorial('sun', at).declination;
  assert.ok(Math.abs(declination(Date.UTC(2026, 5, 21, 12)) - 23.44) < 1, 'June solstice');
  assert.ok(Math.abs(declination(Date.UTC(2026, 11, 21, 12)) + 23.44) < 1, 'December solstice');
  assert.ok(Math.abs(declination(Date.UTC(2026, 2, 20, 12))) < 1, 'March equinox');
  assert.ok(Math.abs(declination(Date.UTC(2026, 8, 22, 12))) < 1, 'September equinox');
});

// The smaller of the two ways round a circle, in degrees. Everything below is
// a claim about an angle coming back to where it was, and every one of them is
// wrong by a whole turn without this.
function apart(a, b) {
  const difference = Math.abs(a - b) % 360;
  return difference > 180 ? 360 - difference : difference;
}

test('the moon keeps its own two months', () => {
  // Two independent periods fall out of the series, and getting either wrong
  // puts the moon somewhere else in the sky. The sidereal month is how long it
  // takes to return to the same right ascension. The synodic month is how long
  // it takes to return to the same place relative to the SUN, and it is two
  // days longer because the sun has moved on in the meantime -- so the second
  // check tests the moon's series against the sun's rather than only against
  // itself.
  const start = Date.UTC(2026, 0, 3, 0, 0, 0);
  const moon = days => bodyEquatorial('moon', start + days * 86400000).rightAscension;
  const fromSun = days => moon(days) - bodyEquatorial('sun', start + days * 86400000).rightAscension;

  assert.ok(apart(moon(27.321661), moon(0)) < 2,
    'a sidereal month should bring the moon back to the same right ascension, out by ' + apart(moon(27.321661), moon(0)).toFixed(2) + ' degrees');
  // And an arbitrary ten days should not: a series that ignored its argument,
  // or ran at the wrong rate, would pass the check above and fail this one.
  assert.ok(apart(moon(10), moon(0)) > 100,
    'the moon should be a long way from home after ten days, only ' + apart(moon(10), moon(0)).toFixed(2) + ' degrees on');

  assert.ok(apart(fromSun(29.530589), fromSun(0)) < 4,
    'a synodic month should return the moon to the same angle from the sun, out by '
      + apart(fromSun(29.530589), fromSun(0)).toFixed(2) + ' degrees');
});

test('the moon is placed on the same arc as the sun', () => {
  // Whatever the moon is doing, it has to be somewhere on the card, and it has
  // to be allowed higher than the sun ever gets: its orbit is tilted about five
  // degrees further, which is worth five degrees of card at this latitude.
  assert.ok(peakElevation('moon', LAT) > peakElevation('sun', LAT));
  let up = 0;
  for (let hour = 0; hour < 24 * 30; hour += 1) {
    const at = Date.UTC(2026, 4, 1) + hour * 3600000;
    const { cross, climb } = skyArc(at, 'moon', LAT, LON);
    assert.ok(cross >= 0 && cross <= 1, 'the moon left the card at hour ' + hour);
    assert.ok(climb >= -0.18 && climb <= 1, 'the moon left its bounds at hour ' + hour);
    if (climb > 0) up += 1;
  }
  // Over a month the moon is above the horizon for roughly half the hours. The
  // point of the check is that it is sometimes up and sometimes not, which is
  // what a card with a moon on some nights and none on others needs.
  assert.ok(up > 24 * 30 * 0.35 && up < 24 * 30 * 0.65, 'the moon should be up about half the time, got ' + up);
});

test('the poles do not divide by zero', () => {
  // Not a place this display is ever shown, and exactly the input that turns
  // acos into NaN and puts the disc nowhere at all.
  for (const latitude of [89.9, -89.9, 66.6, 0]) {
    for (const month of [0, 5]) {
      const { cross, climb } = skyArc(Date.UTC(2026, month, 15, 12, 0, 0), 'sun', latitude, 0);
      assert.ok(Number.isFinite(cross) && cross >= 0 && cross <= 1, 'cross was ' + cross + ' at ' + latitude);
      assert.ok(Number.isFinite(climb) && climb >= -0.18 && climb <= 1, 'climb was ' + climb + ' at ' + latitude);
    }
  }
});
