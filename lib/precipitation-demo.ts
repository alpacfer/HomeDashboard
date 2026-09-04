// A forecast grid that needs no provider, so the map can be looked at without
// spending the display's quota.
//
// Open-Meteo counts one coordinate as one call, so a single load of the map is
// about three hundred of the ten thousand a day this machine shares with the
// Fire TV (lib/open-meteo-quota.ts), and headless Chrome starts every capture
// with an empty profile, so the stored grid never saves the second one.
// Checking a change to the animation across the layouts it has would cost
// several thousand calls and mute the display for the rest of the day.
// `?weather=demo` (lib/debug-flags.ts) draws this instead.
//
// It reproduces the provider's own shape on purpose: one field per hour, with
// the four quarters inside an hour identical, because that is exactly the
// input the animation has to cope with (lib/precipitation-flow.ts). A demo
// that varied every fifteen minutes would flatter the code it exists to check.
//
// Everything here is a function of the hour asked for, so two captures of the
// same change are comparable, and none of it is reachable without the flag.

import { GRID_FETCH_STEPS, GRID_STEP_MINUTES, type GridSpec, type PrecipitationGrid } from './precipitation-grid';

const STEP_MS = GRID_STEP_MINUTES * 60_000;
const STEPS_PER_HOUR = 60 / GRID_STEP_MINUTES;
// How far the pattern travels in an hour, as a fraction of the frame in each
// axis. The whole pattern is translated by this and nothing else, so the
// displacement the animation has to find is exactly DRIFT_U by DRIFT_V scaled
// to cells, which is what the test asserts. On the Fire TV's lattice that is
// about five cells an hour, which is what the real field was measured doing.
export const DRIFT_U = 0.22;
export const DRIFT_V = -0.06;
// Where the pattern starts, chosen with the drift so that the band is inside
// the frame for all six hours the map shows rather than entering and leaving
// inside them. A band only half in view is matched on too little to be worth
// asserting about.
const START_U = -0.32;
const START_V = 0.15;
// Heavier knots along the band, spaced so that at least one is always in the
// frame. A band with a single core became a plain straight line once that core
// drifted out, and a straight line can be slid along itself without changing
// the picture, so the search had nothing to fix its answer to and returned a
// displacement four cells wrong across the band.
const KNOTS = [-0.1, 0.4, 0.9];

// A band lying across the frame with a heavier core inside it, carried bodily
// across the frame as the hours advance. Written as one fixed shape read at a
// shifted position rather than as a shape rebuilt per hour, so that the motion
// really is a translation and not a family of similar pictures.
function band(columns: number, rows: number, hour: number) {
  const cells = new Array<number>(columns * rows);
  const shiftU = START_U + hour * DRIFT_U;
  const shiftV = START_V + hour * DRIFT_V;
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const u = (columns > 1 ? x / (columns - 1) : 0) - shiftU;
      const v = (rows > 1 ? y / (rows - 1) : 0) - shiftV;
      // Distance from the band's axis, which is tilted against the grid so the
      // motion is not purely horizontal and both components get exercised.
      const distance = u * 0.92 - v * 0.39;
      // The other way along the band, where the knots sit.
      const along = u * 0.39 + v * 0.92;
      // The widths are in fractions of the frame, and none is narrower than a
      // cell of the lattice: a feature the grid cannot carry cannot be moved
      // smoothly across it however it is drawn, and the demo would be showing
      // its own aliasing rather than the map's behaviour.
      const body = Math.exp(-((distance / 0.09) ** 2)) * 0.8;
      const knots = KNOTS.reduce((sum, at) => sum + Math.exp(-(((along - at) / 0.13) ** 2)), 0);
      const core = Math.exp(-((distance / 0.055) ** 2)) * knots * 3.2;
      // Rounded like the provider's own values, so the same bands come out.
      cells[y * columns + x] = Math.round((body + core) * 100) / 100;
    }
  }
  return cells;
}

export function demoGrid(spec: GridSpec, now: number): PrecipitationGrid {
  const first = Math.ceil(now / STEP_MS) * STEP_MS;
  const frames = Array.from({ length: GRID_FETCH_STEPS }, (unused, step) => ({
    timestamp: first + step * STEP_MS,
    cells: band(spec.columns, spec.rows, Math.floor(step / STEPS_PER_HOUR)),
  }));
  return { ...spec, frames, run: first, fetchedAt: now };
}
