// Google Weather API, which has served WeatherNext 3 since 3 September 2026.
//
// This is the only route to WeatherNext a display can take. The model's raw
// output lives in BigQuery, Earth Engine and a Zarr bucket on Cloud Storage,
// all of which want service-account credentials and a machine to do the
// reading; weather.googleapis.com is the one surface that answers a single
// point query over HTTPS.
//
// It is asked through app/api/weather/route.ts and not from the browser. The
// endpoint does send an open CORS header and will answer a fetch from any
// origin, but the key would have to travel with it, and a key inlined into the
// client bundle is a key anyone reading the page can spend.
// scripts/check-rules.mjs refuses NEXT_PUBLIC_*KEY* for that reason and names
// the remedy: read it in a route handler instead. That is the same shape
// app/api/departures/route.ts already has for REJSEPLANEN_ACCESS_ID, and the
// display keeps that route awake every two minutes anyway, so proxying the
// weather costs no extra wake-ups on Render's free plan.
//
// WeatherNext 3 is a 5 km global model initialised hourly. DMI Harmonie, which
// it now leads, is a 2 km national one. On a Danish location that is not a
// straight upgrade in resolution, and the reason to put it first is the
// precipitation skill Google claims for it, which is the thing this display
// asks of a forecast most often. The three providers in lib/forecast-sources.ts
// are unchanged behind it.
//
// ---------------------------------------------------------------------------
// What it costs, and why the request is shaped the way it is.
//
// The free tier is 10,000 calls a month against the Weather Usage SKU, and a
// page is a call. `hours` caps pageSize at 24, so asking for the 72 hours the
// other providers hand back in one response would cost three calls every
// refresh — 8,760 a month — and leave nothing for the week. The card only ever
// draws RIBBON_HOURS of them (18, lib/forecast-summary.ts), so one 24-hour
// page is asked for instead and the display's spend is
//
//   card   96 refreshes a day  x 1 call  =  2,920 a month
//   week   24 refreshes a day  x 1 call  =    730 a month
//
// about a third of the tier, with the rest left for development. `days` caps
// pageSize at 10 and the strip needs at most nine of them, so the week is one
// call regardless and GOOGLE_DAYS simply asks for the maximum.
//
// The price of the short window is resilience: when every provider is down the
// stored forecast is all there is, and 24 hours of it runs out sooner than 72
// would. The three providers behind this one are what covers that.
// ---------------------------------------------------------------------------

import { type WeatherHour } from './weather';

export const GOOGLE_WEATHER_API = 'https://weather.googleapis.com/v1/';

// One page of each, so neither ever costs two calls. See the arithmetic above.
export const GOOGLE_HOURS = 24;
// Ten, which is the endpoint's maximum and costs the same one call as eight,
// because the week needs margin at both ends and eight leaves none.
//
// Google's day is not a calendar day. A ForecastDay runs 07:00 to 07:00 local
// (verified: displayDate 2026-09-05 spans 05:00Z to 05:00Z, which is 07:00 to
// 07:00 in Copenhagen), and the first day it returns is the window that
// contains now. So between Copenhagen midnight and 07:00 the first day is
// still yesterday's date, `parseGoogleDaily` drops two days rather than one,
// and eight days leave six — one short of the week, which is no week at all.
// The strip then fell through to Open-Meteo for seven hours every night and
// spent a Google call an hour finding that out. Ten days leave the margin.
//
// The 07:00 boundary also means a Google day and an Open-Meteo day are not
// quite the same day. That is left alone: the strip is deliberately thin, the
// two are never mixed in one row, and the highs and lows land within a degree
// of the other providers (checked against Open-Meteo and MET Norway).
export const GOOGLE_DAYS = 10;

export type GoogleKind = 'hours' | 'days';

export function isGoogleKind(value: unknown): value is GoogleKind {
  return value === 'hours' || value === 'days';
}

// What the browser asks for. Same origin, no key, and no coordinates: the
// route forecasts one fixed location and ignores anything the caller says
// about where, so the endpoint cannot be pointed at the rest of the planet by
// anyone who finds it and spend the key's quota doing it.
export function googleRoutePath(kind: GoogleKind) {
  return '/api/weather?kind=' + kind;
}

// What the route asks Google for. The key is a query parameter, so this string
// is a credential: it must never be logged, echoed into an error, or returned.
export function googleUpstreamUrl(kind: GoogleKind, latitude: number, longitude: number, key: string) {
  const query = new URLSearchParams({
    key,
    'location.latitude': String(latitude),
    'location.longitude': String(longitude),
    unitsSystem: 'METRIC',
    // pageSize matches the window in both cases: a second page would be a
    // second billable call. 24 and 10 are the endpoints' own maximums.
    ...kind === 'hours'
      ? { hours: String(GOOGLE_HOURS), pageSize: String(GOOGLE_HOURS) }
      : { days: String(GOOGLE_DAYS), pageSize: String(GOOGLE_DAYS) },
  });
  return GOOGLE_WEATHER_API + 'forecast/' + kind + ':lookup?' + query.toString();
}

// ---------------------------------------------------------------------------
// Reading the payload.
//
// Units are requested as METRIC and then checked rather than assumed. Every
// measurement arrives as a number beside the name of its unit, so a response
// that came back in Fahrenheit would otherwise be drawn as a mild afternoon. A
// field whose unit is not the expected one is refused, and the hour or day
// holding it is dropped.
//
// `qpf` and `snowQpf` are both liquid water equivalents, and the schema calls
// the first rain and the second snow, so an hour's total is the sum. `snowQpf`
// is absent altogether from an hour with no snow — every example Google
// publishes is a dry hour carrying `qpf` alone — so a missing one reads as
// zero rather than as a broken payload. What the documentation cannot settle
// is whether `qpf` quietly includes the snow in a mixed hour, which would
// double-count it. `npm run probe` prints both fields for every hour it
// fetches, so the winter's first sleet settles it against DMI's own split.
// ---------------------------------------------------------------------------

type Measurement = { unit?: unknown } & Record<string, unknown>;

function measured(value: unknown, field: string, unit: string): number | null {
  if (!value || typeof value !== 'object') return null;
  const measurement = value as Measurement;
  if (measurement.unit !== unit) return null;
  const reading = measurement[field];
  return typeof reading === 'number' && Number.isFinite(reading) ? reading : null;
}

export function celsius(value: unknown) {
  return measured(value, 'degrees', 'CELSIUS');
}

export function millimetres(value: unknown) {
  return measured(value, 'quantity', 'MILLIMETERS');
}

// An amount that is allowed to be missing, which is how a dry hour arrives.
// Absent is zero; present in the wrong unit is still a refusal.
function optionalMillimetres(value: unknown) {
  return value === undefined || value === null ? 0 : millimetres(value);
}

// Cloud cover is a whole percent, and the rest of this codebase works in
// fractions.
function percent(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value / 100 : null;
}

// Google reports visibility in kilometres; every other provider here reports
// metres, and lib/weather.ts compares against metres. A missing visibility is
// no limit rather than no data, which is how the DMI parser reads it too.
const KM = 1000;

function visibilityMetres(value: unknown) {
  if (value === undefined || value === null) return Infinity;
  const distance = measured(value, 'distance', 'KILOMETERS');
  return distance === null ? null : distance * KM;
}

type Precipitation = { qpf?: unknown; snowQpf?: unknown };

function fell(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const { qpf, snowQpf } = value as Precipitation;
  const rain = millimetres(qpf);
  const snow = optionalMillimetres(snowQpf);
  if (rain === null || snow === null) return null;
  return { rain, snow, precipitation: rain + snow };
}

type ForecastHour = {
  interval?: { startTime?: unknown };
  temperature?: unknown;
  cloudCover?: unknown;
  visibility?: unknown;
  precipitation?: unknown;
};
type HoursResponse = { forecastHours?: unknown };

export function validGoogleHours(value: unknown): value is { forecastHours: ForecastHour[] } {
  const hours = (value as HoursResponse | null)?.forecastHours;
  return Array.isArray(hours) && hours.length > 0 && hours.every(hour => hour && typeof hour === 'object');
}

export function parseGoogleHours(payload: unknown): WeatherHour[] | null {
  if (!validGoogleHours(payload)) return null;
  return payload.forecastHours.flatMap((hour): WeatherHour[] => {
    const start = hour.interval?.startTime;
    const timestamp = typeof start === 'string' ? Date.parse(start) : NaN;
    const temperature = celsius(hour.temperature);
    const cloud = percent(hour.cloudCover);
    const visibility = visibilityMetres(hour.visibility);
    const amounts = fell(hour.precipitation);
    if (!Number.isFinite(timestamp) || temperature === null || cloud === null || visibility === null || !amounts) return [];
    return [{ timestamp, temperature, cloud, visibility, ...amounts }];
  });
}

// ---------------------------------------------------------------------------
// The week. A day arrives split into a daytime and a nighttime half, each with
// its own cloud cover and precipitation, and the extremes are reported for the
// day as a whole. So the day's total is the two halves added and its cloud
// cover is their mean; a day missing either half is incomplete and is dropped
// rather than drawn at half its rain.
//
// `displayDate` is the civil date at the location, which for this display is
// Copenhagen, so it is used verbatim and never passed through the device's
// time zone.
// ---------------------------------------------------------------------------

export type GoogleDay = {
  date: string;
  high: number;
  low: number;
  precipitation: number;
  snow: number;
  cloud: number;
};

type DayPart = { cloudCover?: unknown; precipitation?: unknown };
type ForecastDay = {
  displayDate?: { year?: unknown; month?: unknown; day?: unknown };
  maxTemperature?: unknown;
  minTemperature?: unknown;
  daytimeForecast?: DayPart;
  nighttimeForecast?: DayPart;
};
type DaysResponse = { forecastDays?: unknown };

export function validGoogleDays(value: unknown): value is { forecastDays: ForecastDay[] } {
  const days = (value as DaysResponse | null)?.forecastDays;
  return Array.isArray(days) && days.length > 0 && days.every(day => day && typeof day === 'object');
}

function whole(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function dateKey(displayDate: ForecastDay['displayDate']) {
  const year = whole(displayDate?.year);
  const month = whole(displayDate?.month);
  const day = whole(displayDate?.day);
  if (year === null || month === null || day === null) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}

function half(part: DayPart | undefined) {
  if (!part || typeof part !== 'object') return null;
  const cloud = percent(part.cloudCover);
  const amounts = fell(part.precipitation);
  return cloud === null || !amounts ? null : { cloud, ...amounts };
}

export function parseGoogleDays(payload: unknown): GoogleDay[] | null {
  if (!validGoogleDays(payload)) return null;
  return payload.forecastDays.flatMap((entry): GoogleDay[] => {
    const date = dateKey(entry.displayDate);
    const high = celsius(entry.maxTemperature);
    const low = celsius(entry.minTemperature);
    const day = half(entry.daytimeForecast);
    const night = half(entry.nighttimeForecast);
    if (date === null || high === null || low === null || !day || !night) return [];
    return [{
      date,
      high,
      low,
      precipitation: day.precipitation + night.precipitation,
      snow: day.snow + night.snow,
      cloud: (day.cloud + night.cloud) / 2,
    }];
  });
}
