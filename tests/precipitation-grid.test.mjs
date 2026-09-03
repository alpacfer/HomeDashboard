import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CELL_KM, cellAt, cellBand, cellCentres, coversView, DEFAULT_GRID, displayFrames, frameInterval, futureFrames, GRID_FETCH_STEPS,
  GRID_HOURS, GRID_STEP_MINUTES, GRID_STEPS, gridForView, hasPrecipitation, isQuietHours, MAP_BOUNDS, MAX_GRID_POINTS, MAX_URL_LENGTH,
  parsePrecipitationGrid, playheadPosition, precipitationGridUrl, quietHoursEnd, SEQUENCE_LOOPS, timelineTicks,
} from '../lib/precipitation-grid.ts';
import { MAP_MS } from '../lib/panel-rotation.ts';

const SPEC = DEFAULT_GRID;
const POINTS = SPEC.columns * SPEC.rows;

function grid({ locations = POINTS, times = [1756843200, 1756846800], fill = () => 0 } = {}) {
  return Array.from({ length: locations }, (_, index) => ({
    latitude: 55.7, longitude: 12.4,
    minutely_15: { time: times, precipitation: times.map((_, step) => fill(index, step)) },
  }));
}

function parse(payload, spec = SPEC) {
  return parsePrecipitationGrid(payload, spec);
}

// The Fire TV frame at 1280 x 720 once the map is fitted: about 50 by 38 km.
const TV_VIEW = { south: 55.63, west: 12.03, north: 55.97, east: 12.83 };

test('the lattice is built from the view at the chosen spacing, with a margin', () => {
  const spec = gridForView(TV_VIEW);
  // 0.8 degrees of longitude at 55.8 N is about 50 km and 0.34 degrees of
  // latitude about 38 km. At 3 km that is 17 by 13 cells plus a cell of margin
  // each side: 19 by 15, 285 points, each one an Open-Meteo call.
  assert.equal(spec.spacingKm, CELL_KM);
  assert.equal(spec.columns, 19);
  assert.equal(spec.rows, 15);
  assert.ok(spec.columns * spec.rows <= MAX_GRID_POINTS);
  // A smaller frame stays at the same spacing with fewer points.
  const small = gridForView({ south: 55.7, west: 12.3, north: 55.9, east: 12.7 });
  assert.equal(small.spacingKm, CELL_KM);
  assert.ok(small.columns * small.rows < spec.columns * spec.rows);
  // The grid extends past every edge of the view, centred on it.
  assert.ok(coversView(spec.bounds, TV_VIEW));
  assert.ok(Math.abs((spec.bounds.west + spec.bounds.east) / 2 - (TV_VIEW.west + TV_VIEW.east) / 2) < 1e-9);
  assert.ok(Math.abs((spec.bounds.south + spec.bounds.north) / 2 - (TV_VIEW.south + TV_VIEW.north) / 2) < 1e-9);
  // Not by more than about a cell and a half, or the points are wasted off screen.
  const cellLongitude = (spec.bounds.east - spec.bounds.west) / spec.columns;
  assert.ok(TV_VIEW.west - spec.bounds.west < cellLongitude * 1.5);
  assert.ok(spec.bounds.east - TV_VIEW.east < cellLongitude * 1.5);
});

test('a frame that would need too many points gets a coarser lattice, not a bigger bill', () => {
  const wide = gridForView({ south: 55, west: 11, north: 57, east: 15 });
  assert.ok(wide.columns * wide.rows <= MAX_GRID_POINTS);
  assert.ok(wide.spacingKm > CELL_KM);
  assert.ok(coversView(wide.bounds, { south: 55, west: 11, north: 57, east: 15 }));
});

test('a view that has not been laid out falls back to the framing box', () => {
  for (const view of [{ south: 0, west: 0, north: 0, east: 0 }, { south: 56, west: 12, north: 55, east: 13 }, { south: NaN, west: 12, north: 56, east: 13 }]) {
    assert.deepEqual(gridForView(view), DEFAULT_GRID, JSON.stringify(view));
  }
  assert.ok(coversView(DEFAULT_GRID.bounds, MAP_BOUNDS));
});

test('coverage means past every edge', () => {
  const box = { south: 55, west: 12, north: 56, east: 13 };
  assert.equal(coversView(box, box), true);
  assert.equal(coversView(box, { ...box, east: 13.1 }), false);
  assert.equal(coversView(box, { ...box, south: 54.9 }), false);
  assert.equal(coversView(box, { south: 55.2, west: 12.2, north: 55.8, east: 12.8 }), true);
});

test('cell centres tile the grid bounds without gaps or overlaps', () => {
  const centres = cellCentres(SPEC);
  assert.equal(centres.length, POINTS);
  const { bounds, columns } = SPEC;
  assert.ok(centres.every(c => c.latitude > bounds.south && c.latitude < bounds.north));
  assert.ok(centres.every(c => c.longitude > bounds.west && c.longitude < bounds.east));
  // Row-major from the south-west: the first row shares a latitude.
  assert.equal(centres[0].latitude, centres[columns - 1].latitude);
  assert.ok(centres[columns].latitude > centres[0].latitude);
});

test('cells cover the bounds exactly and abut their neighbours', () => {
  const { bounds, columns, rows } = SPEC;
  const first = cellAt(0, SPEC);
  const last = cellAt(POINTS - 1, SPEC);
  assert.ok(Math.abs(first.south - bounds.south) < 1e-9);
  assert.equal(first.west, bounds.west);
  assert.ok(Math.abs(last.north - bounds.north) < 1e-9);
  assert.ok(Math.abs(last.east - bounds.east) < 1e-9);
  // A seam between neighbours would show as a line across the overlay.
  assert.equal(cellAt(0, SPEC).east, cellAt(1, SPEC).west);
  assert.equal(cellAt(0, SPEC).north, cellAt(columns, SPEC).south);
  // Rows are spaced in Web Mercator, where a degree of latitude gets taller
  // towards the pole, so the northern rows span slightly fewer degrees than
  // the southern ones and every row is the same height in pixels. That is
  // what lets the whole grid be drawn as one scaled image.
  const heights = Array.from({ length: rows }, (_, row) => { const cell = cellAt(row * columns, SPEC); return cell.north - cell.south; });
  for (let row = 1; row < rows; row += 1) assert.ok(heights[row] < heights[row - 1], 'row ' + row);
  assert.ok(heights[0] / heights[rows - 1] < 1.02, 'the difference is slight at this scale');
  // Each cell contains its own centre.
  const centres = cellCentres(SPEC);
  for (const index of [0, 7, columns + 3, POINTS - 1]) {
    const cell = cellAt(index, SPEC);
    const centre = centres[index];
    assert.ok(centre.latitude > cell.south && centre.latitude < cell.north, 'centre outside cell ' + index);
    assert.ok(centre.longitude > cell.west && centre.longitude < cell.east, 'centre outside cell ' + index);
  }
});

test('the request asks one point per cell, in 15-minute steps, from the named Harmonie model', () => {
  const url = new URL(precipitationGridUrl(SPEC));
  assert.equal(url.origin + url.pathname, 'https://api.open-meteo.com/v1/forecast');
  assert.equal(url.searchParams.get('models'), 'dmi_harmonie_arome_europe');
  // 15-minute steps are what make the animation read as movement rather than a
  // slideshow, so the request must ask for them and not hourly totals.
  assert.equal(url.searchParams.get('minutely_15'), 'precipitation');
  assert.equal(url.searchParams.get('hourly'), null);
  // Twelve hours are fetched so the six that are shown stay six between refreshes.
  assert.equal(url.searchParams.get('forecast_minutely_15'), String(GRID_FETCH_STEPS));
  assert.equal(GRID_STEPS, GRID_HOURS * (60 / GRID_STEP_MINUTES));
  assert.ok(GRID_FETCH_STEPS >= GRID_STEPS * 2);
  assert.equal(url.searchParams.get('timezone'), 'GMT');
  const latitudes = url.searchParams.get('latitude').split(',');
  const longitudes = url.searchParams.get('longitude').split(',');
  assert.equal(latitudes.length, POINTS);
  assert.equal(longitudes.length, latitudes.length);
  // One request, not one per cell: that is what makes this affordable.
  assert.ok(!/probability/.test(decodeURIComponent(url.search)), 'no probability field may be requested');
});

test('parses a full grid into one frame per timestep and keeps its lattice', () => {
  const parsed = parsePrecipitationGrid(grid({ fill: (index, step) => index === 4 ? step + 1 : 0 }), SPEC, 1788436800_000, 5);
  assert.equal(parsed.frames.length, 2);
  assert.equal(parsed.columns, SPEC.columns);
  assert.equal(parsed.rows, SPEC.rows);
  assert.deepEqual(parsed.bounds, SPEC.bounds);
  assert.equal(parsed.run, 1788436800_000);
  assert.equal(parsed.fetchedAt, 5);
  assert.equal(parsed.frames[0].timestamp, 1756843200 * 1000);
  assert.equal(parsed.frames[0].cells.length, POINTS);
  assert.equal(parsed.frames[0].cells[4], 1);
  assert.equal(parsed.frames[1].cells[4], 2);
  assert.equal(parse(grid()).run, null);
});

test('rejects a grid it cannot draw whole rather than showing a partial one', () => {
  // A missing cell would render as "no rain here", which is worse than nothing.
  assert.equal(parse(grid({ locations: POINTS - 1 })), null);
  assert.equal(parse(null), null);
  assert.equal(parse({}), null);
  assert.equal(parse([]), null);
  // Locations must agree on their timesteps or a frame mixes different hours.
  const ragged = grid();
  ragged[9].minutely_15.time = [1756843200];
  ragged[9].minutely_15.precipitation = [0];
  assert.equal(parse(ragged), null);
  const shifted = grid();
  shifted[9].minutely_15.time = [1756843200, 1756850400];
  assert.equal(parse(shifted), null);
  const broken = grid();
  broken[3].minutely_15.precipitation = [0, 'wet'];
  assert.equal(parse(broken), null);
});

test('a null sample draws as dry rather than breaking the frame', () => {
  const holed = grid();
  holed[2].minutely_15.precipitation = [null, 1];
  const parsed = parse(holed);
  assert.equal(parsed.frames[0].cells[2], 0);
  assert.equal(parsed.frames[1].cells[2], 1);
});

test('keeps every frame so the animation cannot jump over dry gaps', () => {
  // Dropping dry frames would make a shower teleport across the map. A dry
  // forecast is a state to announce, not an empty animation to play.
  const parsed = parse(grid({ times: [1, 2, 3], fill: (index, step) => step === 1 && index === 0 ? 0.5 : 0 }));
  assert.equal(parsed.frames.length, 3);
  assert.equal(hasPrecipitation(parsed.frames), true);
  // Trace amounts below the shared wet threshold are not precipitation.
  assert.equal(hasPrecipitation(parse(grid({ fill: () => 0.01 })).frames), false);
  assert.equal(hasPrecipitation(parse(grid({ fill: () => 0 })).frames), false);
});

test('animates only the frames still ahead of now, and only six hours of them', () => {
  // After a night with no refresh, the start of the sequence is already over.
  const parsed = parse(grid({ times: [1000, 2000, 3000] }));
  assert.deepEqual(futureFrames(parsed, 1_500_000).map(frame => frame.timestamp), [2_000_000, 3_000_000]);
  assert.deepEqual(futureFrames(parsed, 500_000).map(frame => frame.timestamp), [1_000_000, 2_000_000, 3_000_000]);
  // Nothing ahead of now means the forecast has been overtaken.
  assert.deepEqual(futureFrames(parsed, 4_000_000), []);
  // Twelve hours are held; the window shown stays six hours as they expire.
  const start = 1756843200;
  const long = parse(grid({ times: Array.from({ length: GRID_FETCH_STEPS }, (_, step) => start + step * 900) }));
  assert.equal(displayFrames(long, start * 1000 - 1).length, GRID_STEPS);
  assert.equal(displayFrames(long, start * 1000 - 1)[0].timestamp, start * 1000);
  const later = displayFrames(long, (start + 5 * 3600) * 1000);
  assert.equal(later.length, GRID_STEPS);
  assert.equal(later[0].timestamp, (start + 5 * 3600 + 900) * 1000);
  // Past the slack, the window shortens rather than inventing frames.
  assert.equal(displayFrames(long, (start + 10 * 3600) * 1000).length, 2 * 4 - 1);
});

test('requests pause between 23:00 and 06:00 Copenhagen time', () => {
  // Nobody is in front of the display then, so no request is spent.
  const at = (hour, minute = 0) => Date.UTC(2026, 8, 2, hour - 2, minute); // CEST is UTC+2
  assert.equal(isQuietHours(at(23)), true);
  assert.equal(isQuietHours(at(22, 59)), false);
  assert.equal(isQuietHours(at(0, 1)), true);
  assert.equal(isQuietHours(at(3)), true);
  assert.equal(isQuietHours(at(5, 59)), true);
  assert.equal(isQuietHours(at(6)), false, 'requests resume at 06:00');
  assert.equal(isQuietHours(at(12)), false);
  // Winter time: the rule follows Copenhagen's clock, not UTC. CET is UTC+1.
  assert.equal(isQuietHours(Date.UTC(2026, 11, 21, 22, 0)), true, '23:00 CET is quiet');
  assert.equal(isQuietHours(Date.UTC(2026, 11, 21, 21, 59)), false, '22:59 CET is not');
  assert.equal(isQuietHours(Date.UTC(2026, 11, 21, 4, 59)), true, '05:59 CET is quiet');
  assert.equal(isQuietHours(Date.UTC(2026, 11, 21, 5, 0)), false, '06:00 CET is not');
});

test('the end of the quiet hours is the next 06:00, found by the clock', () => {
  const at = (hour, minute = 0) => Date.UTC(2026, 8, 2, hour - 2, minute);
  assert.equal(quietHoursEnd(at(23, 30)), Date.UTC(2026, 8, 3, 4, 0));
  assert.equal(quietHoursEnd(at(2, 7)), at(6));
  // Not quiet means now.
  assert.equal(quietHoursEnd(at(12)), at(12));
  // The night the clocks go back (25 October 2026): 06:00 CET is 05:00 UTC.
  assert.equal(quietHoursEnd(Date.UTC(2026, 9, 24, 22, 0)), Date.UTC(2026, 9, 25, 5, 0));
});

test('map colours use the same intensity bands as the pinned ribbon', () => {
  // A colour must mean the same thing on the map as it does in the panel.
  assert.equal(cellBand(0), 'dry');
  assert.equal(cellBand(0.2), 'trace');
  assert.equal(cellBand(0.5), 'light');
  assert.equal(cellBand(2), 'moderate');
  assert.equal(cellBand(9), 'heavy');
});

test('the timeline places a tick on every whole hour in the span', () => {
  // Ticks are placed by time, not by frame count, so they stay put as the
  // leading frames expire and the span shortens from the left.
  const start = Date.UTC(2026, 8, 2, 20, 40);
  const frames = Array.from({ length: GRID_STEPS }, (_, step) => ({ timestamp: start + step * 900_000, cells: [] }));
  const ticks = timelineTicks(frames);
  assert.deepEqual(ticks.map(tick => tick.label), ['23', '00', '01', '02', '03', '04']);
  assert.ok(ticks.every(tick => tick.timestamp % 3600_000 === 0), 'every tick sits on the hour');
  assert.ok(ticks.every(tick => tick.position >= 0 && tick.position <= 1));
  // Positions rise monotonically, or the labels would cross on screen.
  for (let i = 1; i < ticks.length; i += 1) assert.ok(ticks[i].position > ticks[i - 1].position);
});

test('the playhead runs from the start of the span to its end', () => {
  const start = Date.UTC(2026, 8, 2, 20, 0);
  const frames = Array.from({ length: 5 }, (_, step) => ({ timestamp: start + step * 900_000, cells: [] }));
  assert.equal(playheadPosition(frames, 0), 0);
  assert.equal(playheadPosition(frames, 4), 1);
  assert.equal(playheadPosition(frames, 2), 0.5);
  // Out-of-range indices clamp rather than running off the track.
  assert.equal(playheadPosition(frames, -3), 0);
  assert.equal(playheadPosition(frames, 99), 1);
  // A span with nowhere to travel must not divide by zero.
  assert.equal(playheadPosition([{ timestamp: start, cells: [] }], 0), 0);
  assert.deepEqual(timelineTicks([{ timestamp: start, cells: [] }]), []);
  assert.deepEqual(timelineTicks([]), []);
});

test('the sequence is paced to play twice while the scene is on screen', () => {
  // Fixing the frame length instead would drift out of the scene budget when
  // fewer frames are left than the window asks for.
  assert.equal(frameInterval(GRID_STEPS, MAP_MS), 625);
  assert.equal(GRID_STEPS * frameInterval(GRID_STEPS, MAP_MS) * SEQUENCE_LOOPS, MAP_MS);
  // A shortened sequence still lands exactly twice, just at a slower pace.
  for (const count of [24, 20, 12, 5]) {
    assert.equal(count * frameInterval(count, MAP_MS) * SEQUENCE_LOOPS, MAP_MS, count + ' frames must fill the scene');
  }
  assert.equal(frameInterval(0, MAP_MS), 0, 'no frames means no timer');
  assert.equal(frameInterval(10, 0), 0);
});

test('the grid request always fits inside the 8 KB request line Open-Meteo accepts', () => {
  // A 437-point grid at four decimals was 8.7 KB and answered 414, with no CORS
  // header, so the browser saw a network failure and the map never loaded at
  // the Fire TV's own resolution. The point cap alone does not protect against
  // that; the URL itself has to be bounded.
  assert.ok(MAX_URL_LENGTH <= 8192 - 'GET  HTTP/1.1'.length - 200, 'budget leaves room for the request line and headers nginx counts');
  const views = [
    MAP_BOUNDS,
    // The frame as measured at 1280 x 720: this is the one that failed.
    { south: 55.5858, west: 11.926, north: 56.0197, east: 12.9251 },
    // Wider, taller, and absurd.
    { south: 55.56, west: 11.9, north: 56.04, east: 12.95 },
    { south: 55.3, west: 11.5, north: 56.3, east: 13.3 },
    { south: 54, west: 8, north: 58, east: 16 },
  ];
  for (const view of views) {
    const spec = gridForView(view);
    const url = precipitationGridUrl(spec);
    assert.ok(url.length <= MAX_URL_LENGTH, JSON.stringify(view) + ' produced ' + url.length + ' characters for ' + spec.columns * spec.rows + ' points');
    assert.ok(spec.columns * spec.rows <= MAX_GRID_POINTS);
  }
  // The budget is used, not wasted: the TV frame still gets a dense lattice.
  const tv = gridForView(views[1]);
  assert.ok(tv.columns * tv.rows >= 250, 'only ' + tv.columns * tv.rows + ' points at the TV frame');
});
