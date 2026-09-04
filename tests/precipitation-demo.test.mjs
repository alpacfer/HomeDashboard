import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoGrid, DRIFT_U, DRIFT_V } from '../lib/precipitation-demo.ts';
import {
  DEFAULT_GRID, GRID_FETCH_STEPS, GRID_STEP_MINUTES, GRID_STEPS, hasPrecipitation, validPrecipitationGrid,
} from '../lib/precipitation-grid.ts';
import { distinctStates, estimateFlows, steadyFlows } from '../lib/precipitation-flow.ts';

const NOW = Date.UTC(2026, 8, 4, 6, 3, 17);
const STEP_MS = GRID_STEP_MINUTES * 60_000;

test('the demo grid is a grid, indistinguishable in shape from a fetched one', () => {
  const grid = demoGrid(DEFAULT_GRID, NOW);
  assert.equal(validPrecipitationGrid(grid), true);
  assert.equal(grid.frames.length, GRID_FETCH_STEPS);
  assert.equal(grid.columns, DEFAULT_GRID.columns);
  assert.ok(hasPrecipitation(grid.frames));
  // Stamped on whole quarter hours ahead of now, like the provider's own.
  assert.equal(grid.frames[0].timestamp % STEP_MS, 0);
  assert.ok(grid.frames[0].timestamp > NOW);
  grid.frames.forEach((frame, step) => assert.equal(frame.timestamp, grid.frames[0].timestamp + step * STEP_MS));
});

test('it reproduces the provider fault it exists to check: four identical quarters an hour', () => {
  const grid = demoGrid(DEFAULT_GRID, NOW);
  // The window the map animates: twenty-four frames carrying six states, which
  // is the shape the real provider hands over.
  const shown = grid.frames.slice(0, GRID_STEPS);
  const states = distinctStates(shown);
  assert.equal(states.length, GRID_STEPS / 4);
  assert.equal(states[1].timestamp - states[0].timestamp, 3_600_000);
  // Every quarter inside an hour carries that hour's field exactly.
  for (let step = 1; step < 4; step += 1) {
    assert.deepEqual(shown[step].cells, shown[0].cells);
  }
  assert.notDeepEqual(shown[4].cells, shown[0].cells);
});

test('the band moves, so there is a displacement for the animation to find', () => {
  const grid = demoGrid(DEFAULT_GRID, NOW);
  const states = distinctStates(grid.frames.slice(0, GRID_STEPS));
  // Smoothed exactly as the map smooths them: an estimate made where the band
  // is only half in the frame is outvoted rather than animated.
  const flows = steadyFlows(estimateFlows(states, grid.columns, grid.rows, grid.spacingKm));
  assert.equal(flows.length, states.length - 1);
  // The pattern is translated and nothing else, so the displacement the search
  // has to recover is known: this is the end-to-end check that what the map
  // draws in between is the motion that is really there.
  const dx = DRIFT_U * (grid.columns - 1);
  const dy = DRIFT_V * (grid.rows - 1);
  // What is judged is the component across the band, because that is the
  // component the picture depends on. A band is long and straight enough that
  // sliding it a cell along itself leaves the same image, so the search cannot
  // pin that down and does not need to; see lib/precipitation-flow.ts.
  const length = Math.hypot(dx, dy);
  const across = (a, b) => (a * dx + b * dy) / length;
  for (const flow of flows) {
    assert.ok(flow.dx > 0, JSON.stringify(flow));
    assert.ok(Math.abs(across(flow.dx - dx, flow.dy - dy)) <= 1, JSON.stringify({ flow, dx, dy }));
    assert.ok(Math.hypot(flow.dx, flow.dy) <= length + 2, JSON.stringify({ flow, dx, dy }));
  }
});

test('it is deterministic, so two captures of the same change are comparable', () => {
  const first = demoGrid(DEFAULT_GRID, NOW);
  const second = demoGrid(DEFAULT_GRID, NOW + 60_000);
  assert.deepEqual(first.frames.map(frame => frame.cells), second.frames.map(frame => frame.cells));
});
