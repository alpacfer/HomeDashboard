import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alertText, boardIncidents, departureIncidents, departureTimestamp, filterDepartures, resolveStop, serviceHeadway } from '../lib/transit.ts';

const now = Date.parse('2026-08-31T18:00:00Z');
const departure = (overrides = {}) => ({
  name: 'Bus 184', ProductAtStop: { line: '184' }, direction: 'Holte St.',
  date: '2026-08-31', time: '20:10:00', tz: 120, ...overrides,
});
test('filters route and direction without confusing north and south', () => {
  const data = [departure(), departure({ direction: 'Nørreport St.' }), departure({ ProductAtStop: { line: '185' } })];
  assert.equal(filterDepartures(data, '184', now).length, 1);
  assert.equal(filterDepartures(data, '150S', now).length, 0);
  assert.equal(filterDepartures([departure({ ProductAtStop: { line: 'A' }, direction: 'Hillerød St.' })], 'A', now).length, 1);
  assert.equal(filterDepartures([departure({ ProductAtStop: { line: 'A' }, direction: 'Hundige St.' })], 'A', now).length, 0);
});
test('both bus directions have separate boards and never mix', () => {
  const data = [departure(), departure({ direction: 'Nørreport St.' }),
    departure({ ProductAtStop: { line: '150S' }, direction: 'Kokkedal St.' }),
    departure({ ProductAtStop: { line: '150S' }, direction: 'Nørreport St.' })];
  for (const line of ['184', '150S']) {
    const north = filterDepartures(data, line, now, 'north');
    const south = filterDepartures(data, line, now, 'south');
    assert.equal(north.length, 1);
    assert.equal(south.length, 1);
    assert.notEqual(north[0].id, south[0].id);
  }
  assert.deepEqual(filterDepartures(data, '184', now, 'invalid'), []);
});
test('uses realtime departures, calculates delays, de-duplicates and removes departed services', () => {
  const late = departure({ time: '19:59:00', rtTime: '20:03:00', rtDate: '2026-08-31', rtTz: 120 });
  const result = filterDepartures([departure({ time: '19:50:00' }), late, late, departure()], '184', now);
  assert.equal(result.length, 2);
  assert.equal(result[0].expected, now + 180000);
  assert.equal(result[0].delay, 4);
  assert.equal(result[0].realtime, true);
});
test('cancellations remain explicit and hidden platforms are never exposed', () => {
  const result = filterDepartures([departure({ cancelled: true, rtTrack: '4', rtTrackHidden: true })], '184', now);
  assert.equal(result[0].cancelled, true);
  assert.equal(result[0].track, null);
  assert.equal(filterDepartures([departure({ track: '2', trackHidden: true })], '184', now)[0].scheduledTrack, null);
  const moved = filterDepartures([departure({ track: '1', rtTrack: '3' })], '184', now)[0];
  assert.equal(moved.track, '3');
  assert.equal(moved.scheduledTrack, '1');
});

test('service messages are graded by priority and capped', () => {
  const messaged = (Message) => filterDepartures([departure({ Messages: { Message } })], '184', now)[0].alerts;
  assert.deepEqual(messaged([{ head: 'Sporarbejde', priority: 90 }]), [{ severity: 'severe', text: 'Sporarbejde' }]);
  assert.deepEqual(messaged([{ head: 'Omkørsel', priority: 60 }]), [{ severity: 'warning', text: 'Omkørsel' }]);
  assert.deepEqual(messaged([{ lead: 'Info' }]), [{ severity: 'info', text: 'Info' }]);
  assert.deepEqual(messaged({ head: 'Enkelt besked', priority: 90 }), [{ severity: 'severe', text: 'Enkelt besked' }]);
  assert.deepEqual(messaged([{ priority: 90 }]), [], 'a message with no text is not shown');
  assert.equal(messaged([{ head: 'a'.repeat(200) }])[0].text.length, 90);
  assert.equal(messaged([{ head: 'x' }, { head: 'y' }, { head: 'z' }]).length, 2, 'at most two per departure');
  assert.deepEqual(filterDepartures([departure()], '184', now)[0].alerts, []);
});
test('handles midnight and Copenhagen timezone without relying on the device timezone', () => {
  assert.equal(departureTimestamp('2026-09-01', '00:03', 120), Date.parse('2026-08-31T22:03:00Z'));
  assert.equal(departureTimestamp('2026-01-01', '12:00'), Date.parse('2026-01-01T11:00:00Z'));
  assert.equal(departureTimestamp('2026-08-31', '12:00'), Date.parse('2026-08-31T10:00:00Z'));
  assert.ok(Number.isNaN(departureTimestamp(undefined, '12:00')));
});
test('resolves exact stop names and groups opposing masts under the station', () => {
  const payload = { stopLocationOrCoordLocation: [
    { StopLocation: { name: 'Lyngby Lokal St.', id: 'wrong' } },
    { StopLocation: { name: 'Lyngby St.', id: 'mast-1', mainMast: { id: 'station-1' } } },
    { StopLocation: { name: 'Lyngby St.', id: 'mast-2', mainMast: { id: 'station-1' } } },
  ] };
  assert.equal(resolveStop(payload, 'Lyngby St.'), 'station-1');
  assert.throws(() => resolveStop(payload, 'Kildegårds Plads (Lyngbyvej)'));
});
test('fails closed when a stop name is ambiguous', () => {
  assert.throws(() => resolveStop({ StopLocation: [{ name: 'Lyngby St.', id: 'a' }, { name: 'Lyngby St.', id: 'b' }] }, 'Lyngby St.'));
});

const plain = (overrides = {}) => ({ id: 'a', scheduled: now, expected: now, cancelled: false, realtime: true, delay: 0, track: null, scheduledTrack: null, alerts: [], ...overrides });

test('incidents are ordered by severity and a cancellation outranks its own delay', () => {
  assert.deepEqual(departureIncidents(plain()), [], 'an on-time departure has nothing to report');
  assert.deepEqual(departureIncidents(plain({ delay: 4 })), [{ kind: 'delayed', severity: 'warning', label: '+4 min' }]);
  // A long delay is graded up: ten minutes changes whether you leave the house.
  assert.deepEqual(departureIncidents(plain({ delay: 12 })), [{ kind: 'delayed', severity: 'severe', label: '+12 min' }]);
  assert.deepEqual(departureIncidents(plain({ delay: -3 })), [{ kind: 'early', severity: 'info', label: '-3 min' }]);
  assert.deepEqual(departureIncidents(plain({ delay: -1 })), [{ kind: 'early', severity: 'info', label: '-1 min' }]);
  assert.deepEqual(departureIncidents(plain({ track: '3', scheduledTrack: '1' })), [{ kind: 'track', severity: 'warning', label: 'Track 3 (was 1)' }]);
  assert.deepEqual(departureIncidents(plain({ track: '3', scheduledTrack: '3' })), [], 'an unchanged platform is not an incident');
  assert.deepEqual(departureIncidents(plain({ track: '3' })), [], 'a platform with nothing to compare against is not a change');

  const cancelled = departureIncidents(plain({ cancelled: true, delay: 9 }));
  assert.deepEqual(cancelled, [{ kind: 'cancelled', severity: 'severe', label: 'Cancelled' }]);

  const both = departureIncidents(plain({ delay: 3, alerts: [{ severity: 'severe', text: 'Sporarbejde' }] }));
  assert.deepEqual(both.map(item => item.kind), ['alert', 'delayed'], 'the severe alert sorts above the delay');
});

test('the panel-level summary counts each disruption once and stays short', () => {
  const boards = {
    '184:north': [plain({ id: '1', cancelled: true }), plain({ id: '2', cancelled: true })],
    '184:south': [plain({ id: '3', delay: 20 }), plain({ id: '4', alerts: [{ severity: 'warning', text: 'Omkørsel' }] })],
    '150S:north': [plain({ id: '5', alerts: [{ severity: 'severe', text: 'Aflyst rute' }] })],
    '150S:south': [plain({ id: '6', expected: now - 1, alerts: [{ severity: 'severe', text: 'Gammel besked' }] })],
  };
  const summary = boardIncidents({ status: 'ready', generatedAt: now, boards }, now);
  assert.equal(summary.length, 2, 'the wall has room for two');
  assert.deepEqual(summary.map(item => item.label), ['Cancelled', 'Aflyst rute']);
  assert.ok(!summary.some(item => item.label === 'Gammel besked'), 'a departed service is not still disrupting anything');
  assert.ok(!summary.some(item => item.kind === 'delayed'), 'delays are marked on the departure, not in the summary');
  assert.deepEqual(boardIncidents(null, now), []);
  assert.deepEqual(boardIncidents({ status: 'unavailable', generatedAt: now, boards }, now), []);
});

test('alert text is collapsed and capped before it can reach the browser', () => {
  assert.equal(alertText('  two   words  '), 'two words');
  assert.equal(alertText('line\nbreak'), 'line break');
  assert.equal(alertText(undefined), '');
  assert.equal(alertText(42), '');
  const capped = alertText('word '.repeat(60));
  assert.equal(capped.length, 90);
  assert.ok(capped.endsWith('\u2026'));
});

// Departures at the given offsets in minutes, as one direction's board.
const board = (offsets, overrides = {}) => offsets.map((minutes, index) =>
  plain({ id: 'd' + index + '-' + minutes, scheduled: now + minutes * 60000, expected: now + minutes * 60000, ...overrides }));
const ready = boards => ({ status: 'ready', generatedAt: now, boards });

test('headway describes how often a line runs one way, rounded, from the timetable', () => {
  const twenty = ready({ '184:north': board([2, 22, 42, 62]) });
  assert.equal(serviceHeadway(twenty, '184', 'north', now), 20);
  // Under ten minutes it is reported to the minute rather than to the nearest five.
  assert.equal(serviceHeadway(ready({ '184:north': board([1, 8, 15, 22]) }), '184', 'north', now), 7);
  // Rounded, because it is a description and not a promise: 18 reads as 20.
  assert.equal(serviceHeadway(ready({ '184:north': board([0, 18, 36, 54]) }), '184', 'north', now), 20);
});

test('headway is a property of the timetable, not of today\'s delays', () => {
  const late = board([2, 22, 42, 62]).map((departure, index) =>
    ({ ...departure, expected: departure.scheduled + (index === 1 ? 11 : 0) * 60000, delay: index === 1 ? 11 : 0 }));
  assert.equal(serviceHeadway(ready({ '184:north': late }), '184', 'north', now), 20,
    'one bus running eleven minutes late does not change how often the line runs');
});

test('headway is per direction, and never mixes the two', () => {
  // Both directions run every twenty minutes, offset by ten. Counting them
  // together would call the line twice as frequent as it is either way.
  const offset = ready({ '184:north': board([0, 20, 40, 60]), '184:south': board([10, 30, 50, 70]) });
  assert.equal(serviceHeadway(offset, '184', 'north', now), 20);
  assert.equal(serviceHeadway(offset, '184', 'south', now), 20);
  // One busy direction says nothing about the quiet one.
  const uneven = ready({ '150S:north': board([0, 5, 10, 15]), '150S:south': board([2, 32, 62]) });
  assert.equal(serviceHeadway(uneven, '150S', 'north', now), 5);
  assert.equal(serviceHeadway(uneven, '150S', 'south', now), 30);
});

test('headway refuses to guess from too little', () => {
  assert.equal(serviceHeadway(ready({ '184:north': board([5, 25]) }), '184', 'north', now), null, 'two departures is one gap');
  assert.equal(serviceHeadway(ready({}), '184', 'north', now), null);
  assert.equal(serviceHeadway(null, '184', 'north', now), null);
  assert.equal(serviceHeadway({ status: 'unavailable', generatedAt: now, boards: {} }, '184', 'north', now), null);
  assert.equal(serviceHeadway(ready({ '184:north': board([5, 25, 45, 65]) }), '184', 'sideways', now), null);
  // A board that only reaches to the end of service is not a frequency.
  assert.equal(serviceHeadway(ready({ '184:north': board([10, 200, 400, 600]) }), '184', 'north', now), null);
});

test('headway ignores departures that have gone or been cancelled', () => {
  // The median resists one irregular gap rather than being dragged by it.
  assert.equal(serviceHeadway(ready({ '184:north': board([2, 22, 42, 105, 125]) }), '184', 'north', now), 20);
  const past = ready({ '184:north': [...board([-40, -20]), ...board([2, 22, 42])] });
  assert.equal(serviceHeadway(past, '184', 'north', now), 20, 'a departed service is not part of the next hour');
  const cancelled = ready({ '184:north': [...board([2, 22, 42]), ...board([52], { cancelled: true })] });
  assert.equal(serviceHeadway(cancelled, '184', 'north', now), 20);
});
