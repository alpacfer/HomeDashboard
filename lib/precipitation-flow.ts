// How the forecast field moves between states, and the frames in between.
//
// Open-Meteo's `minutely_15` precipitation is not sub-hourly data for the
// models that cover Denmark. Asked for both series from the same DMI Harmonie
// run, the four quarters of every hour carry that hour's total divided by four:
// eight hours were checked and not one varied inside the hour. `temperature_2m`
// from the same request gives the mechanism away, sitting on the straight line
// between the hourly values to within its own rounding. KNMI Harmonie, MET
// Norway and ECMWF all behave the same way. Only ICON-D2 publishes genuine
// fifteen-minute output, and its metadata file answers 500, which would cost
// the run-aware refresh in lib/forecast-refresh.ts.
//
// So the map's twenty-four frames hold six distinct states. Three frames in
// four are a hold and the fourth is a cut, which is what made the animation
// read as a slideshow rather than as weather crossing the map. Asking for more
// timesteps would not have helped, and would not have cost anything either:
// Open-Meteo weighs a request by coordinates, never by steps
// (lib/open-meteo-quota.ts), so the steps were already free and already empty.
//
// The frames in between are therefore made here, out of the states that are
// real. Blending values alone would not do. The field was measured crossing
// this frame at about 14 km/h, and at 34 km/h at its fastest, which over an
// hour is five of the map's three-kilometre cells and sometimes eleven. A
// blend over that distance fades rain out of one place and into another
// instead of moving it. So each pair of states is matched for the displacement
// between them and the frames between are sampled along it, which is what a
// radar nowcast does. One vector for the whole grid is enough at this scale:
// a fifty-kilometre frame sees one weather system, not several going different
// ways.

import { WET_MM } from './weather';
import { SEQUENCE_LOOPS, type GridFrame } from './precipitation-grid';

export type Flow = { dx: number; dy: number };
export type FlowState = { timestamp: number; cells: number[] };

const STILL: Flow = { dx: 0, dy: 0 };

// The fastest displacement worth searching for, in kilometres an hour. Weather
// over Denmark runs well under this; it is here to bound the search, which
// costs the square of it, rather than to express a belief about the wind.
export const MAX_FLOW_KMH = 75;
// A displacement is only believed when it explains the pair this much better
// than standing still does. Without the margin a nearly uniform field matches
// almost equally well at every offset, and the map would set off along a
// different vector every hour on the strength of rounding.
export const FLOW_MARGIN = 0.92;

function sameField(a: number[], b: number[]) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

// Runs of frames carrying the same field collapse to one state, placed at the
// middle of the run. That is what turns the provider's four identical quarters
// back into the single hourly state they were made from, and it does so
// without hardcoding anywhere that they are hourly: a provider that does
// publish sub-hourly data yields more states here, and a better animation,
// with nothing to change.
export function distinctStates(frames: GridFrame[]): FlowState[] {
  if (!frames.length) return [];
  const states: FlowState[] = [];
  let start = 0;
  for (let index = 1; index <= frames.length; index += 1) {
    if (index < frames.length && sameField(frames[start].cells, frames[index].cells)) continue;
    states.push({ timestamp: (frames[start].timestamp + frames[index - 1].timestamp) / 2, cells: frames[start].cells });
    start = index;
  }
  return states;
}

// How badly this offset explains the pair: squared difference summed over
// everywhere either field reaches at it, with anything off a lattice read as
// dry, over the constant size of the lattice.
//
// Both of those are deliberate. Scoring only the cells the two still share
// lets the search hide a mismatch rather than explain it, because sliding the
// wet part out of the compared region scores a perfect zero: measured that
// way, a shower moving three cells east was confidently reported as moving
// seven cells west. Counting the union instead charges for rain left
// unmatched on either side. And dividing by a constant rather than by however
// much happened to be compared keeps the offsets comparable; dividing by the
// count would make every large offset look cheap for having spread the same
// error over more cells.
function difference(from: number[], to: number[], columns: number, rows: number, dx: number, dy: number) {
  let sum = 0;
  for (let y = Math.min(0, -dy); y < Math.max(rows, rows - dy); y += 1) {
    for (let x = Math.min(0, -dx); x < Math.max(columns, columns - dx); x += 1) {
      const before = x < 0 || y < 0 || x >= columns || y >= rows ? 0 : from[y * columns + x];
      const toX = x + dx;
      const toY = y + dy;
      const after = toX < 0 || toY < 0 || toX >= columns || toY >= rows ? 0 : to[toY * columns + toX];
      sum += (before - after) * (before - after);
    }
  }
  return sum / (columns * rows);
}

// The whole-cell displacement that best carries `from` onto `to`. Whole cells
// are enough: the frames between are sampled at fractions of the vector, so
// the motion it produces is continuous even though the vector is not.
//
// A long straight band can be slid a little along its own length without
// changing the picture, so on one the answer is only pinned down across the
// band and drifts along it. That is a property of the field, not a fault to
// correct: the component it cannot determine is the one that makes no visible
// difference to what is drawn.
export function estimateFlow(from: number[], to: number[], columns: number, rows: number, maxShift: number): Flow {
  if (columns < 2 || rows < 2 || from.length !== columns * rows || to.length !== columns * rows) return STILL;
  // Two dry fields match at every offset, and the best of them would be noise.
  if (!from.some(mm => mm >= WET_MM) && !to.some(mm => mm >= WET_MM)) return STILL;
  const still = difference(from, to, columns, rows, 0, 0);
  const limit = Math.max(0, Math.min(Math.floor(maxShift), columns - 1, rows - 1));
  let best: (Flow & { error: number }) | null = null;
  for (let dy = -limit; dy <= limit; dy += 1) {
    for (let dx = -limit; dx <= limit; dx += 1) {
      const error = difference(from, to, columns, rows, dx, dy);
      if (!best || error < best.error) best = { dx, dy, error };
    }
  }
  return best && best.error < still * FLOW_MARGIN ? { dx: best.dx, dy: best.dy } : STILL;
}

// How far the search may reach for a given gap between states, in cells.
export function flowLimit(gapMs: number, spacingKm: number) {
  if (!(gapMs > 0) || !(spacingKm > 0)) return 0;
  return Math.ceil(MAX_FLOW_KMH * (gapMs / 3_600_000) / spacingKm);
}

// One displacement per consecutive pair. This is the only part of drawing the
// map that costs anything, and it runs when a new model run arrives, roughly
// every three hours, not once per drawn frame.
export function estimateFlows(states: FlowState[], columns: number, rows: number, spacingKm: number): Flow[] {
  const flows: Flow[] = [];
  for (let index = 0; index + 1 < states.length; index += 1) {
    const gap = states[index + 1].timestamp - states[index].timestamp;
    flows.push(estimateFlow(states[index].cells, states[index + 1].cells, columns, rows, flowLimit(gap, spacingKm)));
  }
  return flows;
}

function median3(a: number, b: number, c: number) {
  return Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
}

// One estimate can be badly wrong where a state has little in the frame to
// match on: rain part way in at the start of the sequence, or gone by the end.
// Measured on a band crossing the frame, the first pair came back at (1, -7)
// against (5, -1) for every pair after it, and one hour of the animation
// lurched sideways before the rest of it set off correctly. Weather does not
// change direction from one hour to the next, so each estimate is replaced by
// the median of itself and its neighbours, which drops a lone disagreement and
// leaves a genuine turn alone. At the ends the window looks inward, since an
// end is where a bad estimate is likeliest and there is no outer neighbour to
// outvote it.
export function steadyFlows(flows: Flow[]): Flow[] {
  if (flows.length < 3) return flows;
  const last = flows.length - 1;
  return flows.map((flow, index) => {
    const at = index === 0 ? [0, 1, 2] : index === last ? [last - 2, last - 1, last] : [index - 1, index, index + 1];
    const [a, b, c] = at.map(pick => flows[pick]);
    return { dx: median3(a.dx, b.dx, c.dx), dy: median3(a.dy, b.dy, c.dy) };
  });
}

// Bilinear, with anything off the lattice read as dry rather than clamped. The
// lattice already carries a cell of margin past the view
// (lib/precipitation-grid.ts), and repeating its edge inward would smear the
// last known value across the frame as the field is carried off it.
function sample(cells: number[], columns: number, rows: number, x: number, y: number) {
  if (x <= -1 || y <= -1 || x >= columns || y >= rows) return 0;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const at = (cx: number, cy: number) => cx < 0 || cy < 0 || cx >= columns || cy >= rows ? 0 : cells[cy * columns + cx];
  const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
  const bottom = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
  return top * (1 - fy) + bottom * fy;
}

// The field at a moment, carried along the flow. Whatever is standing at a
// cell now was that fraction of the displacement behind it in the earlier
// state and will be the remainder ahead of it in the later one, so both are
// sampled along the vector before they are blended. That is the difference
// between a shower crossing the map and a shower fading out of one place and
// into another. Outside the sequence the nearest state is held: there is
// nothing to interpolate towards.
export function advectedCells(states: FlowState[], flows: Flow[], columns: number, rows: number, at: number): number[] {
  if (!states.length) return [];
  if (states.length < 2 || at <= states[0].timestamp) return states[0].cells;
  const last = states[states.length - 1];
  if (at >= last.timestamp) return last.cells;
  let index = 0;
  while (index + 2 < states.length && states[index + 1].timestamp <= at) index += 1;
  const from = states[index];
  const to = states[index + 1];
  const span = to.timestamp - from.timestamp;
  const fraction = span > 0 ? (at - from.timestamp) / span : 0;
  const flow = flows[index] ?? STILL;
  const backX = fraction * flow.dx;
  const backY = fraction * flow.dy;
  const forwardX = (1 - fraction) * flow.dx;
  const forwardY = (1 - fraction) * flow.dy;
  const cells = new Array<number>(columns * rows);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const earlier = sample(from.cells, columns, rows, x - backX, y - backY);
      const later = sample(to.cells, columns, rows, x + forwardX, y + forwardY);
      cells[y * columns + x] = earlier * (1 - fraction) + later * fraction;
    }
  }
  return cells;
}

// The canvas is repainted at most this often. The field crosses the frame in
// one pass of the scene, which is about two cells a second, so twenty-five
// paints a second carry it under a tenth of a cell at a time: continuous to
// look at, and a fraction of what repainting on every animation frame would
// ask of a Fire TV.
export const MIN_DRAW_MS = 40;
// How often React is told where the playhead is. Far less often than the
// canvas is painted: the label counts forecast minutes and there are six hours
// of them inside one pass, so a faster tick is a blur and a slower one a jump.
export const PLAYHEAD_MS = 200;

// How far through the sequence the scene has got, from how long it has been on
// screen, and whether it has played its allotted passes.
//
// Read from the clock rather than counted in ticks, so a frame that arrives
// late lands where it belongs instead of behind: a counter driven by an
// interval bunches up whenever the page is busy, and bunched frames are what
// not being smooth looks like.
//
// `progress` runs 0 to 1 inside each pass. After the last one it holds at 1
// and `done` is set, so the sequence plays exactly `loops` times and then
// stands on its final moment rather than starting a third. The scene is on
// screen for exactly `sceneMs`, so on the display the two coincide; the
// counting is what makes it true anyway when the scene lingers, which it does
// under the `?scene=map` pin.
export type SequencePosition = { progress: number; done: boolean };

export function sequencePosition(elapsedMs: number, sceneMs: number, loops = SEQUENCE_LOOPS): SequencePosition {
  const passes = Math.max(1, loops);
  const pass = sceneMs / passes;
  if (!(pass > 0)) return { progress: 0, done: true };
  if (!(elapsedMs > 0)) return { progress: 0, done: false };
  if (elapsedMs >= pass * passes) return { progress: 1, done: true };
  return { progress: (elapsedMs % pass) / pass, done: false };
}

// The forecast moment a position through the sequence stands for.
export function momentAt(start: number, end: number, progress: number) {
  if (!(end > start)) return start;
  return start + (end - start) * Math.min(Math.max(progress, 0), 1);
}
