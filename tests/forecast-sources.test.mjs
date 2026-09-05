import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dmiUrl, openMeteoUrl, parseCoverage, parseForecast, SOURCES, validCoverage, validForecast } from '../lib/forecast-sources.ts';

// DMI returns accumulated precipitation, so a fixture states totals since the
// model run started and the parser is expected to difference them.
function coverage({
  times = ['2026-09-02T15:00:00.000Z', '2026-09-02T16:00:00.000Z', '2026-09-02T17:00:00.000Z'],
  temperature = [288.15, 289.15, 290.15],
  cloud = [1, 0.5, 0],
  visibility = [50000, 50000, 50000],
  rain = [0, 0.5, 2],
  snow = [0, 0, 0],
  graupel = [0, 0, 0],
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
    },
  };
}

// Open-Meteo reports hourly totals directly, so nothing is differenced.
function forecast({
  time = [1756843200, 1756846800, 1756850400],
  temperature_2m = [15, 16, 17],
  cloud_cover = [100, 50, 0],
  visibility = [50000, 50000, 50000],
  precipitation = [0, 0.5, 2],
  rain = [0, 0.5, 2],
  showers = [0, 0, 0],
  hourly,
} = {}) {
  return { hourly: hourly ?? { time, temperature_2m, cloud_cover, visibility, precipitation, rain, showers } };
}

test('Google leads, DMI is asked next and a fallback always exists', () => {
  // The display must never depend on a single upstream: DMI answered 429 to
  // everything for hours during their maintenance and left the screen blank.
  assert.deepEqual(SOURCES.map(entry => entry.name), ['Google', 'DMI', 'Open-Meteo', 'MET Norway']);
  assert.ok(SOURCES.length >= 3, 'there must always be a fallback, and one on a different model behind it');
  for (const entry of SOURCES) {
    assert.match(entry.attribution.href, /^https:\/\//);
    assert.ok(entry.attribution.credit.length > 0, 'every provider requires attribution');
  }
  // The three that publish under CC BY have to carry the licence; Google's
  // terms ask for a sentence of their own instead, checked where it is set.
  for (const entry of SOURCES.slice(1)) assert.match(entry.attribution.credit, /CC BY 4\.0/);
  // Two of those carry the DMI model and must say so; MET Norway is
  // independent of DMI and of Open-Meteo's per-address quota, and Google is
  // independent of all three (see tests/met-norway.test.mjs).
  for (const entry of SOURCES.slice(1, 3)) assert.match(entry.attribution.credit, /DMI/);
});

test('neither request asks for a probability or a weather code', () => {
  // This is the fault the rework exists to fix. precipitation_probability is
  // byte-identical across every Open-Meteo model because DMI publishes none,
  // so pairing it with a DMI-derived icon made the two disagree on screen.
  for (const url of [dmiUrl(55.7, 12.5), openMeteoUrl(55.7, 12.5)]) {
    const query = decodeURIComponent(new URL(url).search);
    assert.ok(!/probability/.test(query), 'no probability field may be requested: ' + url);
    assert.ok(!/weather.?code/.test(query), 'the condition is derived, not taken from a code: ' + url);
  }
});

test('the DMI request names the model, the CRS and every parameter it parses', () => {
  const url = new URL(dmiUrl(55.73825, 12.53836));
  assert.equal(url.origin + url.pathname, 'https://opendataapi.dmi.dk/v1/forecastedr/collections/harmonie_dini_sf/position');
  assert.equal(url.searchParams.get('crs'), 'crs84');
  // Longitude comes first in WKT, which is the opposite order to the arguments.
  assert.equal(url.searchParams.get('coords'), 'POINT(12.53836 55.73825)');
  const requested = (url.searchParams.get('parameter-name') ?? '').split(',');
  for (const name of ['temperature-2m', 'fraction-of-cloud-cover', 'visibility', 'rain-precipitation-rate', 'total-snowfall-rate-water-equivalent', 'graupel-precipitation-rate']) {
    assert.ok(requested.includes(name), name + ' is missing from the DMI request');
  }
});

test('the Open-Meteo request pins the DMI model and absolute timestamps', () => {
  const url = new URL(openMeteoUrl(55.73825, 12.53836));
  assert.equal(url.origin + url.pathname, 'https://api.open-meteo.com/v1/forecast');
  assert.equal(url.searchParams.get('models'), 'dmi_seamless', 'the fallback must still be the DMI model');
  assert.equal(url.searchParams.get('timezone'), 'GMT', 'timestamps must not be shifted by the provider');
  const requested = (url.searchParams.get('hourly') ?? '').split(',');
  for (const field of ['temperature_2m', 'cloud_cover', 'visibility', 'precipitation', 'rain', 'showers']) {
    assert.ok(requested.includes(field), field + ' is missing from the Open-Meteo request');
  }
});

test('validates the DMI payload and rejects malformed ones', () => {
  assert.equal(validCoverage(coverage()), true);
  assert.equal(validCoverage(null), false);
  assert.equal(validCoverage({}), false);
  assert.equal(validCoverage(coverage({ times: ['2026-09-02T15:00:00.000Z'], temperature: [288.15], cloud: [1], visibility: [1], rain: [0], snow: [0], graupel: [0] })), false, 'one step cannot be differenced');
  assert.equal(validCoverage(coverage({ times: ['nonsense', '2026-09-02T16:00:00.000Z', '2026-09-02T17:00:00.000Z'] })), false);
  assert.equal(validCoverage(coverage({ temperature: [288.15, 289.15] })), false, 'a short range must be rejected');
  assert.equal(validCoverage(coverage({ rain: [0, 'wet', 2] })), false, 'a non-numeric sample must be rejected');
  assert.equal(validCoverage(coverage({ ranges: { 'temperature-2m': { values: [288.15, 289.15, 290.15] } } })), false, 'a missing range must be rejected');
  assert.equal(parseCoverage({ nope: true }), null, 'an unusable payload parses to null, not a throw');
});

test('differences DMI accumulations into the hour that starts at each step', () => {
  const hours = parseCoverage(coverage());
  // Three steps produce two hours: the last has no successor to difference.
  assert.equal(hours.length, 2);
  assert.deepEqual(hours.map(entry => entry.rain), [0.5, 1.5]);
  assert.equal(hours[0].timestamp, Date.parse('2026-09-02T15:00:00.000Z'));
  assert.equal(hours[0].temperature, 15, 'kelvin becomes celsius');
  assert.equal(hours[0].cloud, 1, 'DMI cloud cover is already a fraction');
});

test('clamps the float dips that flat DMI accumulations produce', () => {
  const [first] = parseCoverage(coverage({ rain: [0.2842, 0.2832, 0.2842] }));
  assert.equal(first.rain, 0);
  assert.equal(first.precipitation, 0);
});

test('counts DMI graupel as frozen alongside snow', () => {
  const [first] = parseCoverage(coverage({ rain: [0, 0.4, 0.4], snow: [0, 0.2, 0.2], graupel: [0, 0.1, 0.1] }));
  assert.equal(Number(first.snow.toFixed(3)), 0.3);
  assert.equal(Number(first.precipitation.toFixed(3)), 0.7);
});

test('drops DMI hours whose own samples are missing rather than showing them as dry', () => {
  const four = {
    times: ['2026-09-02T15:00:00.000Z', '2026-09-02T16:00:00.000Z', '2026-09-02T17:00:00.000Z', '2026-09-02T18:00:00.000Z'],
    temperature: [288.15, 289.15, 290.15, 291.15], cloud: [1, 1, 1, 1], visibility: [50000, 50000, 50000, 50000],
    snow: [0, 0, 0, 0], graupel: [0, 0, 0, 0],
  };
  assert.deepEqual(parseCoverage(coverage({ ...four, rain: [0, 0.5, 1.5, 3] })).map(entry => entry.rain), [0.5, 1, 1.5]);
  assert.deepEqual(parseCoverage(coverage({ ...four, rain: [0, 0.5, null, 3] })).map(entry => entry.rain), [0.5]);
});

test('validates the Open-Meteo payload and rejects malformed ones', () => {
  assert.equal(validForecast(forecast()), true);
  assert.equal(validForecast(null), false);
  assert.equal(validForecast({ hourly: null }), false);
  assert.equal(validForecast(forecast({ time: [1756843200] })), false, 'a single step is not a forecast');
  assert.equal(validForecast(forecast({ temperature_2m: [15, 16] })), false, 'a short series must be rejected');
  assert.equal(validForecast(forecast({ rain: [0, 'wet', 2] })), false, 'a non-numeric sample must be rejected');
  assert.equal(validForecast(forecast({ time: [0, 1756846800, 1756850400] })), false, 'a zero timestamp must be rejected');
  const missing = forecast();
  delete missing.hourly.visibility;
  assert.equal(validForecast(missing), false, 'every requested field must be present');
  assert.equal(parseForecast({ nope: true }), null, 'an unusable payload parses to null, not a throw');
});

test('parses Open-Meteo hourly totals and converts the percentage', () => {
  const hours = parseForecast(forecast());
  assert.equal(hours.length, 3);
  assert.equal(hours[0].timestamp, 1756843200 * 1000);
  assert.deepEqual(hours.map(entry => entry.temperature), [15, 16, 17]);
  assert.deepEqual(hours.map(entry => entry.cloud), [1, 0.5, 0], 'percent becomes a fraction');
  assert.deepEqual(hours.map(entry => entry.precipitation), [0, 0.5, 2]);
});

test('treats Open-Meteo showers as liquid and the remainder as frozen', () => {
  const [wet] = parseForecast(forecast({ precipitation: [1, 1, 1], rain: [0.4, 0, 0], showers: [0.2, 0, 0] }));
  assert.equal(Number(wet.rain.toFixed(3)), 0.6, 'rain and showers are both liquid');
  assert.equal(Number(wet.snow.toFixed(3)), 0.4);
  // The parts need not add up exactly, and a negative frozen share is nonsense.
  const [odd] = parseForecast(forecast({ precipitation: [0.5, 0, 0], rain: [0.6, 0, 0], showers: [0.1, 0, 0] }));
  assert.equal(odd.snow, 0);
});

test('a missing visibility sample leaves the hour usable but never foggy', () => {
  const [entry] = parseForecast(forecast({ visibility: [null, 50000, 50000] }));
  assert.equal(entry.visibility, Infinity);
});

test('both parsers agree on a real captured DMI forecast', () => {
  const captured = JSON.parse(readFileSync(new URL('./fixtures/dmi-harmonie-hourly.json', import.meta.url)));
  const hours = parseForecast(captured);
  assert.equal(hours.length, captured.hourly.time.length);
  assert.ok(hours.every(entry => entry.cloud >= 0 && entry.cloud <= 1), 'cloud must be a fraction');
  assert.ok(hours.every(entry => entry.precipitation >= 0), 'precipitation must never be negative');
  assert.ok(hours.every(entry => Number.isFinite(entry.temperature)), 'every hour needs a temperature');
  // Whichever provider answers, the shape handed onward is identical.
  const viaDmi = parseCoverage(coverage());
  assert.deepEqual(Object.keys(viaDmi[0]).sort(), Object.keys(hours[0]).sort());
});
