import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  advectedCells, distinctStates, estimateFlow, estimateFlows, flowLimit, MAX_FLOW_KMH, momentAt, sequenceProgress,
  steadyFlows,
} from '../lib/precipitation-flow.ts';
import { SEQUENCE_LOOPS } from '../lib/precipitation-grid.ts';
import { MAP_MS } from '../lib/panel-rotation.ts';

const START = Date.UTC(2026, 8, 4, 6, 0);
const QUARTER = 900_000;

// A field with one wet blob, so a displacement between two of them is
// unambiguous. Row-major from the south-west, like the grid itself.
function blob(columns, rows, cx, cy) {
  const cells = new Array(columns * rows).fill(0);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const distance = Math.hypot(x - cx, y - cy);
      cells[y * columns + x] = distance <= 2 ? Math.round((3 - distance) * 100) / 100 : 0;
    }
  }
  return cells;
}

test('runs of identical frames collapse to the one state they were made from', () => {
  // Exactly the shape Open-Meteo returns: each hour's total repeated across its
  // four quarters, so 24 frames carry 6 states.
  const frames = Array.from({ length: 24 }, (unused, step) => ({
    timestamp: START + step * QUARTER,
    cells: [Math.floor(step / 4) * 0.1],
  }));
  const states = distinctStates(frames);
  assert.equal(states.length, 6);
  // Each state sits at the middle of the run it stands for, so the states are
  // an hour apart however the run is sliced.
  assert.equal(states[1].timestamp - states[0].timestamp, 3_600_000);
  assert.deepEqual(states[0].cells, [0]);
  assert.deepEqual(states[5].cells, [0.5]);
});

test('a partial leading run keeps its own midpoint rather than a assumed hour', () => {
  // After a night without a refresh the first hour is part-expired, so its run
  // is shorter and the gap to the next state is not a whole hour.
  const frames = [
    { timestamp: START, cells: [1] },
    { timestamp: START + QUARTER, cells: [2] },
    { timestamp: START + 2 * QUARTER, cells: [2] },
  ];
  const states = distinctStates(frames);
  assert.deepEqual(states.map(state => state.timestamp), [START, START + 1.5 * QUARTER]);
  assert.deepEqual(distinctStates([]), []);
});

test('the displacement between two states is found, and standing still is the default', () => {
  const columns = 14;
  const rows = 12;
  const from = blob(columns, rows, 4, 5);
  assert.deepEqual(estimateFlow(from, blob(columns, rows, 7, 6), columns, rows, 6), { dx: 3, dy: 1 });
  assert.deepEqual(estimateFlow(from, blob(columns, rows, 2, 5), columns, rows, 6), { dx: -2, dy: 0 });
  assert.deepEqual(estimateFlow(from, from, columns, rows, 6), { dx: 0, dy: 0 });
  // Two dry fields match equally well at every offset; the best of them would
  // be noise, so nothing is claimed.
  const dry = new Array(columns * rows).fill(0);
  assert.deepEqual(estimateFlow(dry, dry, columns, rows, 6), { dx: 0, dy: 0 });
  // A field that only appears has nowhere to have come from, and a shift that
  // does not explain the pair better than standing still is not believed.
  assert.deepEqual(estimateFlow(dry, blob(columns, rows, 7, 6), columns, rows, 6), { dx: 0, dy: 0 });
});

test('the search explains a long displacement rather than hiding it, and stays inside its reach', () => {
  const columns = 14;
  const rows = 12;
  const from = blob(columns, rows, 2, 5);
  // Nine cells across a fourteen-cell grid. Scored on the shared cells alone
  // this came out as a confident shift the other way, because sliding the two
  // blobs apart left only dry cells to compare.
  assert.deepEqual(estimateFlow(from, blob(columns, rows, 11, 5), columns, rows, 40), { dx: 9, dy: 0 });
  // Asked for less reach than the truth needs, it says what it can see rather
  // than running past the limit.
  const near = estimateFlow(from, blob(columns, rows, 11, 5), columns, rows, 4);
  assert.ok(Math.abs(near.dx) <= 4 && Math.abs(near.dy) <= 4, JSON.stringify(near));
  // A grid too small to match on, and a mis-sized field, are not guessed at.
  assert.deepEqual(estimateFlow([1], [1], 1, 1, 4), { dx: 0, dy: 0 });
  assert.deepEqual(estimateFlow([1, 2], from, columns, rows, 4), { dx: 0, dy: 0 });
});

test('the search reach follows the gap between states and the lattice spacing', () => {
  assert.equal(flowLimit(3_600_000, 3), Math.ceil(MAX_FLOW_KMH / 3));
  // Half the gap, half the reach.
  assert.equal(flowLimit(1_800_000, 3), Math.ceil(MAX_FLOW_KMH / 2 / 3));
  // A coarser lattice needs fewer cells for the same distance.
  assert.ok(flowLimit(3_600_000, 6) < flowLimit(3_600_000, 3));
  assert.equal(flowLimit(0, 3), 0);
  assert.equal(flowLimit(3_600_000, 0), 0);
});

test('one flow per consecutive pair of states', () => {
  const columns = 14;
  const rows = 12;
  const states = [0, 1, 2].map(step => ({
    timestamp: START + step * 3_600_000,
    cells: blob(columns, rows, 3 + step * 2, 5),
  }));
  assert.deepEqual(estimateFlows(states, columns, rows, 3), [{ dx: 2, dy: 0 }, { dx: 2, dy: 0 }]);
  assert.deepEqual(estimateFlows(states.slice(0, 1), columns, rows, 3), []);
  assert.deepEqual(estimateFlows([], columns, rows, 3), []);
});

test('the field between two states is carried along the flow, not faded across it', () => {
  const columns = 14;
  const rows = 12;
  const states = [
    { timestamp: START, cells: blob(columns, rows, 3, 5) },
    { timestamp: START + 3_600_000, cells: blob(columns, rows, 9, 5) },
  ];
  const flows = estimateFlows(states, columns, rows, 3);
  assert.deepEqual(flows, [{ dx: 6, dy: 0 }]);
  const middle = advectedCells(states, flows, columns, rows, START + 1_800_000);
  const peak = index => index % columns;
  // Halfway through, the blob stands halfway between the two, at full
  // strength. A blend without the flow would instead leave two half-strength
  // ghosts where the states put them and nothing in between.
  const wettest = middle.indexOf(Math.max(...middle));
  assert.equal(peak(wettest), 6);
  assert.ok(middle[wettest] > 2.5, String(middle[wettest]));
  assert.ok(middle[5 * columns + 3] < 1, String(middle[5 * columns + 3]));
  assert.ok(middle[5 * columns + 9] < 1, String(middle[5 * columns + 9]));
});

test('outside the sequence the nearest state is held, and a lone state is all there is', () => {
  const columns = 6;
  const rows = 6;
  const states = [
    { timestamp: START, cells: blob(columns, rows, 1, 2) },
    { timestamp: START + 3_600_000, cells: blob(columns, rows, 4, 2) },
  ];
  const flows = estimateFlows(states, columns, rows, 3);
  assert.deepEqual(advectedCells(states, flows, columns, rows, START - 60_000), states[0].cells);
  assert.deepEqual(advectedCells(states, flows, columns, rows, START + 4_000_000), states[1].cells);
  assert.deepEqual(advectedCells(states.slice(0, 1), [], columns, rows, START + 60_000), states[0].cells);
  assert.deepEqual(advectedCells([], [], columns, rows, START), []);
});

test('a moment inside a three-state sequence uses the pair that brackets it', () => {
  const columns = 10;
  const rows = 8;
  const states = [0, 1, 2].map(step => ({
    timestamp: START + step * 3_600_000,
    cells: blob(columns, rows, 1 + step * 3, 4),
  }));
  const flows = estimateFlows(states, columns, rows, 3);
  const late = advectedCells(states, flows, columns, rows, START + 5_400_000);
  // Between the second and third states the blob is between 4 and 7, not back
  // near the first state's 1.
  const wettest = late.indexOf(Math.max(...late)) % columns;
  assert.ok(wettest >= 5 && wettest <= 6, String(wettest));
  assert.equal(late.length, columns * rows);
});

test('a lone disagreeing displacement is outvoted by its neighbours', () => {
  // The measured case: the first pair of a crossing band came back at (1, -7)
  // where every pair after it agreed on (5, -1), and one hour of the animation
  // lurched sideways before the rest of it set off correctly.
  const steady = steadyFlows([
    { dx: 1, dy: -7 }, { dx: 5, dy: -1 }, { dx: 5, dy: -1 }, { dx: 5, dy: -1 }, { dx: 5, dy: -1 }, { dx: 0, dy: 0 },
  ]);
  assert.deepEqual(steady, Array.from({ length: 6 }, () => ({ dx: 5, dy: -1 })));
  // One in the middle goes the same way.
  assert.deepEqual(steadyFlows([{ dx: 4, dy: 1 }, { dx: -9, dy: 8 }, { dx: 4, dy: 1 }]),
    [{ dx: 4, dy: 1 }, { dx: 4, dy: 1 }, { dx: 4, dy: 1 }]);
});

test('a genuine turn survives, and too few to vote on are untouched', () => {
  // Weather that really is speeding up or turning must not be flattened. The
  // median of three consecutive steps of a ramp is the middle one, so the
  // inside of the turn comes through exactly.
  const turning = [{ dx: 1, dy: 4 }, { dx: 2, dy: 3 }, { dx: 3, dy: 2 }, { dx: 4, dy: 1 }, { dx: 5, dy: 0 }];
  const steady = steadyFlows(turning);
  assert.deepEqual(steady.slice(1, -1), turning.slice(1, -1));
  // The two ends are pulled in by one step, because that is where the window
  // has to look inward and a bad estimate is likeliest. The turn still runs
  // the same way throughout, which is what the animation shows.
  for (let index = 1; index < steady.length; index += 1) {
    assert.ok(steady[index].dx >= steady[index - 1].dx, JSON.stringify(steady));
    assert.ok(steady[index].dy <= steady[index - 1].dy, JSON.stringify(steady));
  }
  assert.ok(steady[0].dx <= turning[1].dx && steady[steady.length - 1].dx >= turning[turning.length - 2].dx);
  const pair = [{ dx: 1, dy: 1 }, { dx: 9, dy: 9 }];
  assert.deepEqual(steadyFlows(pair), pair);
  assert.deepEqual(steadyFlows([]), []);
});

test('the position through the sequence is read from the clock, and wraps', () => {
  const pass = MAP_MS / SEQUENCE_LOOPS;
  assert.equal(sequenceProgress(0, MAP_MS, SEQUENCE_LOOPS), 0);
  assert.equal(sequenceProgress(pass / 4, MAP_MS, SEQUENCE_LOOPS), 0.25);
  // The sequence lands exactly SEQUENCE_LOOPS times inside the scene.
  assert.equal(sequenceProgress(pass, MAP_MS, SEQUENCE_LOOPS), 0);
  assert.equal(sequenceProgress(MAP_MS, MAP_MS, SEQUENCE_LOOPS), 0);
  assert.equal(sequenceProgress(pass * 1.5, MAP_MS, SEQUENCE_LOOPS), 0.5);
  // A frame that arrives late lands where it belongs rather than behind, which
  // is the whole reason this is a function of elapsed time and not a counter.
  assert.equal(sequenceProgress(pass * 3.75, MAP_MS, SEQUENCE_LOOPS), 0.75);
  assert.equal(sequenceProgress(-5, MAP_MS, SEQUENCE_LOOPS), 0);
  assert.equal(sequenceProgress(1000, 0, SEQUENCE_LOOPS), 0);
});

test('a position through the sequence names a forecast moment inside the span', () => {
  const end = START + 6 * 3_600_000;
  assert.equal(momentAt(START, end, 0), START);
  assert.equal(momentAt(START, end, 1), end);
  assert.equal(momentAt(START, end, 0.5), START + 3 * 3_600_000);
  // Nothing may run off either end of the track.
  assert.equal(momentAt(START, end, -2), START);
  assert.equal(momentAt(START, end, 9), end);
  // A span with nowhere to travel must not divide by zero.
  assert.equal(momentAt(START, START, 0.5), START);
  assert.equal(momentAt(START, START - 1000, 0.5), START);
});
