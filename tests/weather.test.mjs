import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  describeHour, dmiForecastUrl, isDaylight, parseHours, precipitationBand, solarElevation, validCoverage, WET_MM,
} from '../lib/weather.ts';

// DMI returns accumulated precipitation, so a fixture describes totals since
// the model run started and the parser is expected to difference them.
function coverage({
  times = ['2026-09-02T15:00:00.000Z', '2026-09-02T16:00:00.000Z', '2026-09-02T17:00:00.000Z'],
  temperature = [288.15, 289.15, 290.15],
  cloud = [1, 0.5, 0],
  visibility = [50000, 50000, 50000],
  rain = [0, 0.5, 2],
  snow = [0, 0, 0],
  graupel = [0, 0, 0],
  type = [null, 1, null],
  ranges,
} = {}) {
  return {
    domain: { axes: { t: { values: times } } },
    ranges: ranges ?? {
      'temperature-2m': { values: temperature },
      'fraction-of-cloud-cover': { values: cloud },
      visibility: { values: visibility },
      'rain-precipitation-rate': { values: rain },
      'total-snowfall-rate-water-equivalent': { values: snow },
      'graupel-precipitation-rate': { values: graupel },
      'precipitation-type': { values: type },
    },
  };
}

function hour(overrides = {}) {
  return { timestamp: 0, temperature: 10, cloud: 1, visibility: 50000, rain: 0, snow: 0, graupel: 0, precipitation: 0, precipitationType: null, ...overrides };
}

test('the request asks DMI for every parameter the parser reads', () => {
  const url = new URL(dmiForecastUrl());
  assert.equal(url.origin + url.pathname, 'https://opendataapi.dmi.dk/v1/forecastedr/collections/harmonie_dini_sf/position');
  const requested = (url.searchParams.get('parameter-name') ?? '').split(',');
  for (const name of ['temperature-2m', 'fraction-of-cloud-cover', 'visibility', 'rain-precipitation-rate', 'total-snowfall-rate-water-equivalent', 'graupel-precipitation-rate', 'precipitation-type']) {
    assert.ok(requested.includes(name), name + ' is missing from the request');
  }
  // Longitude comes first in WKT, which is the opposite order to the arguments.
  assert.equal(new URL(dmiForecastUrl(1.5, 2.5)).searchParams.get('coords'), 'POINT(2.5 1.5)');
});

test('accepts a well formed coverage and rejects malformed ones', () => {
  assert.equal(validCoverage(coverage()), true);
  assert.equal(validCoverage(null), false);
  assert.equal(validCoverage({}), false);
  // A single step cannot be differenced into an hourly amount.
  assert.equal(validCoverage(coverage({ times: ['2026-09-02T15:00:00.000Z'], temperature: [288.15], cloud: [1], visibility: [1], rain: [0], snow: [0], graupel: [0], type: [null] })), false);
  assert.equal(validCoverage(coverage({ times: ['nonsense', '2026-09-02T16:00:00.000Z', '2026-09-02T17:00:00.000Z'] })), false);
  assert.equal(validCoverage(coverage({ temperature: [288.15, 289.15] })), false, 'a short range must be rejected');
  assert.equal(validCoverage(coverage({ rain: [0, 'wet', 2] })), false, 'a non-numeric sample must be rejected');
  assert.equal(validCoverage(coverage({ ranges: { 'temperature-2m': { values: [288.15, 289.15, 290.15] } } })), false, 'a missing range must be rejected');
  // precipitation-type is the one optional range: DMI may leave it out entirely.
  const withoutType = coverage();
  delete withoutType.ranges['precipitation-type'];
  assert.equal(validCoverage(withoutType), true);
});

test('differences the accumulated fields into the hour that starts at each step', () => {
  const hours = parseHours(coverage());
  // Three steps produce two hours: the last has no successor to difference.
  assert.equal(hours.length, 2);
  assert.deepEqual(hours.map(entry => entry.rain), [0.5, 1.5]);
  assert.equal(hours[0].timestamp, Date.parse('2026-09-02T15:00:00.000Z'));
  assert.equal(hours[0].temperature, 15);
  assert.equal(hours[1].precipitationType, 1);
});

test('clamps the float dips that flat accumulations produce', () => {
  const [first] = parseHours(coverage({ rain: [0.2842, 0.2832, 0.2842] }));
  assert.equal(first.rain, 0);
  assert.equal(first.precipitation, 0);
});

test('sums rain, snow and graupel into one precipitation figure', () => {
  const [first] = parseHours(coverage({ rain: [0, 0.4, 0.4], snow: [0, 0.2, 0.2], graupel: [0, 0.1, 0.1] }));
  assert.equal(Number(first.precipitation.toFixed(3)), 0.7);
});

test('drops hours whose own samples are missing rather than showing them as dry', () => {
  const four = {
    times: ['2026-09-02T15:00:00.000Z', '2026-09-02T16:00:00.000Z', '2026-09-02T17:00:00.000Z', '2026-09-02T18:00:00.000Z'],
    temperature: [288.15, 289.15, 290.15, 291.15], cloud: [1, 1, 1, 1], visibility: [50000, 50000, 50000, 50000],
    snow: [0, 0, 0, 0], graupel: [0, 0, 0, 0], type: [null, null, null, null],
  };
  assert.deepEqual(parseHours(coverage({ ...four, rain: [0, 0.5, 1.5, 3] })).map(entry => entry.rain), [0.5, 1, 1.5]);
  // A null accumulation removes the hour that needs it as an endpoint, and
  // leaves the hours either side intact.
  assert.deepEqual(parseHours(coverage({ ...four, rain: [0, 0.5, null, 3] })).map(entry => entry.rain), [0.5]);
  assert.deepEqual(parseHours(coverage({ ...four, temperature: [288.15, null, 290.15, 291.15], rain: [0, 0.5, 1.5, 3] })).map(entry => entry.temperature), [15, 17]);
});

test('bands split millimetres per hour into the four steps the display draws', () => {
  assert.equal(precipitationBand(0), 'dry');
  assert.equal(precipitationBand(WET_MM - 0.001), 'dry');
  assert.equal(precipitationBand(WET_MM), 'trace');
  assert.equal(precipitationBand(0.3), 'light');
  assert.equal(precipitationBand(1), 'moderate');
  assert.equal(precipitationBand(4), 'heavy');
});

test('a described hour is wet exactly when its band is not dry', () => {
  // This is the property the old implementation broke: the icon came from one
  // model and the rain figure from another, so 100% could sit beside overcast.
  for (const millimetres of [0, 0.05, WET_MM, 0.5, 3, 12]) {
    const condition = describeHour(hour({ rain: millimetres, precipitation: millimetres }));
    assert.equal(condition.wet, millimetres >= WET_MM, millimetres + ' mm classified inconsistently');
    assert.equal(condition.wet, condition.band !== 'dry');
    assert.equal(['drizzle', 'rain', 'heavy-rain', 'sleet', 'snow', 'hail'].includes(condition.kind), condition.wet);
  }
});

test('classifies the precipitation kind from the same numbers that size the bar', () => {
  assert.equal(describeHour(hour({ rain: 0.2, precipitation: 0.2 })).kind, 'drizzle');
  assert.equal(describeHour(hour({ rain: 0.5, precipitation: 0.5 })).kind, 'rain');
  assert.equal(describeHour(hour({ rain: 6, precipitation: 6 })).kind, 'heavy-rain');
  assert.equal(describeHour(hour({ snow: 1, precipitation: 1 })).kind, 'snow');
  assert.equal(describeHour(hour({ rain: 0.7, snow: 0.3, precipitation: 1 })).kind, 'sleet');
  assert.equal(describeHour(hour({ graupel: 1, precipitation: 1 })).kind, 'hail');
  assert.equal(describeHour(hour({ rain: 1, precipitation: 1, precipitationType: 7 })).kind, 'hail');
  // DMI leaves the type null in hours carrying millimetres of rain, so a null
  // type must never downgrade a wet hour.
  assert.equal(describeHour(hour({ rain: 3.2, precipitation: 3.2, precipitationType: null })).kind, 'rain');
});

test('classifies dry hours by fog first and cloud cover second', () => {
  assert.equal(describeHour(hour({ cloud: 1, visibility: 400 })).kind, 'fog');
  assert.equal(describeHour(hour({ cloud: 0.1 })).kind, 'clear');
  assert.equal(describeHour(hour({ cloud: 0.4 })).kind, 'partly');
  assert.equal(describeHour(hour({ cloud: 0.7 })).kind, 'cloudy');
  assert.equal(describeHour(hour({ cloud: 1 })).kind, 'overcast');
  // Precipitation outranks poor visibility: rain in fog still reads as rain.
  assert.equal(describeHour(hour({ rain: 1, precipitation: 1, visibility: 400 })).kind, 'rain');
});

test('solar elevation puts Copenhagen sunrise and sunset within minutes of the almanac', () => {
  const crossings = dayStart => {
    let sunrise = null;
    let sunset = null;
    for (let minute = 1; minute <= 1440; minute += 1) {
      const at = dayStart + minute * 60000;
      if (!isDaylight(at - 60000) && isDaylight(at)) sunrise = at;
      if (isDaylight(at - 60000) && !isDaylight(at)) sunset = at;
    }
    return { sunrise, sunset };
  };
  const minutesInto = (dayStart, at) => Math.round((at - dayStart) / 60000);
  // Local midnight in Copenhagen, summer time and standard time respectively.
  const summer = Date.UTC(2026, 8, 1, 22, 0, 0);
  const winter = Date.UTC(2026, 11, 20, 23, 0, 0);
  const september = crossings(summer);
  const december = crossings(winter);
  // Almanac: 2026-09-02 sunrise 06:20, sunset 20:07. 2026-12-21 sunrise 08:37, sunset 15:38.
  assert.ok(Math.abs(minutesInto(summer, september.sunrise) - 380) <= 6, 'September sunrise off by more than six minutes');
  assert.ok(Math.abs(minutesInto(summer, september.sunset) - 1207) <= 6, 'September sunset off by more than six minutes');
  assert.ok(Math.abs(minutesInto(winter, december.sunrise) - 517) <= 6, 'December sunrise off by more than six minutes');
  assert.ok(Math.abs(minutesInto(winter, december.sunset) - 938) <= 6, 'December sunset off by more than six minutes');
  assert.ok(solarElevation(Date.UTC(2026, 5, 21, 10, 0, 0)) > 50, 'midsummer noon should be high');
});
