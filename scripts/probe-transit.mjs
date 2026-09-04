// Ask every departure provider the display uses, exactly as the route would,
// and run each answer through the project's own parsers. This is the first
// thing to run when the boards show dashes: it says which provider is
// refusing, why, and whether what comes back still fills every board.
//
// Run with `npm run probe:transit`. It imports lib/ through tsx, so a parser
// change is probed as written. Rejseplanen is only asked when
// REJSEPLANEN_ACCESS_ID is set; the key itself is never printed.
//
//   --headsigns   Also list every headsign each stop is serving today, with
//                 the ones TRANSITOUS_HEADSIGNS does not know marked. Run it
//                 after a timetable change: an unknown headsign is a departure
//                 the fallback is silently dropping (see lib/transitous.ts).

import { LINES, filterDepartures, resolveStop } from '../lib/transit.ts';
import { TRANSITOUS_ENDPOINT, TRANSITOUS_HEADSIGNS, TRANSITOUS_STOPS, TRANSITOUS_USER_AGENT, parseStopTimes, stopTimesQuery } from '../lib/transitous.ts';

const withHeadsigns = process.argv.includes('--headsigns');
const headers = { 'User-Agent': TRANSITOUS_USER_AGENT, Accept: 'application/json' };
const clock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Copenhagen', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const stopNames = [...new Set(LINES.map(line => line.stopName))];
const pad = (value, width) => String(value).padEnd(width);

async function ask(label, url, init = {}) {
  const started = Date.now();
  try {
    const response = await fetch(url, { ...init, headers: { ...headers, ...init.headers }, signal: AbortSignal.timeout(15_000) });
    const text = await response.text();
    const ms = Date.now() - started;
    console.log(pad(label, 40) + pad('HTTP ' + response.status, 10) + pad(ms + ' ms', 9) + pad(Math.round(text.length / 1024) + ' KB', 8));
    if (!response.ok) { console.log(pad('', 40) + text.replace(/\s+/g, ' ').slice(0, 110)); return null; }
    try { return JSON.parse(text); } catch { console.log(pad('', 40) + 'parse: NOT JSON'); return null; }
  } catch (error) {
    console.log(pad(label, 40) + 'FAILED    ' + error.message);
    return null;
  }
}

// What the display would draw from one provider's answer.
function report(boards) {
  for (const line of LINES) for (const direction of line.directions) {
    const board = boards[line.id + ':' + direction.key] ?? [];
    const shown = board.slice(0, 3).map(departure => {
      const marks = [];
      if (departure.cancelled) marks.push('CANCELLED');
      if (departure.delay > 0) marks.push('+' + departure.delay);
      if (departure.delay < 0) marks.push(departure.delay + ' early');
      if (departure.track && departure.scheduledTrack && departure.track !== departure.scheduledTrack) marks.push('track ' + departure.scheduledTrack + '->' + departure.track);
      for (const alert of departure.alerts) marks.push(alert.severity + ': ' + alert.text);
      return clock.format(new Date(departure.expected)) + (departure.realtime ? '*' : ' ') + (marks.length ? ' [' + marks.join(', ') + ']' : '');
    });
    const live = board.filter(departure => departure.realtime).length;
    console.log('  ' + pad(line.id + ' ' + direction.key, 14) + pad(board.length + ' found', 10) + pad(live + ' live', 9) + (shown.join('   ') || 'nothing to show'));
  }
  console.log('  * = realtime. Rejseplanen flags nearly every departure; the fallback about half.');
}

console.log('Stops: ' + stopNames.join(', ') + '\n');

// 1. Transitous, the keyless fallback. Always probed: it is what answers when
//    there is no access ID, and its stop ids are hardcoded, so this is also
//    how they are checked against the geocoder.
console.log('--- Transitous (fallback, no key) ---');
const fallbackBoards = {};
let fallbackOk = true;
for (const name of stopNames) {
  const id = TRANSITOUS_STOPS[name];
  const geocode = await ask('geocode ' + name, 'https://api.transitous.org/api/v1/geocode?' + new URLSearchParams({ text: name, language: 'da' }));
  const match = Array.isArray(geocode) ? geocode.find(entry => entry.type === 'STOP' && entry.name === name) : null;
  if (!match) console.log(pad('', 40) + 'the geocoder does not return this exact stop name');
  else if (match.id !== id) console.log(pad('', 40) + 'STOP ID CHANGED: configured ' + id + ', geocoder says ' + match.id);
  else console.log(pad('', 40) + 'stop id ' + id + ' confirmed');

  const url = TRANSITOUS_ENDPOINT + '?' + new URLSearchParams(stopTimesQuery(id));
  const payload = await ask('stoptimes ' + name, url);
  if (!payload) { fallbackOk = false; continue; }
  const now = Date.now();
  for (const line of LINES.filter(item => item.stopName === name)) for (const direction of line.directions) {
    try { fallbackBoards[line.id + ':' + direction.key] = parseStopTimes(payload, name, line.id, direction.key, now); }
    catch (error) { console.log(pad('', 40) + 'parse REJECTED: ' + error.message); fallbackOk = false; }
  }
  if (withHeadsigns) {
    const known = new Set(LINES.filter(item => item.stopName === name)
      .flatMap(line => line.directions.flatMap(direction => TRANSITOUS_HEADSIGNS[line.id + ':' + direction.key] ?? [])));
    const wanted = new Set(LINES.filter(item => item.stopName === name).map(line => line.id));
    const seen = new Map();
    for (const entry of payload.stopTimes ?? []) {
      if (!wanted.has(entry.routeShortName)) continue;
      const key = entry.routeShortName + ' -> ' + entry.headsign;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    for (const [key, count] of [...seen].sort()) {
      const headsign = key.split(' -> ')[1];
      console.log('  ' + pad(count, 4) + pad(key, 46) + (known.has(headsign) ? '' : 'NOT IN TRANSITOUS_HEADSIGNS: these departures are dropped'));
    }
  }
}
report(fallbackBoards);

// 2. Rejseplanen, the primary. Skipped without a key, which is the normal
//    state until one has been granted (see docs/TRANSPORT.md).
console.log('\n--- Rejseplanen API 2.0 (primary) ---');
const key = process.env.REJSEPLANEN_ACCESS_ID;
if (!key) {
  console.log('REJSEPLANEN_ACCESS_ID is not set, so the route serves the fallback above.');
  console.log('Request one at https://labs.rejseplanen.dk (free, non-commercial, 50,000 calls a month).');
} else {
  const primaryBoards = {};
  for (const name of stopNames) {
    const search = params => 'https://www.rejseplanen.dk/api/' + params;
    const located = await ask('location.name ' + name, search('location.name?' + new URLSearchParams({ accessId: key, format: 'json', lang: 'da', input: name, type: 'S', maxNo: '20', withMastNames: '0' })));
    if (!located) continue;
    let id;
    try { id = resolveStop(located, name); console.log(pad('', 40) + 'resolved to ' + id); }
    catch (error) { console.log(pad('', 40) + 'resolve REJECTED: ' + error.message); continue; }
    const lines = LINES.filter(line => line.stopName === name);
    const board = await ask('departureBoard ' + name, search('departureBoard?' + new URLSearchParams({ accessId: key, format: 'json', lang: 'da', id, lines: lines.map(line => line.id).join(','), duration: '1439', maxJourneys: '-1', type: 'DEP_STATION', rtMode: 'SERVER_DEFAULT' })));
    if (!board) continue;
    const raw = board.Departure === undefined ? [] : Array.isArray(board.Departure) ? board.Departure : [board.Departure];
    for (const line of lines) for (const direction of line.directions) {
      primaryBoards[line.id + ':' + direction.key] = filterDepartures(raw, line.id, Date.now(), direction.key);
    }
  }
  report(primaryBoards);
}

if (!fallbackOk && !key) {
  console.error('\nNo departure provider is answering. The boards will show dashes.');
  process.exit(1);
}
