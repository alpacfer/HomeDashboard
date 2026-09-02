export type Weather = {
  current: { temperature_2m: number; weather_code: number; is_day: number };
  hourly: {
    time: number[];
    temperature_2m: number[];
    weather_code: number[];
    is_day: number[];
    precipitation_probability: (number | null)[];
  };
};

export type ForecastTarget = { date: string; day: 'today' | 'tomorrow' };

// Keep the pinned weather compact enough to stay within the 16:9 display. Both
// days use the same working-hours window so the block never grows at midnight
// or late at night.
const WORKDAY_START_HOUR = 6;
const WORKDAY_END_HOUR = 18;

const localFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
});

export function localTime(date: Date) {
  const parts = Object.fromEntries(localFormat.formatToParts(date).map(part => [part.type, part.value]));
  return { date: parts.year + '-' + parts.month + '-' + parts.day, hour: Number(parts.hour) };
}

function nextDate(date: string) {
  const next = new Date(date + 'T12:00:00Z');
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

export function forecastTargets(now: Date): ForecastTarget[] {
  const local = localTime(now);
  const targets: ForecastTarget[] = [{ date: local.date, day: 'today' }];
  // At the end of today's visible window there is no useful empty state: move
  // directly to tomorrow so the pinned panel always shows a forecast period.
  if (local.hour >= WORKDAY_END_HOUR) targets.push({ date: nextDate(local.date), day: 'tomorrow' });
  return targets;
}

export function validWeather(value: unknown): value is Weather {
  const data = value as Weather | null;
  if (!data?.current || !data.hourly) return false;
  if (![data.current.temperature_2m, data.current.weather_code, data.current.is_day].every(Number.isFinite)) return false;
  const hourly = data.hourly;
  if (!Array.isArray(hourly.time) || hourly.time.length === 0) return false;
  if (![hourly.time, hourly.temperature_2m, hourly.weather_code, hourly.is_day].every(array => Array.isArray(array) && array.length === hourly.time.length && array.every(Number.isFinite))) return false;
  return Array.isArray(hourly.precipitation_probability)
    && hourly.precipitation_probability.length === hourly.time.length
    && hourly.precipitation_probability.every(p => p === null || (Number.isFinite(p) && p >= 0 && p <= 100));
}

function isVisibleHour(hour: number) {
  return hour >= WORKDAY_START_HOUR && hour <= WORKDAY_END_HOUR;
}

export function isRainCode(code: number) {
  return (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95;
}

export function buildForecast(weather: Weather, now: Date, target: ForecastTarget) {
  const { hourly } = weather;
  const rows = hourly.time.flatMap((timestamp, index) => {
    const local = localTime(new Date(timestamp * 1000));
    if (local.date !== target.date || !isVisibleHour(local.hour) || (target.day === 'today' && timestamp * 1000 <= now.getTime())) return [];
    return [{ timestamp, index, hour: local.hour, temperature: hourly.temperature_2m[index], code: hourly.weather_code[index], day: hourly.is_day[index] === 1 }];
  });

  if (!rows.length) return target.day === 'today' ? { ...target, slots: [] } : null;

  const selected = rows.filter((row, index) => index === 0 || row.hour % 2 === 0 || index === rows.length - 1);
  const slots = selected.map((row, slotIndex) => {
    const nextIndex = selected[slotIndex + 1]?.index ?? row.index + 1;
    const probabilities = hourly.precipitation_probability.slice(row.index, nextIndex).flatMap(value => typeof value === 'number' ? [value] : []);
    return {
      timestamp: row.timestamp,
      label: row.hour + ':00',
      code: row.code,
      day: row.day,
      temperature: row.temperature,
      rain: probabilities.length ? Math.max(...probabilities) : null,
    };
  });
  return { ...target, slots };
}

export function buildForecasts(weather: Weather, now: Date) {
  const forecasts = forecastTargets(now).flatMap(target => {
    const forecast = buildForecast(weather, now, target);
    return forecast ? [forecast] : [];
  });
  // When today's last visible hour has passed, suppress its empty placeholder
  // rather than briefly rendering an empty today state before tomorrow.
  const today = forecasts.find(forecast => forecast.day === 'today');
  const tomorrow = forecasts.find(forecast => forecast.day === 'tomorrow');
  return today?.slots.length === 0 && tomorrow ? forecasts.filter(forecast => forecast.day !== 'today') : forecasts;
}
