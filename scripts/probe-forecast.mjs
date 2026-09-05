// Ask every forecast provider the display uses, exactly as the browser would,
// and run each answer through the project's own parsers. This is the first
// thing to run when the weather card is muted or blank: it says which provider
// is refusing, why, and whether what comes back still parses.
//
// Run with `npm run probe`. It imports lib/ through tsx, so a parser change is
// probed as written. The forecast-map grid is NOT requested unless --grid is
// passed: one grid request is about three hundred coordinates and Open-Meteo
// counts every one of them against the daily quota this machine shares with
// the display (see docs/DEBUGGING.md).
//
// Google is asked only when GOOGLE_WEATHER_API_KEY is in the environment, the
// same way scripts/probe-transit.mjs treats REJSEPLANEN_ACCESS_ID. Without it
// the line says so and the run carries on: that is exactly what the display
// does. The key is never printed.

import { SOURCES } from '../lib/forecast-sources.ts';
import { googleUpstreamUrl } from '../lib/google-weather.ts';
import { FORECAST_LATITUDE, FORECAST_LONGITUDE } from '../lib/weather.ts';
import { DAILY_SOURCES } from '../lib/daily-forecast.ts';
import { MODEL_META_URL, parseModelRun } from '../lib/forecast-refresh.ts';
import { buildRibbon } from '../lib/forecast-summary.ts';
import { DEFAULT_GRID, parsePrecipitationGrid, precipitationGridUrl } from '../lib/precipitation-grid.ts';
import { callWeight, describeLockout, EXPECTED_DAY, expectedDailySpend, OPEN_METEO_LIMITS, refusalLockout } from '../lib/open-meteo-quota.ts';

const withGrid = process.argv.includes('--grid');
const now = new Date();
// Google is asked directly rather than through /api/weather, which only exists
// while the dev server is running. That means the key travels in the query
// string here, so nothing printed goes out without being scrubbed first.
const googleKey = process.env.GOOGLE_WEATHER_API_KEY;
const scrub = text => googleKey ? String(text).replaceAll(googleKey, '***') : String(text);

function sourceUrl(source, kind) {
  if (source.name !== 'Google') return source.url(FORECAST_LATITUDE, FORECAST_LONGITUDE);
  return googleKey ? googleUpstreamUrl(kind, FORECAST_LATITUDE, FORECAST_LONGITUDE, googleKey) : null;
}

// What the display cannot tell you from a screenshot: whether Google's `qpf`
// is the rain alone or the hour's whole total. lib/google-weather.ts adds
// `snowQpf` to it on the strength of the schema calling one rain and the other
// snow, and the first hour that carries both settles it against DMI's split.
function precipitationFields(body) {
  const wet = (body?.forecastHours ?? []).filter(hour => hour?.precipitation?.qpf?.quantity || hour?.precipitation?.snowQpf?.quantity);
  if (!wet.length) return 'every hour dry, so qpf and snowQpf cannot be compared yet';
  return 'raw ' + wet.slice(0, 4).map(hour => hour.interval?.startTime?.slice(11, 16)
    + ' qpf ' + (hour.precipitation.qpf?.quantity ?? '-')
    + ' snowQpf ' + (hour.precipitation.snowQpf?.quantity ?? '-')).join(', ');
}
// The browser cannot set its User-Agent, but a script should identify itself.
const headers = { 'User-Agent': 'HomeDashboard probe (https://github.com/alejandro/HomeDashboard)', Origin: 'http://127.0.0.1:3000' };

async function probe(label, url, parse, note) {
  const started = Date.now();
  let line = label.padEnd(22);
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
    const text = await response.text();
    const ms = Date.now() - started;
    let body = null;
    try { body = JSON.parse(text); } catch { /* not JSON */ }
    const parsed = response.ok && body !== null ? parse(body) : null;
    const cors = response.headers.get('access-control-allow-origin');
    line += ('HTTP ' + response.status).padEnd(10) + (ms + ' ms').padEnd(9) + (Math.round(text.length / 1024) + ' KB').padEnd(8) + 'cors ' + (cors ?? '-').padEnd(4);
    if (response.ok) line += parsed === null ? '  parse: REJECTED' : '  parsed ' + describe(parsed);
    else line += '  ' + scrub(text.replace(/\s+/g, ' ').slice(0, 110));
    const expires = response.headers.get('expires');
    if (expires) line += '  expires ' + expires;
    console.log(scrub(line));
    if (note && body !== null) console.log(''.padEnd(22) + scrub(note(body)));
    // What the display makes of a refusal: the lockout it records and shares.
    const lockout = url.includes('open-meteo.com') ? refusalLockout(response.status, text, Date.now()) : null;
    if (lockout) console.log(''.padEnd(22) + 'the display records: ' + describeLockout(lockout));
    return parsed;
  } catch (error) {
    console.log(scrub(line + 'FAILED ' + (error instanceof Error ? error.message : String(error))));
    return null;
  }
}

function describe(parsed) {
  if (Array.isArray(parsed)) return parsed.length + ' items';
  if (parsed && typeof parsed === 'object') return JSON.stringify(parsed).slice(0, 90);
  return String(parsed);
}

console.log('Forecast providers at ' + now.toISOString() + ' for ' + FORECAST_LATITUDE + ', ' + FORECAST_LONGITUDE + '\n');
let hourlyWorking = 0;
for (const source of SOURCES) {
  const url = sourceUrl(source, 'hours');
  if (!url) {
    console.log(('hourly ' + source.name).padEnd(22) + 'GOOGLE_WEATHER_API_KEY is not set, so the card falls through to DMI.');
    continue;
  }
  const hours = await probe('hourly ' + source.name, url, source.parse, source.name === 'Google' ? precipitationFields : null);
  if (hours?.length) {
    hourlyWorking += 1;
    const ribbon = buildRibbon(hours, now);
    console.log(''.padEnd(22) + 'first ' + new Date(hours[0].timestamp).toISOString() + ', last ' + new Date(hours[hours.length - 1].timestamp).toISOString() + ', ribbon ' + ribbon.length + ' h');
  }
}
console.log('');
for (const source of DAILY_SOURCES) {
  const url = sourceUrl(source, 'days');
  if (!url) {
    console.log(('week ' + source.name).padEnd(22) + 'GOOGLE_WEATHER_API_KEY is not set, so the strip falls through to Open-Meteo.');
    continue;
  }
  const week = await probe('week ' + source.name, url, body => source.parse(body, now));
  if (week) console.log(''.padEnd(22) + week.map(day => day.label + ' ' + Math.round(day.high) + '/' + Math.round(day.low) + ' ' + day.kind).join(', '));
}
console.log('');
await probe('map run metadata', MODEL_META_URL, parseModelRun);
const points = DEFAULT_GRID.columns * DEFAULT_GRID.rows;
if (withGrid) {
  await probe('map grid (' + points + ' pts)', precipitationGridUrl(DEFAULT_GRID), body => parsePrecipitationGrid(body, DEFAULT_GRID, null, Date.now()));
} else {
  console.log('map grid'.padEnd(22) + 'not requested: ' + points + ' coordinates would count as ' + points + ' Open-Meteo calls. Pass --grid to ask anyway.');
}
const spend = expectedDailySpend(points);
console.log('\nQuota: Open-Meteo allows ' + OPEN_METEO_LIMITS.day + ' weighted calls a day and ' + OPEN_METEO_LIMITS.minute
  + ' a minute per client address (lib/open-meteo-quota.ts). One grid of ' + points + ' points weighs ' + callWeight({ locations: points, days: 0.5, variables: 1 })
  + '; a day of the display weighs about ' + Math.round(spend.total) + ' (' + spend.grid + ' for ' + EXPECTED_DAY.gridFetches + ' grid fetches, '
  + spend.hours + ' hourly, ' + spend.week + ' daily). Every extra load of the map scene from this address adds ' + points + '.');
if (!hourlyWorking) {
  console.error('\nNo hourly provider is answering. The card will show its last stored forecast, muted.');
  process.exit(1);
}
