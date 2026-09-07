// MET Norway Locationforecast 2.0, `complete` product.
//
// A different model (MEPS/ECMWF blend), so an outage or a quota shared by the
// two DMI routes does not take it down. Its terms of service ask three things
// of a browser client, and each is met here: identification by the Origin
// header, which the browser sends on its own; coordinates truncated to four
// decimals; and no request before the Expires header allows, which the
// browser's HTTP cache enforces when the fetch is not marked no-store.
//
// One provider, one module. The hourly parser serves the weather card
// (lib/forecast-sources.ts) and the daily aggregation in lib/daily-forecast.ts
// reads the same response for the week strip, so the two components share one
// cached answer rather than paying for two. The URL, the validator and the
// frozen-share rule were split across those two files before, and the test
// named a module that did not exist.
//
// MET reports one precipitation amount with no rain/snow split and no
// visibility. The frozen share is read from the air temperature instead, and
// fog from its fog_area_fraction. Both are approximations, documented as such,
// and only ever on screen when the two DMI routes have already failed.

import type { WeatherHour } from './weather';

const MET_LOCATIONFORECAST = 'https://api.met.no/weatherapi/locationforecast/2.0/complete';

type MetDetails = Record<string, unknown>;
export type MetEntry = {
  time: string;
  data: {
    instant: { details: MetDetails };
    next_1_hours?: { details?: MetDetails };
    next_6_hours?: { details?: MetDetails };
  };
};
export type LocationForecast = { properties: { timeseries: MetEntry[] } };

export function metNorwayUrl(latitude: number, longitude: number) {
  // "Truncate all coordinates to max 4 decimals": more than that is throttled.
  const query = new URLSearchParams({ lat: latitude.toFixed(4), lon: longitude.toFixed(4) });
  return MET_LOCATIONFORECAST + '?' + query.toString();
}

export function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function validLocationForecast(value: unknown): value is LocationForecast {
  const series = (value as LocationForecast | null)?.properties?.timeseries;
  if (!Array.isArray(series) || series.length < 2) return false;
  return series.every(entry => entry && typeof entry === 'object'
    && typeof entry.time === 'string' && Number.isFinite(Date.parse(entry.time))
    && entry.data && typeof entry.data === 'object'
    && entry.data.instant && typeof entry.data.instant === 'object'
    && entry.data.instant.details && typeof entry.data.instant.details === 'object');
}

// What part of an amount falls frozen, by air temperature: all of it at or
// below freezing, half of it (sleet) up to two degrees, none above. Shared
// with the daily aggregation so a day and its hours cannot disagree.
export function frozenShare(temperature: number) {
  if (temperature <= 0) return 1;
  if (temperature <= 2) return 0.5;
  return 0;
}

// Fog is a fraction of the area, not a visibility. Half or more reads as fog,
// which conditionKind() recognises as visibility under a kilometre.
const FOG_VISIBILITY = 500;

export function parseLocationForecast(payload: unknown): WeatherHour[] | null {
  if (!validLocationForecast(payload)) return null;
  return payload.properties.timeseries.flatMap(entry => {
    const details = entry.data.instant.details;
    const amount = entry.data.next_1_hours?.details?.precipitation_amount;
    const temperature = details.air_temperature;
    const cloud = details.cloud_area_fraction;
    // Hourly amounts run about two and a half days ahead; the six-hourly tail
    // after that is not hourly data and is left to the week strip.
    if (!finite(amount) || !finite(temperature) || !finite(cloud)) return [];
    const fog = finite(details.fog_area_fraction) ? details.fog_area_fraction : 0;
    const snow = amount * frozenShare(temperature);
    return [{
      timestamp: Date.parse(entry.time),
      temperature,
      cloud: cloud / 100,
      visibility: fog >= 50 ? FOG_VISIBILITY : Infinity,
      rain: amount - snow,
      snow,
      precipitation: amount,
    }];
  });
}
