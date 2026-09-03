// When to refetch the forecast grid, and how to know without asking for it.
//
// The grid is DMI Harmonie output that Open-Meteo republishes every three
// hours, and one grid request carries several hundred coordinates, each of
// which Open-Meteo counts as a call. Refetching it hourly meant two out of
// every three requests bought a byte-identical forecast. Open-Meteo also serves
// a static metadata file per model that says when the last run was initialised
// and when it became available. It is under a kilobyte, CDN-cached with an
// ETag, and CORS-open, so the browser can read it directly. The rule is:
// look at the metadata, and fetch the grid only when it names a run the map
// does not already hold.
//
// The metadata also says when to look next. A run that became available at
// 14:45 with a three-hour interval will have a successor at about 17:45, so
// the next check is scheduled there rather than on a fixed clock. If the run is
// late the check is retried at a short interval; if the metadata cannot be
// read at all the grid falls back to a plain three-hour cadence.

import { isQuietHours, quietHoursEnd, GRID_MODEL, type MapBounds, type PrecipitationGrid } from './precipitation-grid';

export const MODEL_META_URL = 'https://api.open-meteo.com/data/' + GRID_MODEL + '/static/meta.json';

export type ModelRun = {
  // All in milliseconds since the epoch, like every other timestamp here.
  initialised: number;
  available: number;
  interval: number;
};

// Runs are three hours apart; used when the metadata does not say.
const DEFAULT_INTERVAL_MS = 3 * 60 * 60_000;
// Publication jitters by a couple of minutes, so the check aims a little past
// the expected moment rather than exactly at it.
export const CHECK_MARGIN_MS = 2 * 60_000;
// When the expected run has not appeared, look again soon. A late run is the
// common case for a few minutes and the rare case for longer.
export const CHECK_RETRY_MS = 5 * 60_000;
// Never check more often than this, whatever the arithmetic says.
export const CHECK_MIN_MS = 5 * 60_000;
// Without readable metadata there is nothing to aim at, so both the check and
// the grid itself fall back to this.
export const CHECK_FALLBACK_MS = 60 * 60_000;
export const GRID_FALLBACK_MS = 3 * 60 * 60_000;

type Meta = {
  last_run_initialisation_time?: unknown;
  last_run_availability_time?: unknown;
  update_interval_seconds?: unknown;
};

function seconds(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value * 1000 : null;
}

export function parseModelRun(payload: unknown): ModelRun | null {
  const meta = payload as Meta | null;
  if (!meta || typeof meta !== 'object') return null;
  const initialised = seconds(meta.last_run_initialisation_time);
  const available = seconds(meta.last_run_availability_time);
  if (initialised === null || available === null) return null;
  return { initialised, available, interval: seconds(meta.update_interval_seconds) ?? DEFAULT_INTERVAL_MS };
}

export type RefreshInput = {
  now: number;
  grid: Pick<PrecipitationGrid, 'run' | 'fetchedAt' | 'bounds'> | null;
  run: ModelRun | null;
  view: MapBounds | null;
  covers: (grid: MapBounds, view: MapBounds) => boolean;
};

// Whether a grid request is worth making right now. Every branch is a reason a
// request would show something different from what is on screen; there is no
// branch for "it has been a while".
export function shouldFetchGrid({ now, grid, run, view, covers }: RefreshInput) {
  if (!grid) return true;
  if (view && !covers(grid.bounds, view)) return true;
  if (run) return grid.run !== run.initialised;
  return now - grid.fetchedAt >= GRID_FALLBACK_MS;
}

// When to read the metadata again. Aimed at the next expected publication, or
// a short retry if that moment has passed, or hourly when there is no
// metadata to aim with. A check that would land in the quiet hours moves to
// their end: nothing is requested while nobody is watching.
export function nextCheckAt(now: number, run: ModelRun | null) {
  let at: number;
  if (!run) {
    at = now + CHECK_FALLBACK_MS;
  } else {
    const expected = run.available + run.interval + CHECK_MARGIN_MS;
    if (expected > now) at = expected;
    // A run more than a whole interval overdue is not late, it is stuck, and
    // retrying every few minutes for hours would spend requests on nothing.
    else if (now - expected > run.interval) at = now + CHECK_FALLBACK_MS;
    else at = now + CHECK_RETRY_MS;
  }
  at = Math.max(at, now + CHECK_MIN_MS);
  return isQuietHours(at) ? quietHoursEnd(at) : at;
}
