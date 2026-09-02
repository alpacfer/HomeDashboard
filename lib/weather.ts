// DMI Open Data, Harmonie DINI SF, via the EDR position endpoint.
//
// Two properties of that payload decide the shape of everything below.
//
// It is a deterministic NWP model, so it carries no WMO weather code and no
// precipitation probability: the icon has to be derived from the same numbers
// that produce the rain figure. That is deliberate. The previous Open-Meteo
// implementation drew the icon from DMI's weather code and the percentage from
// Open-Meteo's own ensemble, which are different forecasts, so a 100% reading
// next to an overcast icon was not a rendering bug but two models disagreeing.
//
// The precipitation fields are accumulated since the start of the model run,
// in kg/m2 (= mm), even though the collection metadata declares them as a rate
// in kg m-2 s-1. Hourly amounts come from differencing consecutive steps. The
// difference between step i and step i+1 is what falls during the hour that
// starts at step i, which is the hour the display labels. Reading it as a rate
// puts four-digit millimetre values on screen; assigning the difference to the
// earlier step shifts every rain hour one hour late.

export const FORECAST_LATITUDE = 55.73825;
export const FORECAST_LONGITUDE = 12.53836;

const ACCUMULATED = ['rain-precipitation-rate', 'total-snowfall-rate-water-equivalent', 'graupel-precipitation-rate'] as const;
const INSTANT = ['temperature-2m', 'fraction-of-cloud-cover', 'visibility'] as const;
// precipitation-type is a hint, not a presence signal: DMI leaves it null in
// hours that carry several millimetres of rain, so amount decides whether it is
// wet and this only refines the wording.
const OPTIONAL = ['precipitation-type'] as const;
const PARAMETERS = [...INSTANT, ...ACCUMULATED, ...OPTIONAL];

export type Coverage = {
  domain: { axes: { t: { values: string[] } } };
  ranges: Record<string, { values: (number | null)[] }>;
};

export type WeatherHour = {
  timestamp: number;
  temperature: number;
  cloud: number;
  visibility: number;
  rain: number;
  snow: number;
  graupel: number;
  precipitation: number;
  precipitationType: number | null;
};

export type Band = 'dry' | 'trace' | 'light' | 'moderate' | 'heavy';
export type ConditionKind = 'clear' | 'partly' | 'cloudy' | 'overcast' | 'fog' | 'drizzle' | 'rain' | 'heavy-rain' | 'sleet' | 'snow' | 'hail';
export type Condition = { kind: ConditionKind; label: string; band: Band; wet: boolean };

// Millimetres in one hour. WET_MM is the threshold the headline, the bars and
// the icon all share, so none of them can call an hour wet while another calls
// it dry. RIBBON_CEILING_MM fixes the bar scale: a scale derived from the
// window's own maximum would draw a 0.2 mm drizzle as a downpour.
export const WET_MM = 0.1;
export const RIBBON_CEILING_MM = 4;

export function dmiForecastUrl(latitude = FORECAST_LATITUDE, longitude = FORECAST_LONGITUDE) {
  const coords = 'POINT(' + longitude + ' ' + latitude + ')';
  const query = new URLSearchParams({ coords, crs: 'crs84', 'parameter-name': PARAMETERS.join(',') });
  return 'https://opendataapi.dmi.dk/v1/forecastedr/collections/harmonie_dini_sf/position?' + query.toString();
}

function numbers(range: unknown, length: number) {
  const values = (range as { values?: unknown } | null)?.values;
  if (!Array.isArray(values) || values.length !== length) return null;
  return values.every(value => value === null || Number.isFinite(value)) ? values as (number | null)[] : null;
}

export function validCoverage(value: unknown): value is Coverage {
  const times = (value as Coverage | null)?.domain?.axes?.t?.values;
  if (!Array.isArray(times) || times.length < 2) return false;
  if (!times.every(time => typeof time === 'string' && Number.isFinite(Date.parse(time)))) return false;
  const ranges = (value as Coverage).ranges;
  if (!ranges || typeof ranges !== 'object') return false;
  if (![...INSTANT, ...ACCUMULATED].every(name => numbers(ranges[name], times.length))) return false;
  return OPTIONAL.every(name => ranges[name] === undefined || numbers(ranges[name], times.length) !== null);
}

// Accumulations only ever increase, but float storage lets a flat stretch dip
// by a thousandth of a millimetre, so clamp rather than trust the subtraction.
function fallen(values: (number | null)[], index: number) {
  const from = values[index];
  const to = values[index + 1];
  if (from === null || to === null) return null;
  return Math.max(0, to - from);
}

export function parseHours(coverage: Coverage): WeatherHour[] {
  const times = coverage.domain.axes.t.values;
  const range = (name: string) => coverage.ranges[name]?.values ?? times.map(() => null);
  const temperatures = range('temperature-2m');
  const clouds = range('fraction-of-cloud-cover');
  const visibilities = range('visibility');
  const rains = range('rain-precipitation-rate');
  const snows = range('total-snowfall-rate-water-equivalent');
  const graupels = range('graupel-precipitation-rate');
  const types = range('precipitation-type');

  // The final step has no successor to difference against, so it cannot carry
  // an hourly amount and is dropped rather than shown as dry.
  return times.slice(0, -1).flatMap((time, index) => {
    const temperature = temperatures[index];
    const cloud = clouds[index];
    const rain = fallen(rains, index);
    const snow = fallen(snows, index);
    const graupel = fallen(graupels, index);
    if (temperature === null || cloud === null || rain === null || snow === null || graupel === null) return [];
    return [{
      timestamp: Date.parse(time),
      temperature: temperature - 273.15,
      cloud,
      visibility: visibilities[index] ?? Infinity,
      rain, snow, graupel,
      precipitation: rain + snow + graupel,
      precipitationType: types[index],
    }];
  });
}

export function precipitationBand(mm: number): Band {
  if (mm < WET_MM) return 'dry';
  if (mm < 0.3) return 'trace';
  if (mm < 1) return 'light';
  if (mm < RIBBON_CEILING_MM) return 'moderate';
  return 'heavy';
}

const LABELS: Record<ConditionKind, string> = {
  clear: 'Clear', partly: 'Partly cloudy', cloudy: 'Cloudy', overcast: 'Overcast', fog: 'Fog',
  drizzle: 'Drizzle', rain: 'Rain', 'heavy-rain': 'Heavy rain', sleet: 'Sleet', snow: 'Snow', hail: 'Hail',
};

// One function, one hour, one answer. The icon, the label and the bar all read
// this, so the icon cannot contradict the number beside it.
export function describeHour(hour: WeatherHour): Condition {
  const band = precipitationBand(hour.precipitation);
  const kind = conditionKind(hour, band);
  return { kind, label: LABELS[kind], band, wet: band !== 'dry' };
}

function conditionKind(hour: WeatherHour, band: Band): ConditionKind {
  if (band !== 'dry') {
    const frozen = hour.snow + hour.graupel;
    if (hour.precipitationType === 7 || hour.graupel > frozen / 2 && hour.graupel >= WET_MM) return 'hail';
    if (frozen >= hour.precipitation * 0.7) return 'snow';
    if (frozen >= hour.precipitation * 0.2) return 'sleet';
    if (band === 'heavy') return 'heavy-rain';
    if (hour.precipitationType === 0 || hour.precipitationType === 4 || band === 'trace') return 'drizzle';
    return 'rain';
  }
  if (hour.visibility < 1000) return 'fog';
  if (hour.cloud < 0.2) return 'clear';
  if (hour.cloud < 0.55) return 'partly';
  if (hour.cloud < 0.85) return 'cloudy';
  return 'overcast';
}

// DMI carries no day/night flag, so the sun's elevation is computed instead of
// spending a second request on it. Low-precision NOAA formulae: good to a
// fraction of a degree, which is far more than picking a sun over a moon needs.
const RADIANS = Math.PI / 180;

export function solarElevation(timestamp: number, latitude = FORECAST_LATITUDE, longitude = FORECAST_LONGITUDE) {
  const days = timestamp / 86400000 - 10957.5;
  const meanLongitude = (280.46 + 0.9856474 * days) * RADIANS;
  const meanAnomaly = (357.528 + 0.9856003 * days) * RADIANS;
  const ecliptic = meanLongitude + (1.915 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly)) * RADIANS;
  const obliquity = (23.439 - 4e-7 * days) * RADIANS;
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(ecliptic));
  const rightAscension = Math.atan2(Math.cos(obliquity) * Math.sin(ecliptic), Math.cos(ecliptic));
  const siderealTime = ((18.697374558 + 24.06570982441908 * days) % 24 * 15 + longitude) * RADIANS;
  const latitudeRadians = latitude * RADIANS;
  const elevation = Math.asin(Math.sin(latitudeRadians) * Math.sin(declination)
    + Math.cos(latitudeRadians) * Math.cos(declination) * Math.cos(siderealTime - rightAscension));
  return elevation / RADIANS;
}

// -0.833 degrees is the standard sunrise/sunset elevation: the solar radius
// plus atmospheric refraction at the horizon.
export function isDaylight(timestamp: number, latitude = FORECAST_LATITUDE, longitude = FORECAST_LONGITUDE) {
  return solarElevation(timestamp, latitude, longitude) > -0.833;
}
