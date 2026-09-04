import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseStopTimes, stopTimesQuery, TRANSITOUS_HEADSIGNS, TRANSITOUS_REALTIME_MODE, TRANSITOUS_STOPS } from '../lib/transitous.ts';
import { LINES } from '../lib/transit.ts';

// A real https://api.transitous.org/api/v1/stoptimes response for
// Kildegårds Plads (Lyngbyvej), trimmed to the fields the parser reads.
const fixture = JSON.parse(readFileSync(new URL('./fixtures/transitous-stoptimes.json', import.meta.url), 'utf8'));
const STOP = 'Kildegårds Plads (Lyngbyvej)';
const before = Date.parse('2026-09-04T00:00:00Z');

const entry = (overrides = {}, place = {}) => ({
  routeShortName: '184', headsign: 'Vedbæk St.', realTime: true, tripId: 'trip-1',
  cancelled: false, tripCancelled: false,
  place: { name: STOP, scheduledDeparture: '2026-09-04T06:00:00Z', departure: '2026-09-04T06:00:00Z', cancelled: false, ...place },
  ...overrides,
});
const board = (entries, line = '184', direction = 'north', now = before) =>
  parseStopTimes({ place: { name: STOP }, stopTimes: entries }, STOP, line, direction, now);

test('parses a real response into the direction it belongs to', () => {
  assert.equal(parseStopTimes(fixture, STOP, '184', 'north', before).length, 1);
  assert.equal(parseStopTimes(fixture, STOP, '184', 'south', before).length, 1);
  assert.equal(parseStopTimes(fixture, STOP, '150S', 'south', before).length, 1);
  // Kokkedal and the DTU short-turn are both northbound on the same corridor.
  assert.equal(parseStopTimes(fixture, STOP, '150S', 'north', before).length, 2);
  const north = parseStopTimes(fixture, STOP, '184', 'north', before)[0];
  assert.equal(north.expected, Date.parse('2026-09-04T04:09:00Z'));
  assert.equal(north.delay, 0);
  assert.equal(north.realtime, false);
  assert.deepEqual(north.alerts, []);
});

test('never files another line or the opposite direction under a board', () => {
  // 185 and 172 also call at this stop and must not reach any board.
  for (const line of ['184', '150S']) for (const direction of ['north', 'south']) {
    for (const departure of parseStopTimes(fixture, STOP, line, direction, before)) {
      assert.ok(departure.id.includes('dk-rejseplanen'), 'id comes from the trip');
    }
  }
  assert.deepEqual(board([entry({ routeShortName: '185', headsign: 'Nørreport St.' })], '184', 'south'), []);
  assert.deepEqual(board([entry({ headsign: 'Nørreport St.' })], '184', 'north'), []);
  assert.deepEqual(board([entry({ headsign: 'Somewhere New' })], '184', 'north'), [], 'an unknown headsign is dropped, not guessed');
  assert.deepEqual(board([entry()], '184', 'sideways'), [], 'an unknown direction has no board');
});

test('reads delay, cancellation and platform change from the realtime fields', () => {
  const late = board([entry({}, { departure: '2026-09-04T06:07:00Z' })])[0];
  assert.equal(late.delay, 7);
  assert.equal(late.expected - late.scheduled, 7 * 60000);

  const early = board([entry({}, { departure: '2026-09-04T05:58:00Z' })])[0];
  assert.equal(early.delay, -2);

  assert.equal(board([entry({ cancelled: true })])[0].cancelled, true);
  assert.equal(board([entry({ tripCancelled: true })])[0].cancelled, true);
  assert.equal(board([entry({ cancelled: false }, { cancelled: true })])[0].cancelled, true);

  const moved = board([entry({}, { track: '3', scheduledTrack: '1' })])[0];
  assert.equal(moved.track, '3');
  assert.equal(moved.scheduledTrack, '1');
});

test('grades alerts by severity and by the effect on someone at the stop', () => {
  const alerts = severity => board([entry({}, { alerts: [{ headerText: 'Sporarbejde', severityLevel: severity }] })])[0].alerts;
  assert.deepEqual(alerts('SEVERE'), [{ severity: 'severe', text: 'Sporarbejde' }]);
  assert.deepEqual(alerts('WARNING'), [{ severity: 'warning', text: 'Sporarbejde' }]);
  assert.deepEqual(alerts('INFO'), [{ severity: 'info', text: 'Sporarbejde' }]);
  // A feed can call a total loss of service merely informational.
  const noService = board([entry({}, { alerts: [{ headerText: 'Bussen kører ikke', severityLevel: 'INFO', effect: 'NO_SERVICE' }] })])[0];
  assert.equal(noService.alerts[0].severity, 'severe');
  const detour = board([entry({}, { alerts: [{ headerText: 'Omkørsel', severityLevel: 'UNKNOWN_SEVERITY', effect: 'DETOUR' }] })])[0];
  assert.equal(detour.alerts[0].severity, 'warning');
  // Provider text is capped before it can reach React state.
  const long = board([entry({}, { alerts: [{ headerText: 'x'.repeat(400), severityLevel: 'INFO' }] })])[0];
  assert.equal(long.alerts[0].text.length, 90);
  assert.deepEqual(board([entry({}, { alerts: [{ severityLevel: 'SEVERE' }] })])[0].alerts, [], 'an alert with no text is not an alert');
  assert.deepEqual(board([entry({}, { alerts: 'nonsense' })])[0].alerts, []);
});

test('refuses a response that answers for a different stop', () => {
  assert.throws(() => parseStopTimes({ place: { name: 'Lyngby St.' }, stopTimes: [] }, STOP, '184', 'north', before), /different stop/);
  assert.throws(() => parseStopTimes({ stopTimes: [] }, STOP, '184', 'north', before), /different stop/);
  assert.throws(() => parseStopTimes({ place: { name: STOP } }, STOP, '184', 'north', before), /departure list/);
  assert.throws(() => parseStopTimes(null, STOP, '184', 'north', before), /departure list/);
  assert.throws(() => parseStopTimes('<html>', STOP, '184', 'north', before), /departure list/);
});

test('skips malformed entries instead of inventing a time', () => {
  assert.deepEqual(board([entry({}, { scheduledDeparture: undefined, departure: undefined })]), []);
  assert.deepEqual(board([entry({}, { scheduledDeparture: 'not a date', departure: 'not a date' })]), []);
  assert.deepEqual(board([entry({ place: undefined })]), []);
  assert.deepEqual(board([entry({ routeShortName: undefined })]), []);
  assert.deepEqual(board([{}]), []);
  // Departed services are dropped, and identical trips are kept once.
  assert.deepEqual(board([entry()], '184', 'north', Date.parse('2026-09-04T07:00:00Z')), []);
  assert.equal(board([entry(), entry()]).length, 1);
  // A missing realtime departure falls back to the scheduled one.
  const scheduledOnly = board([entry({ realTime: false }, { departure: undefined })])[0];
  assert.equal(scheduledOnly.expected, scheduledOnly.scheduled);
  assert.equal(scheduledOnly.realtime, false);
});

test('the fallback covers every board the display renders', () => {
  for (const line of LINES) {
    assert.ok(TRANSITOUS_STOPS[line.stopName], line.stopName + ' has no Transitous stop id');
    for (const direction of line.directions) {
      const headsigns = TRANSITOUS_HEADSIGNS[line.id + ':' + direction.key];
      assert.ok(headsigns?.length, line.id + ':' + direction.key + ' has no headsigns');
    }
  }
  // Every configured stop id belongs to the Danish Rejseplanen feed.
  for (const id of Object.values(TRANSITOUS_STOPS)) assert.match(id, /^dk-rejseplanen_\d+$/);
});

test('every board is asked for live times, not for whatever the provider defaults to', () => {
  const query = stopTimesQuery(TRANSITOUS_STOPS['Lyngby St.']);
  // The live time of the next departure is the most valuable field on the
  // board, so it is requested by name. `realtimeMode=OFF` returns the same
  // events with every live flag cleared: a board that still looks right and
  // has quietly stopped tracking anything.
  assert.equal(query.realtimeMode, 'REALTIME');
  assert.equal(TRANSITOUS_REALTIME_MODE, 'REALTIME');
  assert.equal(query.stopId, 'dk-rejseplanen_000008600675');
  // Soonest first: the provider sorts by realtime departure and the board is
  // read from the front, so nothing later can crowd out the next departure.
  assert.equal(query.arriveBy, 'false');
  // Survives URLSearchParams, which stringifies without complaining.
  const params = new URLSearchParams(query);
  assert.equal(params.get('realtimeMode'), 'REALTIME');
  assert.ok(Number(params.get('n')) >= 12, 'deep enough for the twelve departures a board retains');
});
