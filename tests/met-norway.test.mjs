import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { frozenShare, metNorwayUrl, parseLocationForecast, SOURCES, validLocationForecast } from '../lib/forecast-sources.ts';
import { DAILY_SOURCES, parseMetDaily, WEEK_DAYS } from '../lib/daily-forecast.ts';
import { describeHour } from '../lib/weather.ts';
import { buildRibbon } from '../lib/forecast-summary.ts';

// Captured 3 September 2026 at 20:40 Copenhagen time and trimmed to the fields
// the parsers read: eight hourly entries, then every six-hourly one.
const fixture = JSON.parse(readFileSync(new URL('./fixtures/met-norway-complete.json', import.meta.url), 'utf8'));
const NOW = new Date('2026-09-03T18:40:00Z');

function clone() {
  return JSON.parse(JSON.stringify(fixture));
}

test('MET Norway stands behind both DMI routes, for the hours and for the week', () => {
  // Two providers carrying one model behind one per-address quota is one point
  // of failure; this is the independent one.
  assert.deepEqual(SOURCES.map(entry => entry.name), ['Google', 'DMI', 'Open-Meteo', 'MET Norway']);
  assert.deepEqual(DAILY_SOURCES.map(entry => entry.name), ['Google', 'Open-Meteo', 'MET Norway']);
  const met = SOURCES[3];
  assert.match(met.attribution.credit, /CC BY 4\.0/);
  // Its terms require honouring Expires, which only the browser cache does.
  assert.equal(met.cache, 'default');
  assert.equal(DAILY_SOURCES[2].cache, 'default');
  // Both ask for the same URL so one cached response serves the two panels.
  assert.equal(met.url(55.73825, 12.53836), DAILY_SOURCES[2].url(55.73825, 12.53836));
});

test('the request truncates coordinates to four decimals, as the terms require', () => {
  const url = new URL(metNorwayUrl(55.73825, 12.53836));
  assert.equal(url.origin + url.pathname, 'https://api.met.no/weatherapi/locationforecast/2.0/complete');
  assert.equal(url.searchParams.get('lat'), '55.7383');
  assert.equal(url.searchParams.get('lon'), '12.5384');
});

test('only entries with an hourly amount become hours, and the ribbon can be built from them', () => {
  const hours = parseLocationForecast(fixture);
  assert.equal(hours.length, 15);
  assert.equal(hours[0].timestamp, Date.parse('2026-09-03T18:00:00Z'));
  assert.equal(hours[0].temperature, 18.6);
  assert.equal(hours[0].cloud, 0.843);
  assert.equal(hours[0].visibility, Infinity);
  assert.equal(hours[0].precipitation, 0);
  // The first eight are consecutive, then six-hourly entries follow; the
  // ribbon stops at the first hole rather than drawing across it.
  assert.equal(buildRibbon(hours, NOW).length, 8);
});

test('frozen share and fog are read from temperature and fog fraction, the only fields MET gives', () => {
  assert.equal(frozenShare(-3), 1);
  assert.equal(frozenShare(0), 1);
  assert.equal(frozenShare(1.5), 0.5);
  assert.equal(frozenShare(2.1), 0);
  const payload = clone();
  const [first, second] = payload.properties.timeseries;
  first.data.instant.details.air_temperature = -1;
  first.data.next_1_hours.details.precipitation_amount = 1.2;
  second.data.instant.details.fog_area_fraction = 80;
  const hours = parseLocationForecast(payload);
  assert.equal(hours[0].snow, 1.2);
  assert.equal(hours[0].rain, 0);
  assert.equal(describeHour(hours[0]).kind, 'snow');
  assert.equal(hours[1].visibility, 500);
  assert.equal(describeHour(hours[1]).kind, 'fog');
});

test('malformed payloads are rejected whole', () => {
  assert.equal(validLocationForecast(null), false);
  assert.equal(validLocationForecast({}), false);
  assert.equal(validLocationForecast({ properties: { timeseries: [] } }), false);
  const payload = clone();
  payload.properties.timeseries[3].time = 'yesterday';
  assert.equal(parseLocationForecast(payload), null);
  const noInstant = clone();
  delete noInstant.properties.timeseries[0].data.instant;
  assert.equal(parseMetDaily(noInstant, NOW), null);
  // An entry missing its amount is an hour dropped, not a payload rejected.
  const gap = clone();
  delete gap.properties.timeseries[0].data.next_1_hours;
  assert.equal(parseLocationForecast(gap).length, 14);
});

test('the week is the seven days after today, each from its own samples', () => {
  const week = parseMetDaily(fixture, NOW);
  assert.equal(week.length, WEEK_DAYS);
  assert.deepEqual(week.map(day => day.date), ['2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10']);
  assert.deepEqual(week.map(day => day.label), ['Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu']);
  for (const day of week) {
    assert.ok(day.high >= day.low, day.date + ' high below low');
    assert.ok(day.precipitation >= 0 && day.snow <= day.precipitation);
    assert.ok(day.cloud >= 0 && day.cloud <= 1);
  }
  // The extremes take in every six-hour window and every hourly sample of the
  // day, so they can only ever widen the windows' own range.
  const friday = fixture.properties.timeseries.filter(entry => entry.time.startsWith('2026-09-04') && entry.data.next_6_hours.details.air_temperature_max !== undefined);
  assert.ok(week[0].high >= Math.max(...friday.map(entry => entry.data.next_6_hours.details.air_temperature_max)));
  assert.ok(week[0].low <= Math.min(...friday.map(entry => entry.data.next_6_hours.details.air_temperature_min)));
  assert.equal(week[0].high, 16.8);
  assert.equal(week[0].low, 14.3);
});

test('precipitation windows are never summed twice and a half-covered day is dropped', () => {
  const payload = clone();
  // Every window on the 5th (a six-hourly day) carries 2 mm: four windows, 8 mm.
  for (const entry of payload.properties.timeseries) {
    if (entry.time.startsWith('2026-09-05') && entry.data.next_6_hours) entry.data.next_6_hours.details.precipitation_amount = 2;
    if (entry.time.startsWith('2026-09-05') && entry.data.next_1_hours) entry.data.next_1_hours.details.precipitation_amount = 2;
  }
  const week = parseMetDaily(payload, NOW);
  // 00:00 UTC on the 5th is 02:00 on the 5th in Copenhagen; the 18:00 UTC
  // window on the 4th starts on the 4th and is counted there.
  const saturday = week.find(day => day.date === '2026-09-05');
  assert.equal(saturday.precipitation, 8);
  assert.equal(saturday.kind, 'rain');
  // Only three six-hourly samples exist for the 13th, so with "today" moved to
  // the 6th there are just six complete days left and no week is shown.
  assert.equal(parseMetDaily(fixture, new Date('2026-09-06T10:00:00Z')), null);
  assert.equal(parseMetDaily(fixture, new Date('2026-09-05T10:00:00Z')).length, WEEK_DAYS);
});
