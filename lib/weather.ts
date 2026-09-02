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

function conditionKind(hour: WeatherHour, band: Band): ConditionKind {
  if (band !== 'dry') {
    if (hour.snow >= hour.precipitation * 0.7) return 'snow';
    if (hour.snow >= hour.precipitation * 0.2) return 'sleet';
    if (band === 'heavy') return 'heavy-rain';
    if (band === 'trace') return 'drizzle';
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
