import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { copenhagenDateKey, describeDay, openMeteoDailyUrl, parseDailyForecast, validDailyForecast, WEEK_DAYS, weekdayLabel } from '../lib/daily-forecast.ts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/open-meteo-daily.json', import.meta.url), 'utf8'));
// 2026-09-03 18:00 Copenhagen summer time, the day the fixture was captured.
const NOW = new Date(Date.UTC(2026, 8, 3, 16, 0, 0));

function clone() {
  return JSON.parse(JSON.stringify(fixture));
}

test('the week is the seven days after today, in order', () => {
  const week = parseDailyForecast(fixture, NOW);
  assert.equal(week.length, WEEK_DAYS);
  assert.deepEqual(week.map(day => day.date), ['2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10']);
  assert.deepEqual(week.map(day => day.label), ['Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu']);
  assert.equal(week[0].high, 16.6);
  assert.equal(week[0].low, 14.7);
});

test('today is decided in Copenhagen time, not the device zone', () => {
  // 23:30 UTC on the 3rd is already the 4th in Copenhagen, so the 4th is
  // "today" and drops out of the week; with only seven days left there is
  // still a full week to show, one day short and there is not.
  const late = new Date(Date.UTC(2026, 8, 3, 23, 30, 0));
  assert.equal(copenhagenDateKey(late), '2026-09-04');
  assert.equal(parseDailyForecast(fixture, late), null);
  const early = new Date(Date.UTC(2026, 8, 2, 23, 30, 0));
  assert.equal(copenhagenDateKey(early), '2026-09-03');
  assert.equal(parseDailyForecast(fixture, early)[0].date, '2026-09-04');
});

test('the condition is derived from the day itself, never from a weather code', () => {
  assert.equal(openMeteoDailyUrl(55.7, 12.5).includes('weather_code'), false);
  assert.equal(openMeteoDailyUrl(55.7, 12.5).includes('probability'), false);
  const week = parseDailyForecast(fixture, NOW);
  // 4.2 mm under 92% cloud is a rain day; 0 mm under 46% cloud is partly
  // cloudy; 15 mm is a heavy day; 0.9 mm under 81% cloud is a cloudy day with
  // a shower in it, not a wet one.
  assert.deepEqual(week.map(day => day.kind), ['rain', 'rain', 'partly', 'partly', 'cloudy', 'heavy-rain', 'rain']);
  assert.equal(describeDay({ precipitation: 3, snow: 3, cloud: 0.9 }), 'snow');
  assert.equal(describeDay({ precipitation: 3, snow: 1, cloud: 0.9 }), 'sleet');
  assert.equal(describeDay({ precipitation: 0.5, snow: 0, cloud: 0.1 }), 'clear');
  assert.equal(describeDay({ precipitation: 0, snow: 0, cloud: 0.95 }), 'overcast');
});

test('frozen precipitation is what the liquid sums do not explain', () => {
  const payload = clone();
  payload.daily.rain_sum[1] = 1;
  payload.daily.showers_sum[1] = 0.5;
  payload.daily.precipitation_sum[1] = 6;
  assert.equal(parseDailyForecast(payload, NOW)[0].snow, 4.5);
  assert.equal(parseDailyForecast(payload, NOW)[0].kind, 'snow');
});

test('weekday labels come from the provider date, not from the device zone', () => {
  assert.equal(weekdayLabel('2026-09-04'), 'Fri');
  assert.equal(weekdayLabel('2026-09-06'), 'Sun');
  assert.equal(weekdayLabel('2027-01-01'), 'Fri');
});

test('a malformed payload is refused rather than drawn', () => {
  assert.equal(validDailyForecast(fixture), true);
  assert.equal(parseDailyForecast(null, NOW), null);
  assert.equal(parseDailyForecast({}, NOW), null);
  assert.equal(parseDailyForecast({ daily: { time: ['2026-09-04'] } }, NOW), null);
  const missing = clone();
  delete missing.daily.cloud_cover_mean;
  assert.equal(parseDailyForecast(missing, NOW), null);
  const short = clone();
  short.daily.temperature_2m_max.pop();
  assert.equal(parseDailyForecast(short, NOW), null);
  const text = clone();
  text.daily.precipitation_sum[2] = 'lots';
  assert.equal(parseDailyForecast(text, NOW), null);
  const badDate = clone();
  badDate.daily.time[2] = '4 September';
  assert.equal(parseDailyForecast(badDate, NOW), null);
});

test('a day with a hole in it drops out, and a short week is not shown', () => {
  // Nulls are a legitimate provider answer for a day it cannot cover. Drawing
  // that day as dry and mild would be a lie, and a six-day week with a gap
  // reads as a mistake, so the strip waits for a complete answer instead.
  const holed = clone();
  holed.daily.temperature_2m_max[4] = null;
  assert.equal(parseDailyForecast(holed, NOW), null);
  // A hole in today does not matter: today is not part of the week.
  const todayHoled = clone();
  todayHoled.daily.temperature_2m_max[0] = null;
  assert.equal(parseDailyForecast(todayHoled, NOW).length, WEEK_DAYS);
});
