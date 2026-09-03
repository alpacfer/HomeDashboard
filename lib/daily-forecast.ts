// The week ahead: one line per day, deliberately thin. A wall display wants
// "is the weekend wet" and "is it getting colder", not a table.
//
// The pinned panel's DMI Harmonie run only reaches about two and a half days,
// so the week comes from Open-Meteo's daily aggregation of its default model
// blend instead. It is a different forecast from the ribbon, and the two are
// never mixed: the ribbon says what the next hours do, the week says what the
// days after tomorrow look like. As with the hourly data, no weather code or
// probability is requested: the condition is derived here from the day's own
// cloud cover and precipitation, so the icon and the amount cannot disagree.

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
