import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoTransitData } from '../lib/transit-demo.ts';
import { boardIncidents, departureIncidents, LINES } from '../lib/transit.ts';

const now = Date.parse('2026-09-04T08:00:00Z');
const data = demoTransitData(now);
const every = Object.values(data.boards).flat();

test('the demo board fills every direction the display renders', () => {
  for (const line of LINES) for (const direction of line.directions) {
    const board = data.boards[line.id + ':' + direction.key];
    assert.equal(board?.length, 3, line.id + ':' + direction.key + ' needs three departures');
  }
  assert.equal(data.status, 'ready');
  assert.equal(data.generatedAt, now);
  assert.equal(data.source, undefined, 'the demo claims no provider');
});

test('every departure is in the future and internally consistent', () => {
  for (const departure of every) {
    assert.ok(departure.expected > now, departure.id + ' has already gone');
    assert.equal(departure.expected - departure.scheduled, departure.delay * 60000);
    assert.ok(Number.isInteger(departure.delay));
  }
  assert.equal(new Set(every.map(departure => departure.id)).size, every.length, 'ids are unique');
});

test('the demo shows one of every mark the panel can draw', () => {
  const kinds = new Set(every.flatMap(departure => departureIncidents(departure)).map(incident => incident.kind));
  assert.deepEqual([...kinds].sort(), ['alert', 'cancelled', 'delayed', 'early', 'track']);
  // A capture is only useful if both severities appear.
  const severities = new Set(every.flatMap(departure => departureIncidents(departure)).map(incident => incident.severity));
  assert.ok(severities.has('severe') && severities.has('warning') && severities.has('info'));
  // Something must be left plainly on time, and something left without a
  // realtime flag, or the capture cannot show the ordinary states either.
  assert.ok(every.some(departure => departureIncidents(departure).length === 0 && departure.realtime));
  assert.ok(every.some(departure => !departure.realtime));
  assert.equal(boardIncidents(data, now).length, 2, 'the summary line has something to show');
});
