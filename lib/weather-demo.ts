// A forecast that needs no provider, so the display can be photographed in
// context without spending the quota.
//
// `?weather=off` and `?weather=demo` ask nobody for a forecast. They used to
// leave the weather card, the rain ribbon and the week strip empty, which made
// every capture that was not about the weather — the clock, the Tenant, the
// departure boards — a picture of a dashboard with a hole in it. Neither flag
// may make a request, so the placeholder is the answer: the same shapes a
// provider returns, filled in from the clock.
//
// Everything here is a function of the time asked for, so two captures of the
// same change are comparable, and none of it is reachable without a flag.
// `?weather=none` is the way back to the genuinely empty card, which is a real
// state the display has to show correctly when every provider is down.
//
// This is never a fallback. A provider that fails on the wall shows the offline
// dot and the last good forecast; it must never show this. See
// components/weather-panel.tsx.

import { WEEK_DAYS } from './daily-forecast';
import { FORECAST_LATITUDE, FORECAST_LONGITUDE, type WeatherHour } from './weather';

// Long enough to fill the eighteen-hour ribbon and leave the panel a margin
// past its end, so the window never runs short at the top of an hour.
const DEMO_HOURS = 30;
const HOUR_MS = 3_600_000;

// A plausible Danish day rather than a flat line: coolest before dawn, warmest
// mid-afternoon. Amplitude and mean are picked so the ribbon's high and low
// differ enough to draw a visible temperature track.
const MEAN_C = 14;
const SWING_C = 5;
const WARMEST_HOUR = 15;

// One wet spell, deliberately inside the ribbon's window, because a dry
// forecast draws no bars at all and would hide exactly the part of the card a
// capture is meant to show. Hours 6 to 10 from now: rain building to heavy and
// tailing off into drizzle.
const SPELL_START = 6;
const SPELL_MM = [0.4, 1.6, 3.2, 1.1, 0.2];

const hourFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Copenhagen', hour: 'numeric', hourCycle: 'h23',
});
const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit',
});

function copenhagenHour(at: number): number {
  return Number(hourFormatter.format(new Date(at))) % 24;
}

function temperatureAt(clockHour: number): number {
  const phase = ((clockHour - WARMEST_HOUR) / 24) * 2 * Math.PI;
  return Math.round((MEAN_C + SWING_C * Math.cos(phase)) * 10) / 10;
}

/**
 * Hours from the start of the current hour, in the shape the hourly parsers
 * produce. Cloud follows the wet spell so the icon, the headline and the bars
 * cannot disagree with each other.
 */
export function demoWeatherHours(now: Date): WeatherHour[] {
  const start = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS;
  return Array.from({ length: DEMO_HOURS }, (unused, index) => {
    const timestamp = start + index * HOUR_MS;
    const millimetres = SPELL_MM[index - SPELL_START] ?? 0;
    // Overcast through the spell, thickening an hour ahead of it and clearing
    // an hour after, so the card is not sunny above a full rain bar.
    const near = index >= SPELL_START - 1 && index <= SPELL_START + SPELL_MM.length;
    const cloud = millimetres > 0 ? 0.95 : near ? 0.7 : 0.3;
    return {
      timestamp,
      temperature: temperatureAt(copenhagenHour(timestamp)),
      cloud,
      visibility: millimetres > 0 ? 8000 : 20000,
      rain: millimetres,
      snow: 0,
      precipitation: millimetres,
    };
  });
}

// The week strip keeps the provider's raw body and re-reads it against the
// clock, so the placeholder has to be a body its parser accepts rather than a
// parsed week. Open-Meteo's daily shape is the one `parseDailyForecast` reads.
const DAY_HIGHS = [17, 19, 15, 13, 16, 18, 20, 14];
const DAY_LOWS = [9, 11, 8, 6, 8, 10, 12, 7];
const DAY_RAIN = [0, 0.2, 4.8, 9.1, 1.3, 0, 0, 2.4];
const DAY_CLOUD = [22, 45, 78, 94, 61, 18, 30, 70];

/**
 * An Open-Meteo daily body covering today and the week after it, so the week
 * strip's own parser and validator run exactly as they do on a live answer.
 */
export function demoDailyPayload(now: Date): unknown {
  const start = Date.parse(dateFormatter.format(now) + 'T00:00:00Z');
  const length = WEEK_DAYS + 1;
  const at = <T,>(values: readonly T[], index: number): T => {
    const value = values[index % values.length];
    if (value === undefined) throw new Error('demo day table is empty');
    return value;
  };
  return {
    latitude: FORECAST_LATITUDE,
    longitude: FORECAST_LONGITUDE,
    daily: {
      time: Array.from({ length }, (unused, index) => dateFormatter.format(new Date(start + index * 86_400_000))),
      temperature_2m_max: Array.from({ length }, (unused, index) => at(DAY_HIGHS, index)),
      temperature_2m_min: Array.from({ length }, (unused, index) => at(DAY_LOWS, index)),
      precipitation_sum: Array.from({ length }, (unused, index) => at(DAY_RAIN, index)),
      rain_sum: Array.from({ length }, (unused, index) => at(DAY_RAIN, index)),
      showers_sum: Array.from({ length }, () => 0),
      snowfall_sum: Array.from({ length }, () => 0),
      cloud_cover_mean: Array.from({ length }, (unused, index) => at(DAY_CLOUD, index)),
    },
  };
}
