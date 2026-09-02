import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cellAt, cellBand, cellCentres, frameInterval, futureFrames, GRID_COLUMNS, GRID_HOURS, GRID_ROWS, GRID_STEPS,
  GRID_STEP_MINUTES, hasPrecipitation, isQuietHours, MAP_BOUNDS, parsePrecipitationGrid, playheadPosition,
  precipitationGridUrl, SEQUENCE_LOOPS, timelineTicks,
} from '../lib/precipitation-grid.ts';
import { MAP_MS } from '../lib/panel-rotation.ts';

function grid({ locations = GRID_COLUMNS * GRID_ROWS, times = [1756843200, 1756846800], fill = () => 0 } = {}) {
  return Array.from({ length: locations }, (_, index) => ({
    latitude: 55.7, longitude: 12.4,
    minutely_15: { time: times, precipitation: times.map((_, step) => fill(index, step)) },
  }));
}

test('cell centres tile the map bounds without gaps or overlaps', () => {
  const centres = cellCentres();
  assert.equal(centres.length, GRID_COLUMNS * GRID_ROWS);
  // Every centre sits inside the bounds, and the extremes sit half a cell in.
  assert.ok(centres.every(c => c.latitude > MAP_BOUNDS.south && c.latitude < MAP_BOUNDS.north));
  assert.ok(centres.every(c => c.longitude > MAP_BOUNDS.west && c.longitude < MAP_BOUNDS.east));
  const halfRow = (MAP_BOUNDS.north - MAP_BOUNDS.south) / GRID_ROWS / 2;
  assert.ok(Math.abs(centres[0].latitude - (MAP_BOUNDS.south + halfRow)) < 1e-9);
  // Row-major from the south-west: the first row shares a latitude.
  assert.equal(centres[0].latitude, centres[GRID_COLUMNS - 1].latitude);
  assert.notEqual(centres[0].latitude, centres[GRID_COLUMNS].latitude);
});

test('cells cover the bounds exactly and abut their neighbours', () => {
  const first = cellAt(0);
  const last = cellAt(GRID_COLUMNS * GRID_ROWS - 1);
  assert.equal(first.south, MAP_BOUNDS.south);
  assert.equal(first.west, MAP_BOUNDS.west);
  assert.ok(Math.abs(last.north - MAP_BOUNDS.north) < 1e-9);
  assert.ok(Math.abs(last.east - MAP_BOUNDS.east) < 1e-9);
  // A seam between neighbours would show as a line across the overlay.
  assert.equal(cellAt(0).east, cellAt(1).west);
  assert.equal(cellAt(0).north, cellAt(GRID_COLUMNS).south);
  // Each cell contains its own centre.
  const centres = cellCentres();
  for (const index of [0, 7, GRID_COLUMNS + 3, GRID_COLUMNS * GRID_ROWS - 1]) {
    const cell = cellAt(index);
    const centre = centres[index];
    assert.ok(centre.latitude > cell.south && centre.latitude < cell.north, 'centre outside cell ' + index);
    assert.ok(centre.longitude > cell.west && centre.longitude < cell.east, 'centre outside cell ' + index);
  }
});

test('the request asks one point per cell, in 15-minute steps, DMI only', () => {
  const url = new URL(precipitationGridUrl());
  assert.equal(url.origin + url.pathname, 'https://api.open-meteo.com/v1/forecast');
  assert.equal(url.searchParams.get('models'), 'dmi_seamless');
  // 15-minute steps are what make the animation read as movement rather than a
  // slideshow, so the request must ask for them and not hourly totals.
  assert.equal(url.searchParams.get('minutely_15'), 'precipitation');
  assert.equal(url.searchParams.get('hourly'), null);
  assert.equal(url.searchParams.get('forecast_minutely_15'), String(GRID_STEPS));
  assert.equal(GRID_STEPS, GRID_HOURS * (60 / GRID_STEP_MINUTES));
  assert.equal(url.searchParams.get('timezone'), 'GMT');
  const latitudes = url.searchParams.get('latitude').split(',');
  const longitudes = url.searchParams.get('longitude').split(',');
  assert.equal(latitudes.length, GRID_COLUMNS * GRID_ROWS);
  assert.equal(longitudes.length, latitudes.length);
  // One request, not one per cell: that is what makes this affordable.
  assert.ok(!/probability/.test(decodeURIComponent(url.search)), 'no probability field may be requested');
});

test('parses a full grid into one frame per timestep', () => {
  const parsed = parsePrecipitationGrid(grid({ fill: (index, step) => index === 4 ? step + 1 : 0 }));
  assert.equal(parsed.frames.length, 2);
  assert.equal(parsed.columns, GRID_COLUMNS);
  assert.equal(parsed.rows, GRID_ROWS);
  assert.equal(parsed.frames[0].timestamp, 1756843200 * 1000);
  assert.equal(parsed.frames[0].cells.length, GRID_COLUMNS * GRID_ROWS);
  assert.equal(parsed.frames[0].cells[4], 1);
  assert.equal(parsed.frames[1].cells[4], 2);
});

test('rejects a grid it cannot draw whole rather than showing a partial one', () => {
  // A missing cell would render as "no rain here", which is worse than nothing.
  assert.equal(parsePrecipitationGrid(grid({ locations: GRID_COLUMNS * GRID_ROWS - 1 })), null);
  assert.equal(parsePrecipitationGrid(null), null);
  assert.equal(parsePrecipitationGrid({}), null);
  assert.equal(parsePrecipitationGrid([]), null);
  // Locations must agree on their timesteps or a frame mixes different hours.
  const ragged = grid();
  ragged[9].minutely_15.time = [1756843200];
  ragged[9].minutely_15.precipitation = [0];
  assert.equal(parsePrecipitationGrid(ragged), null);
  const shifted = grid();
  shifted[9].minutely_15.time = [1756843200, 1756850400];
  assert.equal(parsePrecipitationGrid(shifted), null);
  const broken = grid();
  broken[3].minutely_15.precipitation = [0, 'wet'];
  assert.equal(parsePrecipitationGrid(broken), null);
});

test('a null sample draws as dry rather than breaking the frame', () => {
  const holed = grid();
  holed[2].minutely_15.precipitation = [null, 1];
  const parsed = parsePrecipitationGrid(holed);
  assert.equal(parsed.frames[0].cells[2], 0);
  assert.equal(parsed.frames[1].cells[2], 1);
});

test('keeps every frame so the animation cannot jump over dry gaps', () => {
  // Dropping dry frames would make a shower teleport across the map. A dry
  // forecast is a state to announce, not an empty animation to play.
  const parsed = parsePrecipitationGrid(grid({ times: [1, 2, 3], fill: (index, step) => step === 1 && index === 0 ? 0.5 : 0 }));
  assert.equal(parsed.frames.length, 3);
  assert.equal(hasPrecipitation(parsed), true);
  // Trace amounts below the shared wet threshold are not precipitation.
  assert.equal(hasPrecipitation(parsePrecipitationGrid(grid({ fill: () => 0.01 }))), false);
  assert.equal(hasPrecipitation(parsePrecipitationGrid(grid({ fill: () => 0 }))), false);
});

test('animates only the frames still ahead of now', () => {
  // After a night with no refresh, the start of the sequence is already over.
  const parsed = parsePrecipitationGrid(grid({ times: [1000, 2000, 3000] }));
  assert.deepEqual(futureFrames(parsed, 1_500_000).map(frame => frame.timestamp), [2_000_000, 3_000_000]);
  assert.deepEqual(futureFrames(parsed, 500_000).map(frame => frame.timestamp), [1_000_000, 2_000_000, 3_000_000]);
  // Nothing ahead of now means the forecast has been overtaken.
  assert.deepEqual(futureFrames(parsed, 4_000_000), []);
});

test('refreshing pauses between midnight and 03:00 Copenhagen time', () => {
  // Nobody is in front of the display then, so the request is not spent.
  const at = (hour, minute = 0) => Date.UTC(2026, 8, 2, hour - 2, minute); // CEST is UTC+2
  assert.equal(isQuietHours(at(0, 1)), true);
  assert.equal(isQuietHours(at(1)), true);
  assert.equal(isQuietHours(at(2, 59)), true);
  assert.equal(isQuietHours(at(3)), false, 'refreshing resumes at 03:00');
  assert.equal(isQuietHours(at(23, 59)), false);
  assert.equal(isQuietHours(at(12)), false);
  // Winter time: the rule follows Copenhagen's clock, not UTC. CET is UTC+1,
  // so 23:00 UTC is already past midnight locally and counts as quiet.
  assert.equal(isQuietHours(Date.UTC(2026, 11, 21, 1, 0)), true, '02:00 CET is quiet');
  assert.equal(isQuietHours(Date.UTC(2026, 11, 21, 23, 0)), true, '00:00 CET is quiet');
  assert.equal(isQuietHours(Date.UTC(2026, 11, 21, 22, 0)), false, '23:00 CET is not');
  assert.equal(isQuietHours(Date.UTC(2026, 11, 21, 2, 0)), false, '03:00 CET is not');
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
  // Fixing the frame length instead would drift out of the scene budget as the
  // leading frames expire and the sequence shortens through the hour.
  assert.equal(frameInterval(GRID_STEPS, MAP_MS), 625);
  assert.equal(GRID_STEPS * frameInterval(GRID_STEPS, MAP_MS) * SEQUENCE_LOOPS, MAP_MS);
  // A shortened sequence still lands exactly twice, just at a slower pace.
  for (const count of [24, 20, 12, 5]) {
    assert.equal(count * frameInterval(count, MAP_MS) * SEQUENCE_LOOPS, MAP_MS, count + ' frames must fill the scene');
  }
  assert.equal(frameInterval(0, MAP_MS), 0, 'no frames means no timer');
  assert.equal(frameInterval(10, 0), 0);
});
