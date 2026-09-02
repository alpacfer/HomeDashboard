import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeHour, isDaylight, precipitationBand, solarElevation, WET_MM } from '../lib/weather.ts';

function hour(overrides = {}) {
  return { timestamp: 0, temperature: 10, cloud: 1, visibility: 50000, rain: 0, snow: 0, precipitation: 0, ...overrides };
}

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
  assert.equal(describeHour(hour({ rain: 3.2, precipitation: 3.2 })).kind, 'rain');
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
