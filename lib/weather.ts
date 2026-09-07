// The forecast model the display works in, and the rules that turn one hour of
// it into something to draw.
//
// `WeatherHour` is deliberately the same shape whichever provider answered, so
// the source cannot change what the display says. See lib/forecast-sources.ts
// for the providers and why there are two of them.
//
// Every condition is derived here, from physical fields, and never taken from a
// provider's own weather code or probability. The old implementation drew the
// icon from DMI's weather_code and the percentage from Open-Meteo's ensemble,
// and those are different forecasts: precipitation_probability is byte-identical
// across dmi_seamless, best_match, ecmwf_ifs025 and knmi_seamless because DMI
// publishes no probability at all. That is how a slot came to read 100% beside
// an overcast icon. Deriving both from one number makes them two views of the
// same thing rather than two forecasts.

import { bodyElevation } from './sky-arc';

export const FORECAST_LATITUDE = 55.73825;
export const FORECAST_LONGITUDE = 12.53836;

export type WeatherHour = {
  timestamp: number;
  temperature: number;
  cloud: number;
  visibility: number;
  rain: number;
  snow: number;
  precipitation: number;
};

// The boundary for hours read back from device storage. Storage is an external
// input like any other: a previous build may have written a different shape.
export function validWeatherHours(value: unknown): value is WeatherHour[] {
  if (!Array.isArray(value) || !value.length) return false;
  return value.every(hour => hour && typeof hour === 'object'
    && ['timestamp', 'temperature', 'cloud', 'rain', 'snow', 'precipitation'].every(key => Number.isFinite((hour as Record<string, unknown>)[key]))
    // Infinity does not survive JSON, so a missing visibility is read as clear.
    && ((hour as WeatherHour).visibility === null || (hour as WeatherHour).visibility === undefined || typeof (hour as WeatherHour).visibility === 'number'));
}

// Infinity does not survive JSON: an hour with no visibility limit comes back
// from storage as null, and null compares below any number, so without this
// every clear stored hour would read as fog.
export function reviveWeatherHours(hours: WeatherHour[]): WeatherHour[] {
  return hours.map(hour => ({ ...hour, visibility: typeof hour.visibility === 'number' ? hour.visibility : Infinity }));
}

export type Band = 'dry' | 'trace' | 'light' | 'moderate' | 'heavy';
export type ConditionKind = 'clear' | 'partly' | 'cloudy' | 'overcast' | 'fog' | 'drizzle' | 'rain' | 'heavy-rain' | 'sleet' | 'snow';
export type Condition = { kind: ConditionKind; label: string; band: Band; wet: boolean };

// Millimetres in one hour. WET_MM is the threshold the headline, the bars and
// the icon all share, so none of them can call an hour wet while another calls
// it dry. RIBBON_CEILING_MM fixes the bar scale: a scale derived from the
// window's own maximum would draw a 0.2 mm drizzle as a downpour.
export const WET_MM = 0.1;
export const RIBBON_CEILING_MM = 4;

export function precipitationBand(mm: number): Band {
  if (mm < WET_MM) return 'dry';
  if (mm < 0.3) return 'trace';
  if (mm < 1) return 'light';
  if (mm < RIBBON_CEILING_MM) return 'moderate';
  return 'heavy';
}

const LABELS: Record<ConditionKind, string> = {
  clear: 'Clear', partly: 'Partly cloudy', cloudy: 'Cloudy', overcast: 'Overcast', fog: 'Fog',
  drizzle: 'Drizzle', rain: 'Rain', 'heavy-rain': 'Heavy rain', sleet: 'Sleet', snow: 'Snow',
};

// One function, one hour, one answer. The icon, the label and the bar all read
// this, so the icon cannot contradict the number beside it.
export function describeHour(hour: WeatherHour): Condition {
  const band = precipitationBand(hour.precipitation);
  const kind = conditionKind(hour, band);
  return { kind, label: LABELS[kind], band, wet: band !== 'dry' };
}

// The two readings the hours and the days share, so the card and the week
// strip cannot disagree about what counts as snow or as overcast. They were
// written out in both files with the same five numbers.
//
// What falls, by the frozen share of the total: snow from seven tenths up,
// sleet from a fifth, rain below that. Null when nothing is frozen enough to
// change the kind, so the caller can grade the rain by amount.
export function frozenKind(snow: number, precipitation: number): 'snow' | 'sleet' | null {
  if (snow >= precipitation * 0.7) return 'snow';
  if (snow >= precipitation * 0.2) return 'sleet';
  return null;
}

// The sky, by cloud fraction.
export function cloudKind(cloud: number): 'clear' | 'partly' | 'cloudy' | 'overcast' {
  if (cloud < 0.2) return 'clear';
  if (cloud < 0.55) return 'partly';
  if (cloud < 0.85) return 'cloudy';
  return 'overcast';
}

function conditionKind(hour: WeatherHour, band: Band): ConditionKind {
  if (band !== 'dry') {
    const frozen = frozenKind(hour.snow, hour.precipitation);
    if (frozen) return frozen;
    if (band === 'heavy') return 'heavy-rain';
    if (band === 'trace') return 'drizzle';
    return 'rain';
  }
  if (hour.visibility < 1000) return 'fog';
  return cloudKind(hour.cloud);
}

// DMI carries no day/night flag, so the sun's elevation is computed instead of
// spending a second request on it. The formulae themselves live in
// lib/sky-arc.ts, which needs the same ones to place the disc on the weather
// card and needs the moon's besides. This is the defaulted front door to them:
// everything here is about one place, and passing its coordinates at every
// call site would be noise.
export function solarElevation(timestamp: number, latitude = FORECAST_LATITUDE, longitude = FORECAST_LONGITUDE) {
  return bodyElevation('sun', timestamp, latitude, longitude);
}

// -0.833 degrees is the standard sunrise/sunset elevation: the solar radius
// plus atmospheric refraction at the horizon.
export function isDaylight(timestamp: number, latitude = FORECAST_LATITUDE, longitude = FORECAST_LONGITUDE) {
  return solarElevation(timestamp, latitude, longitude) > -0.833;
}
