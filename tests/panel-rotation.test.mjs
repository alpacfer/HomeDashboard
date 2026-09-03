import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialRotation, nextRotation, pinnedRotation, resumeRotation, SCENES, TRANSPORT_MS, FACT_MS, MAP_MS } from '../lib/panel-rotation.ts';

const FACT_COUNT = 3;

test('transport and facts get 15 seconds, the forecast map keeps 30', () => {
  const initial = initialRotation(0, 40);
  assert.deepEqual(initial, { phase:'transport', index:0, duration:15000 });
  const fact = nextRotation(initial, 40);
  assert.deepEqual(fact, { phase:'fact', index:0, duration:15000 });
  const forecastMap = nextRotation(fact, 40);
  // The map is the only animated scene and has a whole six-hour sequence to
  // play, so it keeps twice as long as the two static scenes.
  assert.deepEqual(forecastMap, { phase:'map', index:0, duration:30000 });
  assert.deepEqual(nextRotation(forecastMap, 40), { phase:'transport', index:1, duration:15000 });
  assert.equal(TRANSPORT_MS + FACT_MS + MAP_MS, 60000, 'one full cycle takes a minute');
});
test('Spain, Denmark and Greece are each shown once before the daily facts repeat', () => {
  const seen = new Set();
  let state = initialRotation(1, FACT_COUNT);
  for (let i = 0; i < FACT_COUNT; i++) {
    state = nextRotation(state, FACT_COUNT);
    state = nextRotation(state, FACT_COUNT);
    assert.equal(seen.has(state.index), false);
    seen.add(state.index);
    state = nextRotation(state, FACT_COUNT);
  }
  assert.equal(seen.size, FACT_COUNT);
  assert.equal(state.index, 1);
});
test('wake resumes transport without replaying the fact just seen', () => {
  assert.deepEqual(resumeRotation({ phase:'fact', index:2, duration:15000 }, FACT_COUNT), initialRotation(0, FACT_COUNT));
  assert.deepEqual(resumeRotation({ phase:'map', index:2, duration:30000 }, FACT_COUNT), initialRotation(0, FACT_COUNT));
  assert.deepEqual(resumeRotation(initialRotation(1, FACT_COUNT), FACT_COUNT), initialRotation(1, FACT_COUNT));
  for (const invalid of [NaN, Infinity, -1, 1.5]) assert.equal(initialRotation(invalid, FACT_COUNT).index, 0);
  assert.equal(initialRotation(4, FACT_COUNT).index, 1);
});
test('a scene in the URL pins the panel; anything else leaves it rotating', () => {
  // Debug mode: /?scene=map holds the forecast map on screen. A pinned
  // rotation has no duration, which is what stops the scheduler.
  assert.deepEqual(pinnedRotation('?scene=map', FACT_COUNT), { phase:'map', index:0, duration:0 });
  assert.deepEqual(pinnedRotation('?scene=transport', FACT_COUNT), { phase:'transport', index:0, duration:0 });
  assert.deepEqual(pinnedRotation('?scene=fact&fact=2', FACT_COUNT), { phase:'fact', index:2, duration:0 });
  // The fact index wraps and tolerates rubbish, like the saved index does.
  assert.equal(pinnedRotation('?scene=fact&fact=4', FACT_COUNT).index, 1);
  assert.equal(pinnedRotation('?scene=fact&fact=abc', FACT_COUNT).index, 0);
  // A mistyped or absent scene must never leave the display stuck.
  assert.equal(pinnedRotation('?scene=radar', FACT_COUNT), null);
  assert.equal(pinnedRotation('?fact=2', FACT_COUNT), null);
  assert.equal(pinnedRotation('', FACT_COUNT), null);
  assert.deepEqual([...SCENES], ['transport', 'fact', 'map']);
});
