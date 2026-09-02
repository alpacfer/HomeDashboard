// Forecast precipitation for the map, as a grid of 15-minute totals.
//
// The map used to replay two hours of observed radar and show nothing ahead of
// now, which is the wrong half of the question for a wall display: you want to
// know whether the rain is coming here, not where it has been. It now shows
// the forecast and only the forecast.
//
// Steps are 15 minutes, not hourly, because the point of the animation is
// movement. Hourly frames jump too far to read as weather crossing the map.
//
// The data is the same DMI Harmonie run the pinned panel uses, requested
// through Open-Meteo, which accepts many coordinates in one call. That choice
// is what makes this cheap. DMI's own EDR has a `cube` query for exactly this,
// but it only accepts its native Lambert projection, so every cell would have
// to be reprojected and would land on the map rotated by about 16 degrees
// against north. Asking in latitude and longitude gives axis-aligned cells and
// no projection code at all.
//
// Requesting one point per Harmonie cell also means Open-Meteo snaps each one
// to that cell's centre, so the returned coordinates differ slightly from the
// requested ones. The drawing geometry deliberately uses the requested lattice,
// which is regular and therefore gap-free; snapped centres are irregular and
// would leave seams and overlaps.

import { precipitationBand, WET_MM, type Band } from './weather';

export type MapBounds = { south: number; west: number; north: number; east: number };
export type Cell = { south: number; west: number; north: number; east: number };
export type GridFrame = { timestamp: number; cells: number[] };
export type PrecipitationGrid = { columns: number; rows: number; frames: GridFrame[] };

// The radar map's own extent, so the overlay covers exactly what is drawn.
export const MAP_BOUNDS: MapBounds = { south: 55.64, west: 12.18, north: 55.965, east: 12.67 };
// Harmonie DINI is a 2 km model and this box is roughly 30 by 36 km, so this is
// its native resolution. Going finer would invent detail the model does not have.
export const GRID_COLUMNS = 15;
export const GRID_ROWS = 18;
export const GRID_HOURS = 6;
// 15-minute steps over the forecast window. The animation reads as movement at
// this spacing and as a slideshow at hourly spacing.
export const GRID_STEP_MINUTES = 15;
export const GRID_STEPS = GRID_HOURS * (60 / GRID_STEP_MINUTES);

export function cellCentres(bounds = MAP_BOUNDS, columns = GRID_COLUMNS, rows = GRID_ROWS) {
  const centres: Array<{ latitude: number; longitude: number }> = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      centres.push({
        latitude: bounds.south + (bounds.north - bounds.south) * (row + 0.5) / rows,
        longitude: bounds.west + (bounds.east - bounds.west) * (column + 0.5) / columns,
      });
    }
  }
  return centres;
}

// Row-major from the south-west, matching cellCentres.
export function cellAt(index: number, bounds = MAP_BOUNDS, columns = GRID_COLUMNS, rows = GRID_ROWS): Cell {
  const row = Math.floor(index / columns);
  const column = index % columns;
  const height = (bounds.north - bounds.south) / rows;
  const width = (bounds.east - bounds.west) / columns;
  return {
    south: bounds.south + row * height,
    north: bounds.south + (row + 1) * height,
    west: bounds.west + column * width,
    east: bounds.west + (column + 1) * width,
  };
}

export function precipitationGridUrl(bounds = MAP_BOUNDS, columns = GRID_COLUMNS, rows = GRID_ROWS, hours = GRID_HOURS) {
  const centres = cellCentres(bounds, columns, rows);
  const query = new URLSearchParams({
    latitude: centres.map(centre => centre.latitude.toFixed(4)).join(','),
    longitude: centres.map(centre => centre.longitude.toFixed(4)).join(','),
    minutely_15: 'precipitation',
    forecast_minutely_15: String(hours * (60 / GRID_STEP_MINUTES)),
    timeformat: 'unixtime',
    timezone: 'GMT',
    models: 'dmi_seamless',
  });
  return 'https://api.open-meteo.com/v1/forecast?' + query.toString();
}

type Location = { minutely_15?: { time?: unknown; precipitation?: unknown } };

function series(location: unknown) {
  const steps = (location as Location | null)?.minutely_15;
  const time = steps?.time;
  const precipitation = steps?.precipitation;
  if (!Array.isArray(time) || !Array.isArray(precipitation) || !time.length || precipitation.length !== time.length) return null;
  if (!time.every(stamp => Number.isFinite(stamp) && stamp > 0)) return null;
  if (!precipitation.every(value => value === null || Number.isFinite(value))) return null;
  return { time: time as number[], precipitation: precipitation as (number | null)[] };
}

// A grid with a location missing, or with locations that disagree about their
// timesteps, cannot be drawn as one frame and is rejected whole. A partial
// overlay would read as "no rain here", which is worse than no overlay.
export function parsePrecipitationGrid(payload: unknown, columns = GRID_COLUMNS, rows = GRID_ROWS): PrecipitationGrid | null {
  if (!Array.isArray(payload) || payload.length !== columns * rows) return null;
  const parsed = payload.map(series);
  if (parsed.some(location => location === null)) return null;
  const locations = parsed as Array<{ time: number[]; precipitation: (number | null)[] }>;
  const [first] = locations;
  if (locations.some(location => location.time.length !== first.time.length)) return null;
  if (locations.some(location => location.time.some((stamp, step) => stamp !== first.time[step]))) return null;

  const frames = first.time.map((stamp, step) => ({
    timestamp: stamp * 1000,
    // A null sample means the model said nothing for that cell and hour, which
    // is not the same as dry, but zero is the only honest thing to draw and it
    // matches how a dry cell is treated everywhere else.
    cells: locations.map(location => location.precipitation[step] ?? 0),
  }));
  return { columns, rows, frames };
}

// Every frame is kept, wet or dry. Dropping the dry ones would make the
// animation jump over gaps, and a shower crossing the map is only legible if
// the frames either side of it are there too. A forecast with no precipitation
// anywhere is a state to announce, not an empty animation to play.
export function hasPrecipitation(grid: PrecipitationGrid) {
  return grid.frames.some(frame => frame.cells.some(millimetres => millimetres >= WET_MM));
}

// The same intensity bands as the pinned forecast ribbon, so a colour means the
// same thing on the map as it does in the panel.
export function cellBand(millimetres: number): Band {
  return precipitationBand(millimetres);
}

// Frames whose time has passed must not be animated: after a night without a
// refresh the early part of the sequence describes hours that are already over.
// If nothing is left ahead of now, the forecast has been overtaken and the map
// has nothing honest to show. This also means the quiet hours need no separate
// staleness rule: a run fetched at 23:00 stays valid until its last frame.
export function futureFrames(grid: PrecipitationGrid, now: number) {
  return grid.frames.filter(frame => frame.timestamp > now);
}

// The sequence plays twice while the scene is on screen. Deriving the frame
// length from the scene budget rather than fixing it keeps that true as the
// leading frames expire and the sequence shortens through the hour: at 24
// frames each gets 625ms, at 20 frames 750ms, and either way the loop lands
// twice. A hardcoded interval would drift out of the budget instead.
export const SEQUENCE_LOOPS = 2;

export function frameInterval(frameCount: number, sceneMs: number, loops = SEQUENCE_LOOPS) {
  if (frameCount < 1 || sceneMs <= 0) return 0;
  return sceneMs / (frameCount * Math.max(1, loops));
}

// The animation is easier to place with a timeline than with a caption. A
// playhead on a track shows how far through the forecast the frame is at a
// glance; "Forecast 23:45, in 45 min" has to be read and then worked out.
export type TimelineTick = { position: number; label: string; timestamp: number };

const tickFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Copenhagen', hour: '2-digit', hourCycle: 'h23' });

// 0 at the first frame, 1 at the last. A single frame has nowhere to travel, so
// it sits at the start rather than dividing by zero.
export function playheadPosition(frames: GridFrame[], index: number) {
  if (frames.length < 2) return 0;
  const span = frames[frames.length - 1].timestamp - frames[0].timestamp;
  if (span <= 0) return 0;
  const clamped = Math.min(Math.max(index, 0), frames.length - 1);
  return (frames[clamped].timestamp - frames[0].timestamp) / span;
}

// One tick per whole hour inside the span. Ticks are placed by time rather than
// by frame count so they stay put as the leading frames expire.
export function timelineTicks(frames: GridFrame[]): TimelineTick[] {
  if (frames.length < 2) return [];
  const start = frames[0].timestamp;
  const end = frames[frames.length - 1].timestamp;
  const span = end - start;
  if (span <= 0) return [];
  const ticks: TimelineTick[] = [];
  for (let timestamp = Math.ceil(start / 3600000) * 3600000; timestamp <= end; timestamp += 3600000) {
    ticks.push({ timestamp, position: (timestamp - start) / span, label: tickFormat.format(new Date(timestamp)) });
  }
  return ticks;
}

// Nobody is in front of the display in the small hours, so the grid is not
// refetched then. The animation keeps playing whatever it already holds: the
// point is to stop spending requests on an audience of nobody, not to blank the
// map. Refreshing resumes at 03:00 Copenhagen time.
const QUIET_FROM_HOUR = 0;
const QUIET_UNTIL_HOUR = 3;
const quietFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Copenhagen', hour: '2-digit', hourCycle: 'h23' });

export function isQuietHours(timestamp: number) {
  const hour = Number(quietFormat.format(new Date(timestamp)).slice(0, 2));
  return hour >= QUIET_FROM_HOUR && hour < QUIET_UNTIL_HOUR;
}
