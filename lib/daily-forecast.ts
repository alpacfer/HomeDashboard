// The week ahead: one line per day, deliberately thin. A wall display wants
// "is the weekend wet" and "is it getting colder", not a table.
//
// The pinned panel's DMI Harmonie run only reaches about two and a half days,
// so the week comes from Open-Meteo's daily aggregation of its default model
// blend instead, with MET Norway's ten-day forecast behind it for the days
// Open-Meteo's quota is spent (see lib/forecast-sources.ts for why that
// happens). It is a different forecast from the ribbon, and the two are
// never mixed: the ribbon says what the next hours do, the week says what the
// days after tomorrow look like. As with the hourly data, no weather code or
// probability is requested: the condition is derived here from the day's own
// cloud cover and precipitation, so the icon and the amount cannot disagree.

import { finite, frozenShare, metNorwayUrl, validLocationForecast, type MetEntry } from './forecast-sources';
import { type ConditionKind } from './weather';

export const WEEK_DAYS = 7;
// Daily totals, not hourly. A whole day with under a millimetre is a dry day
// with a shower in it; over ten is a day you plan around.
export const DAY_WET_MM = 1;
export const DAY_HEAVY_MM = 10;

export type ForecastDay = {
  date: string;
  label: string;
  high: number;
  low: number;
  precipitation: number;
  snow: number;
  cloud: number;
  kind: ConditionKind;
};

const DAILY_FIELDS = ['temperature_2m_max', 'temperature_2m_min', 'precipitation_sum', 'rain_sum', 'showers_sum', 'snowfall_sum', 'cloud_cover_mean'] as const;

type DailyForecast = { daily: { time: string[] } & Record<string, (number | null)[]> };

export function openMeteoDailyUrl(latitude: number, longitude: number) {
  const query = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    daily: DAILY_FIELDS.join(','),
    // Today plus the seven days that follow it. Today is dropped when parsed
    // because the ribbon already covers it hour by hour.
    forecast_days: String(WEEK_DAYS + 1),
    timezone: 'Europe/Copenhagen',
  });
  return 'https://api.open-meteo.com/v1/forecast?' + query.toString();
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function samples(value: unknown, length: number) {
  if (!Array.isArray(value) || value.length !== length) return null;
  return value.every(sample => sample === null || Number.isFinite(sample)) ? value as (number | null)[] : null;
}

export function validDailyForecast(value: unknown): value is DailyForecast {
  const daily = (value as DailyForecast | null)?.daily;
  if (!daily || typeof daily !== 'object') return false;
  const time = daily.time;
  if (!Array.isArray(time) || time.length < 2) return false;
  if (!time.every(day => typeof day === 'string' && DATE.test(day))) return false;
  return DAILY_FIELDS.every(field => samples(daily[field], time.length));
}

const dayKeyFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit' });
const weekdayFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short' });

export function copenhagenDateKey(now: Date) {
  return dayKeyFormat.format(now);
}

// The provider already reports each day as a Copenhagen calendar date, so the
// string is read as a date and never passed through the device's time zone.
export function weekdayLabel(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return weekdayFormat.format(new Date(Date.UTC(year, month - 1, day, 12)));
}

export function describeDay(day: { precipitation: number; snow: number; cloud: number }): ConditionKind {
  if (day.precipitation >= DAY_WET_MM) {
    if (day.snow >= day.precipitation * 0.7) return 'snow';
    if (day.snow >= day.precipitation * 0.2) return 'sleet';
    return day.precipitation >= DAY_HEAVY_MM ? 'heavy-rain' : 'rain';
  }
  if (day.cloud < 0.2) return 'clear';
  if (day.cloud < 0.55) return 'partly';
  if (day.cloud < 0.85) return 'cloudy';
  return 'overcast';
}

// Returns the seven days after today, or null when the payload is unusable.
// Days with any field missing are dropped rather than drawn as dry and mild,
// and if that leaves fewer than the full week the week is not shown at all: a
// strip with a hole in it reads as a mistake, not as a forecast.
export function parseDailyForecast(payload: unknown, now: Date): ForecastDay[] | null {
  if (!validDailyForecast(payload)) return null;
  const { daily } = payload;
  const today = copenhagenDateKey(now);
  const days = daily.time.flatMap((date, index): ForecastDay[] => {
    if (date <= today) return [];
    const high = daily.temperature_2m_max[index];
    const low = daily.temperature_2m_min[index];
    const precipitation = daily.precipitation_sum[index];
    const rain = daily.rain_sum[index];
    const showers = daily.showers_sum[index];
    const cloud = daily.cloud_cover_mean[index];
    if (high === null || low === null || precipitation === null || rain === null || showers === null || cloud === null) return [];
    // Water equivalent of whatever the liquid parts do not account for, the
    // same reading as the hourly parser. snowfall_sum is centimetres of snow
    // depth and is not comparable, so it is validated but not used.
    const snow = Math.max(0, precipitation - rain - showers);
    const day = { precipitation, snow, cloud: cloud / 100 };
    return [{ date, label: weekdayLabel(date), high, low, ...day, kind: describeDay(day) }];
  }).slice(0, WEEK_DAYS);
  return days.length === WEEK_DAYS ? days : null;
}

// ---------------------------------------------------------------------------
// MET Norway, aggregated from the same Locationforecast response the hourly
// fallback uses, so the two cost one request between them.
//
// The series is hourly for about two and a half days and six-hourly after
// that, and every entry at 00, 06, 12 and 18 UTC carries the next six hours'
// temperature extremes and precipitation total. A day's high and low are the
// extremes of every sample and every six-hour window that starts in it; its
// precipitation is the sum of non-overlapping windows, hourly where the series
// is hourly and six-hourly after, each assigned to the day it starts in. A day
// with fewer than four six-hourly samples is incomplete and is dropped, which
// is what keeps a half-covered last day off the strip.
// ---------------------------------------------------------------------------

const HOUR_MS = 3_600_000;
const SAMPLES_PER_DAY = 4;

type DayTally = { highs: number[]; lows: number[]; clouds: number[]; precipitation: number; snow: number; windows: number };

function tally(days: Map<string, DayTally>, date: string) {
  const existing = days.get(date);
  if (existing) return existing;
  const fresh: DayTally = { highs: [], lows: [], clouds: [], precipitation: 0, snow: 0, windows: 0 };
  days.set(date, fresh);
  return fresh;
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}

export function parseMetDaily(payload: unknown, now: Date): ForecastDay[] | null {
  if (!validLocationForecast(payload)) return null;
  const today = copenhagenDateKey(now);
  const days = new Map<string, DayTally>();
  // The end of the last precipitation window already counted, so overlapping
  // six-hour windows in the hourly part of the series are not summed twice.
  let covered = 0;
  for (const entry of payload.properties.timeseries as MetEntry[]) {
    const at = Date.parse(entry.time);
    const date = copenhagenDateKey(new Date(at));
    if (date <= today) continue;
    const day = tally(days, date);
    const details = entry.data.instant.details;
    const temperature = details.air_temperature;
    if (finite(temperature)) { day.highs.push(temperature); day.lows.push(temperature); }
    if (finite(details.cloud_area_fraction)) day.clouds.push(details.cloud_area_fraction);
    const six = entry.data.next_6_hours?.details;
    if (finite(six?.air_temperature_max) && finite(six?.air_temperature_min)) {
      day.highs.push(six.air_temperature_max);
      day.lows.push(six.air_temperature_min);
      day.windows += 1;
    }
    if (at < covered) continue;
    const hourly = entry.data.next_1_hours?.details?.precipitation_amount;
    const amount = finite(hourly) ? hourly : six?.precipitation_amount;
    if (!finite(amount)) continue;
    day.precipitation += amount;
    day.snow += amount * frozenShare(finite(temperature) ? temperature : 10);
    covered = at + (finite(hourly) ? 1 : 6) * HOUR_MS;
  }
  const week = [...days.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).flatMap(([date, day]): ForecastDay[] => {
    if (day.windows < SAMPLES_PER_DAY || !day.clouds.length) return [];
    const summary = {
      precipitation: round(day.precipitation),
      snow: round(day.snow),
      cloud: day.clouds.reduce((sum, value) => sum + value, 0) / day.clouds.length / 100,
    };
    return [{ date, label: weekdayLabel(date), high: Math.max(...day.highs), low: Math.min(...day.lows), ...summary, kind: describeDay(summary) }];
  }).slice(0, WEEK_DAYS);
  return week.length === WEEK_DAYS ? week : null;
}

// Preference order, as for the hours: Open-Meteo's daily aggregation first,
// MET Norway when it cannot answer. Each parser takes "now" because "today" is
// dropped at parse time and moves at Copenhagen midnight.
export type DailySourceName = 'Open-Meteo' | 'MET Norway';

export type DailySource = {
  name: DailySourceName;
  url: (latitude: number, longitude: number) => string;
  parse: (payload: unknown, now: Date) => ForecastDay[] | null;
  cache: RequestCache;
};

export const DAILY_SOURCES: DailySource[] = [
  { name: 'Open-Meteo', url: openMeteoDailyUrl, parse: parseDailyForecast, cache: 'default' },
  { name: 'MET Norway', url: metNorwayUrl, parse: parseMetDaily, cache: 'default' },
];
