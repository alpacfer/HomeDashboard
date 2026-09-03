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
// The lattice is built from whatever the map is actually showing, not from a
// fixed box. The frame is landscape and the area worth seeing (Hillerød down
// to Copenhagen) is portrait, so a fixed box either leaves the sides of the
// frame bare or wastes points on land nobody can see. Rows are spaced equally
// in Web Mercator, the basemap's own projection, so the whole grid maps onto
// the frame as one rectangle and can be drawn with a single scaled image.
//
// Requesting one point per Harmonie cell also means Open-Meteo snaps each one
// to that cell's centre, so the returned coordinates differ slightly from the
// requested ones. The drawing geometry deliberately uses the requested lattice,
// which is regular and therefore gap-free; snapped centres are irregular and
// would leave seams and overlaps.

import { precipitationBand, WET_MM, type Band } from './weather';

export type MapBounds = { south: number; west: number; north: number; east: number };
export type Cell = { south: number; west: number; north: number; east: number };
export type GridSpec = { bounds: MapBounds; columns: number; rows: number; spacingKm: number };
export type GridFrame = { timestamp: number; cells: number[] };
export type PrecipitationGrid = GridSpec & {
  frames: GridFrame[];
  // The model run these frames came from, when the metadata said, and the
  // moment they were fetched. Both drive the refresh decision in
  // lib/forecast-refresh.ts.
  run: number | null;
  fetchedAt: number;
};

// What the map is framed on: Hillerød in the north down to Copenhagen in the
// south. The frame is wider than this box, and the grid covers the frame.
export const MAP_BOUNDS: MapBounds = { south: 55.64, west: 12.18, north: 55.965, east: 12.67 };
// Harmonie DINI is a 2 km model, so this is its native resolution. Going finer
// would invent detail the model does not have; the smoothing happens when the
// grid is drawn, not when it is requested.
export const CELL_KM = 2;
// Open-Meteo counts each coordinate as a call and allows 600 calls a minute,
// so one request must stay well inside that on its own: a request that trips
// the limit is answered 429 and the map gets nothing. A frame that would need
// more points at 2 km gets a slightly coarser lattice rather than a bigger
// request. At the Fire TV's 1280 x 720 the frame is about 50 by 38 km, which
// would be about 590 points at 2 km and is about 410 at the 2.4 km this cap
// gives. The smoothing when it is drawn makes the difference invisible; the
// limit is the API's, not the model's.
export const MAX_GRID_POINTS = 450;
// The map shows the next six hours, but twelve are fetched. A run is refetched
// only when a new one is published (see lib/forecast-refresh.ts), and that can
// be three hours apart or longer over the quiet hours, so the sequence needs
// slack behind the six that are shown.
export const GRID_HOURS = 6;
export const GRID_FETCH_HOURS = 12;
// 15-minute steps over the forecast window. The animation reads as movement at
// this spacing and as a slideshow at hourly spacing.
export const GRID_STEP_MINUTES = 15;
export const GRID_STEPS = GRID_HOURS * (60 / GRID_STEP_MINUTES);
export const GRID_FETCH_STEPS = GRID_FETCH_HOURS * (60 / GRID_STEP_MINUTES);

const RADIANS = Math.PI / 180;
const KM_PER_DEGREE = 111.32;

function mercator(latitude: number) {
  return Math.log(Math.tan(Math.PI / 4 + latitude * RADIANS / 2));
}

function inverseMercator(y: number) {
  return (2 * Math.atan(Math.exp(y)) - Math.PI / 2) / RADIANS;
}

function validBounds(bounds: MapBounds) {
  const values = [bounds.south, bounds.west, bounds.north, bounds.east];
  return values.every(Number.isFinite) && bounds.north > bounds.south && bounds.east > bounds.west
    && bounds.north < 85 && bounds.south > -85;
}

// The lattice for a given view: one cell of margin on every side so the
// smoothed edge of the image never shows inside the frame, and the bounds of
// the lattice centred on the view. A degenerate view (a container that has not
// been laid out yet) falls back to the framing box rather than a zero-size grid.
export function gridForView(view: MapBounds): GridSpec {
  const safe = validBounds(view) ? view : MAP_BOUNDS;
  const middle = (safe.north + safe.south) / 2;
  const heightKm = (safe.north - safe.south) * KM_PER_DEGREE;
  const widthKm = (safe.east - safe.west) * KM_PER_DEGREE * Math.cos(middle * RADIANS);
  let spacing = CELL_KM;
  let columns = Math.ceil(widthKm / spacing) + 2;
  let rows = Math.ceil(heightKm / spacing) + 2;
  while (columns * rows > MAX_GRID_POINTS) {
    spacing *= Math.sqrt(columns * rows / MAX_GRID_POINTS) * 1.01;
    columns = Math.ceil(widthKm / spacing) + 2;
    rows = Math.ceil(heightKm / spacing) + 2;
  }
  const cellLatitude = spacing / KM_PER_DEGREE;
  const cellLongitude = spacing / (KM_PER_DEGREE * Math.cos(middle * RADIANS));
  const centreLongitude = (safe.east + safe.west) / 2;
  return {
    bounds: {
      south: middle - rows * cellLatitude / 2,
      north: middle + rows * cellLatitude / 2,
      west: centreLongitude - columns * cellLongitude / 2,
      east: centreLongitude + columns * cellLongitude / 2,
    },
    columns,
    rows,
    spacingKm: spacing,
  };
}

export const DEFAULT_GRID = gridForView(MAP_BOUNDS);

// True when the grid extends past every edge of the view. Anything less leaves
// a bare strip of basemap, which reads as "no rain here".
export function coversView(grid: MapBounds, view: MapBounds) {
  return grid.south <= view.south && grid.north >= view.north && grid.west <= view.west && grid.east >= view.east;
}

function rowEdge(bounds: MapBounds, rows: number, row: number) {
  const south = mercator(bounds.south);
  const north = mercator(bounds.north);
  return inverseMercator(south + (north - south) * row / rows);
}

// Row-major from the south-west.
export function cellCentres({ bounds, columns, rows }: GridSpec) {
  const centres: Array<{ latitude: number; longitude: number }> = [];
  for (let row = 0; row < rows; row += 1) {
    const latitude = rowEdge(bounds, rows * 2, row * 2 + 1);
    for (let column = 0; column < columns; column += 1) {
      centres.push({ latitude, longitude: bounds.west + (bounds.east - bounds.west) * (column + 0.5) / columns });
    }
  }
  return centres;
}

export function cellAt(index: number, { bounds, columns, rows }: GridSpec): Cell {
  const row = Math.floor(index / columns);
  const column = index % columns;
  const width = (bounds.east - bounds.west) / columns;
  return {
    south: rowEdge(bounds, rows, row),
    north: rowEdge(bounds, rows, row + 1),
    west: bounds.west + column * width,
    east: bounds.west + (column + 1) * width,
  };
}

// The model is named outright rather than through `dmi_seamless` so the
// request matches the run metadata in lib/forecast-refresh.ts. Within twelve
// hours the two are the same Harmonie data.
export const GRID_MODEL = 'dmi_harmonie_arome_europe';

export function precipitationGridUrl(spec: GridSpec, steps = GRID_FETCH_STEPS) {
  const centres = cellCentres(spec);
  const query = new URLSearchParams({
    latitude: centres.map(centre => centre.latitude.toFixed(4)).join(','),
    longitude: centres.map(centre => centre.longitude.toFixed(4)).join(','),
    minutely_15: 'precipitation',
    forecast_minutely_15: String(steps),
    timeformat: 'unixtime',
    timezone: 'GMT',
    models: GRID_MODEL,
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
export function parsePrecipitationGrid(payload: unknown, spec: GridSpec, run: number | null = null, fetchedAt = 0): PrecipitationGrid | null {
  const { columns, rows } = spec;
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
  return { ...spec, frames, run, fetchedAt };
}

// Every frame is kept, wet or dry. Dropping the dry ones would make the
// animation jump over gaps, and a shower crossing the map is only legible if
// the frames either side of it are there too. A forecast with no precipitation
// anywhere is a state to announce, not an empty animation to play.
export function hasPrecipitation(frames: GridFrame[]) {
  return frames.some(frame => frame.cells.some(millimetres => millimetres >= WET_MM));
}

// The same intensity bands as the pinned forecast ribbon, so a colour means the
// same thing on the map as it does in the panel.
export function cellBand(millimetres: number): Band {
  return precipitationBand(millimetres);
}

// Frames whose time has passed must not be animated: after a night without a
// refresh the early part of the sequence describes hours that are already over.
// If nothing is left ahead of now, the forecast has been overtaken and the map
// has nothing honest to show.
export function futureFrames(grid: PrecipitationGrid, now: number) {
  return grid.frames.filter(frame => frame.timestamp > now);
}

// What is animated: the next GRID_HOURS of whatever is still ahead. Fetching
// more than is shown is what lets the window stay six hours long between
// refreshes instead of shrinking as the leading frames expire.
export function displayFrames(grid: PrecipitationGrid, now: number) {
  return futureFrames(grid, now).slice(0, GRID_STEPS);
}

// The sequence plays twice while the scene is on screen. Deriving the frame
// length from the scene budget rather than fixing it keeps that true however
// many frames are left: at 24 frames each gets 625ms, at 20 frames 750ms, and
// either way the loop lands twice. A hardcoded interval would drift out of the
// budget instead.
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

// Nobody is in front of the display between late evening and early morning, so
// nothing is requested then: not the grid, and not the run metadata either. The
// animation keeps playing whatever it already holds; the point is to stop
// spending requests on an audience of nobody, not to blank the map. Requests
// resume at 06:00 Copenhagen time, and the twelve-hour window means a run
// fetched in the evening still has frames ahead of now when they do.
export const QUIET_FROM_HOUR = 23;
export const QUIET_UNTIL_HOUR = 6;
const quietFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Copenhagen', hour: '2-digit', hourCycle: 'h23' });

export function isQuietHours(timestamp: number) {
  const hour = Number(quietFormat.format(new Date(timestamp)).slice(0, 2));
  return hour >= QUIET_FROM_HOUR || hour < QUIET_UNTIL_HOUR;
}

// The first moment after `timestamp` that is not quiet, found by stepping the
// clock rather than by arithmetic on hours, so a daylight-saving change in the
// night cannot put it an hour out. If it is not quiet now, it is now.
export function quietHoursEnd(timestamp: number) {
  const step = 15 * 60_000;
  let at = timestamp;
  while (isQuietHours(at)) at = (Math.floor(at / step) + 1) * step;
  return at;
}
