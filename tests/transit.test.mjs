import { test } from 'node:test';
import assert from 'node:assert/strict';
import { departureTimestamp, filterDepartures, resolveStop } from '../app/transit.ts';

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
