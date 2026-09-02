// Where the hours come from. DMI first, Open-Meteo behind it.
//
// Both are the same forecast. Open-Meteo's `dmi_seamless` is the DMI Harmonie
// run, verified field by field against a direct capture from DMI's own EDR API:
// cloud 0.82/0.99 against 82/99, visibility 5969/5870 against 5960/5880,
// temperatures identical. So the fallback is not a downgrade in data, only in
// directness.
//
// The reason for a fallback at all: DMI's own endpoint enforces a fair-use limit
// of 500 requests per 5 seconds shared across every caller and answers 429 when
// busy rather than queueing. During their supercomputer maintenance it answered
// 429 to everything for hours, which left this display with no forecast at all.
// A screen nobody reloads cannot depend on a single upstream.
//
// Both parsers return the identical WeatherHour shape, so which provider
// answered never changes what the display says. Only the credit line differs.

import { type WeatherHour } from './weather';

export type SourceName = 'DMI' | 'Open-Meteo';

export type Source = {
  name: SourceName;
  attribution: { href: string; credit: string };
  url: (latitude: number, longitude: number) => string;
  parse: (payload: unknown) => WeatherHour[] | null;
};

function samples(value: unknown, length: number) {
  if (!Array.isArray(value) || value.length !== length) return null;
  return value.every(sample => sample === null || Number.isFinite(sample)) ? value as (number | null)[] : null;
}

// ---------------------------------------------------------------------------
// DMI Open Data, Harmonie DINI SF, forecast EDR position query.
//
// opendataapi.dmi.dk needs no API key and sends an open CORS header, so the
// browser can call it directly and no proxy route is needed. The older
// dmigw.govcloud.dk host still requires a key; do not switch to it.
//
// Its precipitation fields are accumulated since the model run started, in
// kg/m2 (= mm), even though the collection metadata declares them as a rate in
// kg m-2 s-1. Hourly amounts come from differencing consecutive steps, verified
// against Open-Meteo's DMI precipitation for the same hour. Reading them as a
// rate puts four-digit millimetre values on screen, and assigning a difference
// to the later step shifts every rain hour one hour late.
//
// precipitation-type is not requested: DMI leaves it null in hours carrying
// several millimetres of rain, so it cannot be used to decide whether an hour
// is wet, and amount alone already decides that. probability-of-lightning is
// not requested either, having read 8 to 75 percent across a rain-free
// overcast day.
// ---------------------------------------------------------------------------

const DMI_INSTANT = ['temperature-2m', 'fraction-of-cloud-cover', 'visibility'] as const;
const DMI_ACCUMULATED = ['rain-precipitation-rate', 'total-snowfall-rate-water-equivalent', 'graupel-precipitation-rate'] as const;

type Coverage = {
  domain: { axes: { t: { values: string[] } } };
  ranges: Record<string, { values: (number | null)[] }>;
};

export function dmiUrl(latitude: number, longitude: number) {
  const query = new URLSearchParams({
    coords: 'POINT(' + longitude + ' ' + latitude + ')',
    crs: 'crs84',
    'parameter-name': [...DMI_INSTANT, ...DMI_ACCUMULATED].join(','),
  });
  return 'https://opendataapi.dmi.dk/v1/forecastedr/collections/harmonie_dini_sf/position?' + query.toString();
}

export function validCoverage(value: unknown): value is Coverage {
  const times = (value as Coverage | null)?.domain?.axes?.t?.values;
  if (!Array.isArray(times) || times.length < 2) return false;
  if (!times.every(time => typeof time === 'string' && Number.isFinite(Date.parse(time)))) return false;
  const ranges = (value as Coverage).ranges;
  if (!ranges || typeof ranges !== 'object') return false;
  return [...DMI_INSTANT, ...DMI_ACCUMULATED].every(name => samples(ranges[name]?.values, times.length));
}

// Accumulations only ever increase, but float storage lets a flat stretch dip
// by a thousandth of a millimetre, so clamp rather than trust the subtraction.
function fallen(values: (number | null)[], index: number) {
  const from = values[index];
  const to = values[index + 1];
  if (from === null || to === null) return null;
  return Math.max(0, to - from);
}

export function parseCoverage(payload: unknown): WeatherHour[] | null {
  if (!validCoverage(payload)) return null;
  const times = payload.domain.axes.t.values;
  const range = (name: string) => payload.ranges[name].values;
  const temperatures = range('temperature-2m');
  const clouds = range('fraction-of-cloud-cover');
  const visibilities = range('visibility');
  const rains = range('rain-precipitation-rate');
  const snows = range('total-snowfall-rate-water-equivalent');
  const graupels = range('graupel-precipitation-rate');

  // The final step has no successor to difference against, so it cannot carry
  // an hourly amount and is dropped rather than shown as dry.
  return times.slice(0, -1).flatMap((time, index) => {
    const temperature = temperatures[index];
    const cloud = clouds[index];
    const rain = fallen(rains, index);
    const snowfall = fallen(snows, index);
    const graupel = fallen(graupels, index);
    if (temperature === null || cloud === null || rain === null || snowfall === null || graupel === null) return [];
    // Graupel counts as frozen: the display distinguishes rain from snow and
    // sleet, not the exact species of ice.
    const snow = snowfall + graupel;
    return [{
      timestamp: Date.parse(time),
      temperature: temperature - 273.15,
      cloud,
      visibility: visibilities[index] ?? Infinity,
      rain, snow,
      precipitation: rain + snow,
    }];
  });
}

// ---------------------------------------------------------------------------
// Open-Meteo, dmi_seamless. Hourly totals arrive already summed, so there is
// nothing to difference.
// ---------------------------------------------------------------------------

const OPEN_METEO_FIELDS = ['temperature_2m', 'cloud_cover', 'visibility', 'precipitation', 'rain', 'showers'] as const;

type Forecast = { hourly: { time: number[] } & Record<string, (number | null)[]> };

export function openMeteoUrl(latitude: number, longitude: number) {
  const query = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    hourly: OPEN_METEO_FIELDS.join(','),
    forecast_days: '3',
    timeformat: 'unixtime',
    timezone: 'GMT',
    models: 'dmi_seamless',
  });
  return 'https://api.open-meteo.com/v1/forecast?' + query.toString();
}

export function validForecast(value: unknown): value is Forecast {
  const hourly = (value as Forecast | null)?.hourly;
  if (!hourly || typeof hourly !== 'object') return false;
  const time = hourly.time;
  if (!Array.isArray(time) || time.length < 2) return false;
  if (!time.every(stamp => Number.isFinite(stamp) && stamp > 0)) return false;
  return OPEN_METEO_FIELDS.every(field => samples(hourly[field], time.length));
}

export function parseForecast(payload: unknown): WeatherHour[] | null {
  if (!validForecast(payload)) return null;
  const { hourly } = payload;
  return hourly.time.flatMap((stamp, index) => {
    const temperature = hourly.temperature_2m[index];
    const cloud = hourly.cloud_cover[index];
    const precipitation = hourly.precipitation[index];
    const rain = hourly.rain[index];
    const showers = hourly.showers[index];
    if (temperature === null || cloud === null || precipitation === null || rain === null || showers === null) return [];
    const liquid = rain + showers;
    return [{
      timestamp: stamp * 1000,
      temperature,
      // Open-Meteo reports cloud cover as a percentage; everything else here
      // works in fractions.
      cloud: cloud / 100,
      visibility: hourly.visibility[index] ?? Infinity,
      rain: liquid,
      // `precipitation` is the water equivalent of everything that falls, so
      // what the liquid parts do not account for is frozen. `snowfall` is snow
      // depth in centimetres and is not comparable, so it is not requested.
      snow: Math.max(0, precipitation - liquid),
      precipitation,
    }];
  });
}

// Order is the preference order: DMI is asked first every time, and Open-Meteo
// only answers when DMI does not.
export const SOURCES: Source[] = [
  {
    name: 'DMI',
    attribution: { href: 'https://www.dmi.dk/friedata/dokumentation/terms-of-use', credit: 'DMI Harmonie forecast, DMI free data, CC BY 4.0.' },
    url: dmiUrl,
    parse: parseCoverage,
  },
  {
    name: 'Open-Meteo',
    attribution: { href: 'https://open-meteo.com/en/docs/dmi-api', credit: 'DMI Harmonie forecast via Open-Meteo, CC BY 4.0.' },
    url: openMeteoUrl,
    parse: parseForecast,
  },
];
