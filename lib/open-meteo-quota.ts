// Open-Meteo's limits, how a request is weighed against them, and what a
// refusal means for the rest of the day.
//
// The free tier allows 10,000 weighted calls a day, 5,000 an hour and 600 a
// minute, counted per client IP address (open-meteo.com/en/pricing). The
// weight of one request is, in Open-Meteo's own words,
//
//   weight = nLocations * (nDays / 14) * (nVariables / 10)
//
// where a request under two weeks and ten variables counts as one call: two
// weeks with fifteen variables is 1.5 calls, four weeks 3.0 (openmeteo.substack
// .com/p/weather-data-for-multiple-locations). So every point forecast this
// display makes (one location, three or eight days, six or seven variables)
// weighs one call, and the forecast-map grid weighs one call per coordinate.
// Coordinates are what cost; the number of timesteps does not.
//
// The quota is per address, and the Fire TV shares its address with every
// machine on the same connection. The display's own spend is bounded here so
// it can be reasoned about: EXPECTED_DAY says what one day of the display
// costs, and the map's lattice in lib/precipitation-grid.ts is sized against
// it. Anything development does on the same connection comes on top, which is
// why `?weather=off` exists (lib/debug-flags.ts).
//
// A 429 carries a JSON body naming the limit that was hit. A daily refusal
// means every further request until midnight UTC is wasted, so it is kept as a
// lockout that the whole display honours until then. Hourly and minutely
// refusals lock out until the next hour or minute. The card, the week and the
// map all pay from the same quota, so the lockout is shared between them
// through device storage (components/open-meteo-lockout.ts) rather than held
// by whichever component happened to hit it.

export const OPEN_METEO_LIMITS = { day: 10_000, hour: 5_000, minute: 600 } as const;

export type RequestShape = { locations: number; days: number; variables: number };

// One request's weight against the limits above. Each factor is floored at
// one: Open-Meteo's examples only ever show weights above one call, and a
// request must never be counted as cheaper than a call.
export function callWeight({ locations, days, variables }: RequestShape) {
  return Math.max(0, locations) * Math.max(1, days / 14) * Math.max(1, variables / 10);
}

// What one day of the display costs at a given grid size. Six grid fetches:
// Harmonie runs every three hours and the map does not ask between 23:00 and
// 06:00 (lib/precipitation-grid.ts). The hours only reach Open-Meteo while
// DMI is refusing, and the week only while Open-Meteo is ahead of MET Norway,
// so both are counted at their worst.
export const EXPECTED_DAY = { gridFetches: 6, hourlyRefreshes: 96, dailyRefreshes: 24 } as const;

export function expectedDailySpend(gridPoints: number) {
  const grid = callWeight({ locations: gridPoints, days: 0.5, variables: 1 }) * EXPECTED_DAY.gridFetches;
  const hours = callWeight({ locations: 1, days: 3, variables: 6 }) * EXPECTED_DAY.hourlyRefreshes;
  const week = callWeight({ locations: 1, days: 8, variables: 7 }) * EXPECTED_DAY.dailyRefreshes;
  return { grid, hours, week, total: grid + hours + week };
}

export type Lockout = { until: number; reason: string };

// A refusal whose body names no limit still means "not now"; a quarter of an
// hour is long enough to stop a retry loop and short enough to notice the
// limit clearing.
export const UNKNOWN_REFUSAL_MS = 15 * 60_000;

function nextBoundary(now: number, period: number) {
  return (Math.floor(now / period) + 1) * period;
}

// The daily quota is counted per UTC day; the refusal says "try again
// tomorrow", and midnight UTC is when the counter has been seen to reset.
export function nextUtcMidnight(now: number) {
  return nextBoundary(now, 86_400_000);
}

export function refusalLockout(status: number, body: string, now: number): Lockout | null {
  if (status !== 429) return null;
  const text = body.toLowerCase();
  if (text.includes('daily')) return { until: nextUtcMidnight(now), reason: 'daily limit' };
  if (text.includes('hourly')) return { until: nextBoundary(now, 3_600_000), reason: 'hourly limit' };
  if (text.includes('minutely') || text.includes('minute')) return { until: nextBoundary(now, 60_000), reason: 'minutely limit' };
  return { until: now + UNKNOWN_REFUSAL_MS, reason: 'rate limited' };
}

// The boundary for a lockout read back from device storage.
export function validLockout(value: unknown): value is Lockout {
  const lockout = value as Lockout | null;
  return !!lockout && typeof lockout === 'object' && Number.isFinite(lockout.until) && typeof lockout.reason === 'string';
}

// The lockout if it still binds, otherwise null. A lockout far in the future
// is a clock that was wrong when it was written, not a quota, and is dropped
// rather than trusted: nothing Open-Meteo says lasts longer than a day.
export function activeLockout(lockout: Lockout | null, now: number): Lockout | null {
  if (!lockout || lockout.until <= now || lockout.until - now > 86_400_000) return null;
  return lockout;
}

const untilFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Copenhagen', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

// The reason the card logs when it skips Open-Meteo: what was hit and when
// asking again becomes worthwhile, in the time zone the display shows.
export function describeLockout(lockout: Lockout) {
  return 'Open-Meteo ' + lockout.reason + ', not asked again before ' + untilFormat.format(new Date(lockout.until));
}
