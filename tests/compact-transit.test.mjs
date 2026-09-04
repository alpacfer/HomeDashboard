import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextCompactDeparture, LINES } from '../lib/transit.ts';

const now = 1_800_000_000_000;
const departure = (id, minutes, cancelled = false) => ({ id, scheduled:now + minutes * 60000, expected:now + minutes * 60000, cancelled, realtime:true, delay:0, track:null, scheduledTrack:null, alerts:[] });
test('compact board keeps one next usable departure in every direction', () => {
  const keys = LINES.flatMap(line => line.directions.map(direction => line.id + ':' + direction.key));
  assert.equal(keys.length, 5);
  const boards = Object.fromEntries(keys.map(key => [key, [departure('later', 10), departure('left', -1), departure('cancelled', 1, true), departure(key, 3)]]));
  const data = { status:'ready', generatedAt:now, boards };
  for (const key of keys) assert.equal(nextCompactDeparture(data, key, now).id, key);
  assert.equal(boards[keys[0]][0].id, 'later', 'selector must not reorder shared state');
});
test('compact board never invents times or shows expired data', () => {
  const data = { status:'ready', generatedAt:now - 300001, boards:{'A:north':[departure('future', 30)]} };
  assert.equal(nextCompactDeparture(data, 'A:north', now), undefined);
  assert.equal(nextCompactDeparture(null, 'A:north', now), undefined);
  assert.equal(nextCompactDeparture({...data, status:'needs_key', generatedAt:now}, 'A:north', now), undefined);
  assert.equal(nextCompactDeparture({...data, generatedAt:now, boards:{}}, 'A:north', now), undefined);
  assert.equal(nextCompactDeparture({...data, generatedAt:now, boards:{'A:north':[departure('cancelled', 1, true)]}}, 'A:north', now), undefined);
});
