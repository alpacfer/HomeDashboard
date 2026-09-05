import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  celsius, GOOGLE_DAYS, GOOGLE_HOURS, googleRoutePath, googleUpstreamUrl, isGoogleKind,
  millimetres, parseGoogleDays, parseGoogleHours,
} from '../lib/google-weather.ts';
import { SOURCES } from '../lib/forecast-sources.ts';
import { DAILY_SOURCES, parseGoogleDaily, WEEK_DAYS } from '../lib/daily-forecast.ts';

// Google reports every measurement beside the name of its unit, so a fixture
// states the units too and the parser is expected to check them rather than
// trust the request. `snowMm: null` leaves snowQpf out of the payload
// altogether, which is how a dry hour actually arrives.
function hour({ start = '2026-09-05T12:00:00Z', degrees = 15, cloudCover = 40, visibilityKm = 12, rainMm = 0, snowMm = null, precipitation } = {}) {
  const amounts = { qpf: { quantity: rainMm, unit: 'MILLIMETERS' } };
  if (snowMm !== null) amounts.snowQpf = { quantity: snowMm, unit: 'MILLIMETERS' };
  return {
    interval: { startTime: start, endTime: '2026-09-05T13:00:00Z' },
    temperature: { degrees, unit: 'CELSIUS' },
    cloudCover,
    ...visibilityKm === null ? {} : { visibility: { distance: visibilityKm, unit: 'KILOMETERS' } },
    precipitation: precipitation ?? { probability: { percent: 10, type: 'RAIN' }, ...amounts },
  };
}

function part({ cloudCover = 50, rainMm = 0, snowMm = null } = {}) {
  const amounts = { qpf: { quantity: rainMm, unit: 'MILLIMETERS' } };
  if (snowMm !== null) amounts.snowQpf = { quantity: snowMm, unit: 'MILLIMETERS' };
  return { cloudCover, precipitation: amounts };
}

function day({ date = { year: 2026, month: 9, day: 6 }, high = 18, low = 9, daytime = part(), nighttime = part() } = {}) {
  return {
    displayDate: date,
    maxTemperature: { degrees: high, unit: 'CELSIUS' },
    minTemperature: { degrees: low, unit: 'CELSIUS' },
    daytimeForecast: daytime,
    nighttimeForecast: nighttime,
  };
}

test('an hour is read into the shape every provider shares', () => {
  const [parsed] = parseGoogleHours({ forecastHours: [hour({ rainMm: 1.4, snowMm: 0.6 })] });
  assert.equal(parsed.timestamp, Date.parse('2026-09-05T12:00:00Z'));
  assert.equal(parsed.temperature, 15);
  // Cloud arrives as a whole percent and is stored as a fraction, and
  // visibility arrives in kilometres against everyone else's metres.
  assert.equal(parsed.cloud, 0.4);
  assert.equal(parsed.visibility, 12000);
  assert.equal(parsed.rain, 1.4);
  assert.equal(parsed.snow, 0.6);
  // qpf is the rain and snowQpf the snow, both as liquid water equivalent, so
  // the hour's total is the two added.
  assert.equal(parsed.precipitation, 2);
});

test('a dry hour leaves snowQpf out, and that is zero snow rather than a broken payload', () => {
  const [parsed] = parseGoogleHours({ forecastHours: [hour({ rainMm: 0 })] });
  assert.equal(parsed.snow, 0);
  assert.equal(parsed.precipitation, 0);
});

test('a measurement in the wrong unit is refused, never read as a number', () => {
  // The request asks for METRIC. If an answer ever came back imperial, 59
  // degrees Fahrenheit read as Celsius would dress the Tenant for a heatwave.
  const fahrenheit = { forecastHours: [hour(), { ...hour(), temperature: { degrees: 59, unit: 'FAHRENHEIT' } }] };
  assert.equal(parseGoogleHours(fahrenheit).length, 1);
  const inches = { forecastHours: [{ ...hour(), precipitation: { qpf: { quantity: 0.2, unit: 'INCHES' } } }] };
  assert.deepEqual(parseGoogleHours(inches), []);
  // Present but in the wrong unit is still a refusal, even for the optional one.
  const snowInches = { forecastHours: [{ ...hour(), precipitation: { qpf: { quantity: 1, unit: 'MILLIMETERS' }, snowQpf: { quantity: 1, unit: 'INCHES' } } }] };
  assert.deepEqual(parseGoogleHours(snowInches), []);
});

test('a missing visibility is no limit, not no data', () => {
  const [parsed] = parseGoogleHours({ forecastHours: [hour({ visibilityKm: null })] });
  assert.equal(parsed.visibility, Infinity);
  assert.equal(parsed.temperature, 15);
});

test('an hour missing a field it needs is dropped, and the rest are kept', () => {
  const payload = {
    forecastHours: [
      hour({ start: '2026-09-05T12:00:00Z' }),
      { ...hour({ start: 'not a time' }) },
      { ...hour(), cloudCover: undefined },
      hour({ start: '2026-09-05T15:00:00Z' }),
    ],
  };
  const parsed = parseGoogleHours(payload);
  assert.equal(parsed.length, 2);
  assert.deepEqual(parsed.map(entry => entry.timestamp), [Date.parse('2026-09-05T12:00:00Z'), Date.parse('2026-09-05T15:00:00Z')]);
});

test('a payload that is not a forecast is rejected outright', () => {
  assert.equal(parseGoogleHours(null), null);
  assert.equal(parseGoogleHours({}), null);
  assert.equal(parseGoogleHours({ forecastHours: [] }), null);
  assert.equal(parseGoogleHours({ error: { code: 403 } }), null);
  assert.equal(parseGoogleDays({ forecastDays: 'tomorrow' }), null);
});

test('the readings refuse anything that is not a finite number in the right unit', () => {
  assert.equal(celsius({ degrees: 12, unit: 'CELSIUS' }), 12);
  assert.equal(celsius({ degrees: '12', unit: 'CELSIUS' }), null);
  assert.equal(celsius(null), null);
  assert.equal(millimetres({ quantity: Infinity, unit: 'MILLIMETERS' }), null);
});

test('the upstream request asks for one page and names its units', () => {
  const url = new URL(googleUpstreamUrl('hours', 55.73825, 12.53836, 'secret-key'));
  assert.equal(url.pathname, '/v1/forecast/hours:lookup');
  assert.equal(url.searchParams.get('key'), 'secret-key');
  assert.equal(url.searchParams.get('unitsSystem'), 'METRIC');
  // pageSize caps at 24 and a page is a billable call, so the window asked for
  // and the page size have to match or the second page costs a second call.
  assert.equal(url.searchParams.get('hours'), String(GOOGLE_HOURS));
  assert.equal(url.searchParams.get('pageSize'), String(GOOGLE_HOURS));
  assert.equal(url.searchParams.get('location.latitude'), '55.73825');

  const days = new URL(googleUpstreamUrl('days', 55.73825, 12.53836, 'secret-key'));
  assert.equal(days.pathname, '/v1/forecast/days:lookup');
  assert.equal(days.searchParams.get('days'), String(GOOGLE_DAYS));
  assert.equal(days.searchParams.get('pageSize'), String(GOOGLE_DAYS));
  // The week needs margin at both ends, not just the seven it draws: see the
  // overnight test below for what the exact fit cost.
  assert.ok(GOOGLE_DAYS >= WEEK_DAYS + 2, 'the week needs a spare day at each end');
});

test('the week survives the hours when Google is still reporting yesterday', () => {
  // Google's day runs 07:00 to 07:00 local, and the first day it returns is
  // the window containing now. Between Copenhagen midnight and 07:00 that
  // window still carries yesterday's date, so two days fall to the today-drop
  // rather than one. With no margin the strip came up a day short every night
  // and quietly fell through to the next provider.
  const overnight = new Date('2026-09-06T01:00:00Z'); // 03:00 in Copenhagen
  const days = Array.from({ length: GOOGLE_DAYS }, (entry, index) => day({ date: { year: 2026, month: 9, day: 5 + index } }));
  const week = parseGoogleDaily({ forecastDays: days }, overnight);
  assert.equal(week.length, WEEK_DAYS);
  assert.equal(week[0].date, '2026-09-07');

  // The same payload cut to the old eight-day window is what used to fail.
  assert.equal(parseGoogleDaily({ forecastDays: days.slice(0, 8) }, overnight), null);
});

test('what the browser asks for carries neither the key nor a location', () => {
  const path = googleRoutePath('hours');
  assert.equal(path, '/api/weather?kind=hours');
  assert.doesNotMatch(path, /key|lat|lon/);
  assert.ok(isGoogleKind('days') && !isGoogleKind('minutes'));
});

test('a day is the two halves added, and its cloud cover their mean', () => {
  const [parsed] = parseGoogleDays({
    forecastDays: [day({
      daytime: part({ cloudCover: 20, rainMm: 1, snowMm: null }),
      nighttime: part({ cloudCover: 80, rainMm: 2, snowMm: 3 }),
    })],
  });
  assert.equal(parsed.date, '2026-09-06');
  assert.equal(parsed.high, 18);
  assert.equal(parsed.low, 9);
  assert.equal(parsed.precipitation, 6);
  assert.equal(parsed.snow, 3);
  assert.equal(parsed.cloud, 0.5);
});

test('a single-digit month and day are padded so dates sort and compare', () => {
  const [parsed] = parseGoogleDays({ forecastDays: [day({ date: { year: 2027, month: 1, day: 3 } })] });
  assert.equal(parsed.date, '2027-01-03');
});

test('a day missing a half is dropped rather than drawn at half its rain', () => {
  const payload = { forecastDays: [day(), { ...day({ date: { year: 2026, month: 9, day: 7 } }), nighttimeForecast: undefined }] };
  const parsed = parseGoogleDays(payload);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].date, '2026-09-06');
});

test('the week drops today and is only shown when every day of it is there', () => {
  // Copenhagen is two hours ahead of UTC in September, so this is midday on
  // the fifth there and the fifth is the day that gets dropped.
  const now = new Date('2026-09-05T10:00:00Z');
  const eight = Array.from({ length: WEEK_DAYS + 1 }, (entry, index) => day({ date: { year: 2026, month: 9, day: 5 + index } }));
  const week = parseGoogleDaily({ forecastDays: eight }, now);
  assert.equal(week.length, WEEK_DAYS);
  assert.equal(week[0].date, '2026-09-06');
  assert.equal(week[0].label, 'Sun');
  assert.equal(week[0].kind, 'partly');
  // One day short of the week is no week at all: a strip with a hole in it
  // reads as a mistake rather than as a forecast.
  assert.equal(parseGoogleDaily({ forecastDays: eight.slice(0, WEEK_DAYS) }, now), null);
});

test('the week names a wet day by its own totals, as every other provider does', () => {
  const now = new Date('2026-09-05T10:00:00Z');
  const eight = Array.from({ length: WEEK_DAYS + 1 }, (entry, index) => day({
    date: { year: 2026, month: 9, day: 5 + index },
    daytime: part({ cloudCover: 90, rainMm: 6 }),
    nighttime: part({ cloudCover: 90, rainMm: 6 }),
  }));
  const week = parseGoogleDaily({ forecastDays: eight }, now);
  assert.equal(week[0].precipitation, 12);
  assert.equal(week[0].kind, 'heavy-rain');
});

test('Google leads both chains and carries the credit its policy asks for', () => {
  assert.equal(SOURCES[0].name, 'Google');
  assert.equal(DAILY_SOURCES[0].name, 'Google');
  // The exact sentence the Weather API policy requires on or beside the data.
  assert.equal(SOURCES[0].attribution.credit, 'Source: Includes weather data from Google.');
  // The route already answers no-store; the browser must not hold its own copy
  // on top of that or the card would age past its own refresh.
  assert.equal(SOURCES[0].cache, 'no-store');
  assert.equal(DAILY_SOURCES[0].cache, 'no-store');
  // Neither asks the route about a location: it forecasts one place by design.
  assert.equal(SOURCES[0].url(55.73825, 12.53836), '/api/weather?kind=hours');
  assert.equal(DAILY_SOURCES[0].url(55.73825, 12.53836), '/api/weather?kind=days');
});
