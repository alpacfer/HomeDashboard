import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildForecast, buildForecasts, forecastTargets, isRainCode, localTime, validWeather } from '../app/weather.ts';

function fixture(start = '2026-08-30T22:00:00Z', count = 73) {
  return {
    current: { temperature_2m: 17, weather_code: 2, is_day: 1 },
    hourly: {
      time: Array.from({ length: count }, (_, i) => Date.parse(start) / 1000 + i * 3600),
      temperature_2m: Array(count).fill(15), weather_code: Array(count).fill(2),
      is_day: Array(count).fill(1), precipitation_probability: Array(count).fill(0),
    },
  };
}

test('adds tomorrow to the cycle at 20:00 Copenhagen, in summer and winter', () => {
  assert.deepEqual(forecastTargets(new Date('2026-08-31T17:59:59Z')), [{ date: '2026-08-31', day: 'today' }]);
  assert.deepEqual(forecastTargets(new Date('2026-08-31T18:00:00Z')), [
    { date: '2026-08-31', day: 'today' }, { date: '2026-09-01', day: 'tomorrow' },
  ]);
  assert.deepEqual(forecastTargets(new Date('2026-12-31T18:59:59Z')), [{ date: '2026-12-31', day: 'today' }]);
  assert.deepEqual(forecastTargets(new Date('2026-12-31T19:00:00Z')), [
    { date: '2026-12-31', day: 'today' }, { date: '2027-01-01', day: 'tomorrow' },
  ]);
});

test('today excludes every past hour and runs through the end of the day without separate extrema', () => {
  const data = fixture();
  data.hourly.temperature_2m.fill(90, 0, 16);
  data.hourly.temperature_2m[16] = 16;
  data.hourly.temperature_2m[17] = 8;
  data.hourly.temperature_2m[18] = 20;
  const forecast = buildForecast(data, new Date('2026-08-31T13:59:00Z'), { date: '2026-08-31', day: 'today' });
  assert.equal(forecast.slots[0].label, '16:00');
  assert.equal(forecast.slots.at(-1).label, '23:00');
  assert.equal(forecast.slots.some(slot => 'high' in slot || 'low' in slot), false);
  assert.ok(forecast.slots.every(slot => slot.timestamp * 1000 > Date.parse('2026-08-31T13:59:00Z')));
});

test('tomorrow covers the whole day without high or low labels', () => {
  const data = fixture();
  data.hourly.temperature_2m[29] = 7;
  data.hourly.temperature_2m[41] = 24;
  const forecasts = buildForecasts(data, new Date('2026-08-31T18:00:00Z'));
  const tomorrow = forecasts.find(item => item.day === 'tomorrow');
  assert.equal(tomorrow.slots[0].label, '0:00');
  assert.equal(tomorrow.slots.at(-1).label, '23:00');
  assert.equal(tomorrow.slots.some(slot => 'high' in slot || 'low' in slot), false);
});

test('rain probabilities describe the period until the next visible entry', () => {
  const data = fixture();
  data.hourly.precipitation_probability[17] = 70;
  data.hourly.precipitation_probability[19] = 100;
  const forecast = buildForecast(data, new Date('2026-08-31T13:59:00Z'), { date: '2026-08-31', day: 'today' });
  assert.equal(forecast.slots.find(slot => slot.label === '16:00').rain, 70);
  assert.equal(forecast.slots.find(slot => slot.label === '18:00').rain, 100);
});

test('missing probability is unknown, never silently dry', () => {
  const data = fixture();
  data.hourly.precipitation_probability.fill(null);
  assert.equal(validWeather(data), true);
  const forecast = buildForecast(data, new Date('2026-08-31T18:00:00Z'), { date: '2026-09-01', day: 'tomorrow' });
  assert.ok(forecast.slots.every(slot => slot.rain === null));
});

test('does not hide the first imminent forecast between regular points', () => {
  const data = fixture();
  data.hourly.precipitation_probability[9] = 85;
  const forecast = buildForecast(data, new Date('2026-08-31T06:30:00Z'), { date: '2026-08-31', day: 'today' });
  assert.equal(forecast.slots[0].label, '9:00');
  assert.equal(forecast.slots[0].rain, 85);
  assert.equal(forecast.slots[1].label, '10:00');
});

test('rejects malformed data and returns no future day outside the horizon', () => {
  assert.equal(validWeather(fixture()), true);
  assert.equal(validWeather(null), false);
  const data = fixture();
  data.hourly.temperature_2m.pop();
  assert.equal(validWeather(data), false);
  assert.equal(buildForecast(fixture(), new Date('2026-09-10T12:00:00Z'), { date: '2026-09-11', day: 'tomorrow' }), null);
});

test('spring and autumn daylight-saving days retain every real hourly interval', () => {
  for (const [start, now, date, expectedHours] of [
    ['2026-03-28T23:00:00Z', '2026-03-28T19:00:00Z', '2026-03-29', 23],
    ['2026-10-24T22:00:00Z', '2026-10-24T18:00:00Z', '2026-10-25', 25],
  ]) {
    const data = fixture(start);
    const indices = data.hourly.time.flatMap((t, i) => localTime(new Date(t * 1000)).date === date ? [i] : []);
    assert.equal(indices.length, expectedHours);
    const forecast = buildForecast(data, new Date(now), { date, day: 'tomorrow' });
    assert.equal(forecast.slots.at(-1).label, '23:00');
  }
});

test('rain emphasis includes drizzle, freezing rain, showers and storms, not clouds or snow', () => {
  for (const code of [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99]) assert.equal(isRainCode(code), true);
  for (const code of [0, 1, 2, 3, 45, 48, 71, 73, 75, 77, 85, 86]) assert.equal(isRainCode(code), false);
});
