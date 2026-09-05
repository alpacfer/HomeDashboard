import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoDailyPayload, demoWeatherHours } from '../lib/weather-demo.ts';
import { validWeatherHours, describeHour } from '../lib/weather.ts';
import { buildRibbon, rainHeadline, temperatureTrack, MIN_RIBBON_HOURS } from '../lib/forecast-summary.ts';
import { parseDailyForecast, validDailyForecast, WEEK_DAYS } from '../lib/daily-forecast.ts';

const noon = new Date('2026-08-31T10:00:00Z');

test('the placeholder hours pass the same validator a provider answer does', () => {
  assert.ok(validWeatherHours(demoWeatherHours(noon)));
});

test('hours start on the current hour and run consecutively', () => {
  const hours = demoWeatherHours(new Date('2026-08-31T10:37:00Z'));
  assert.equal(hours[0].timestamp, Date.parse('2026-08-31T10:00:00Z'));
  for (let index = 1; index < hours.length; index++) {
    assert.equal(hours[index].timestamp - hours[index - 1].timestamp, 3600000);
  }
});

test('it fills the whole ribbon, with a wet spell and a readable headline', () => {
  const ribbon = buildRibbon(demoWeatherHours(noon), noon);
  assert.ok(ribbon.length > MIN_RIBBON_HOURS, 'ribbon is longer than the minimum it refuses to draw below');
  assert.ok(ribbon.some(entry => entry.band !== 'dry'), 'some hour is wet, so the bars are not all zero');
  assert.ok(ribbon.some(entry => entry.band === 'dry'), 'some hour is dry, so it is not a wall of rain');
  // The spell is always six hours out, so the headline is the "rain is coming"
  // one: it names the hour, and `wet` stays false because now is dry.
  const headline = rainHeadline(ribbon, noon);
  assert.match(headline?.text ?? '', /rain/i);
  assert.equal(headline?.wet, false);
  assert.equal(ribbon[0].band, 'dry');
  const track = temperatureTrack(ribbon);
  assert.ok(track && track.high > track.low, 'the temperature track has something to draw');
});

test('the icon never contradicts the bar beside it', () => {
  for (const hour of demoWeatherHours(noon)) {
    const condition = describeHour(hour);
    if (condition.wet) assert.ok(hour.cloud > 0.85, 'a wet hour is drawn overcast, not sunny');
    else assert.equal(hour.precipitation, 0);
  }
});

test('the daily body is one the week strip parser accepts', () => {
  const payload = demoDailyPayload(noon);
  assert.ok(validDailyForecast(payload));
  const week = parseDailyForecast(payload, noon);
  assert.ok(week, 'the parser returns a week rather than refusing the shape');
  assert.equal(week.length, WEEK_DAYS);
  // Today is dropped at parse time, so the first day is tomorrow.
  assert.equal(week[0].date, '2026-09-01');
  assert.ok(week.every(day => day.high > day.low));
});

test('two calls at the same time are identical, so captures are comparable', () => {
  assert.deepEqual(demoWeatherHours(noon), demoWeatherHours(noon));
  assert.deepEqual(demoDailyPayload(noon), demoDailyPayload(noon));
});
