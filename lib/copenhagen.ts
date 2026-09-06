// The display's one time zone, and the three things everything asks of it.
//
// Twenty Intl.DateTimeFormat instances across fifteen files each spelled
// `timeZone: 'Europe/Copenhagen'` for themselves. eslint enforces that the
// spelling is there -- a formatter without it reads the device's zone, which
// is the classic way a date goes wrong at midnight -- but enforcing that a
// string is present is not the same as there being one answer to "what hour is
// it on the wall". The same "format, then slice(0,2), then Number" appeared
// four times, written four ways, and precipitation-grid.ts declared the same
// formatter twice twenty-five lines apart.
//
// Only the genuinely shared shapes live here. Formatters that produce
// something specific to one module -- the long "Sunday 6 September" on the
// clock, the parts transit needs to rebuild a wall time -- stay where they are
// used. Two similar formatters are not necessarily one idea, and
// forecast-summary's grouping key is deliberately not this module's day key:
// that one is en-GB and only has to be stable, this one is the en-CA
// YYYY-MM-DD that file names and provider payloads are keyed by.

export const COPENHAGEN = 'Europe/Copenhagen';

const hourFormat = new Intl.DateTimeFormat('en-GB', { timeZone: COPENHAGEN, hour: '2-digit', hourCycle: 'h23' });
const dayKeyFormat = new Intl.DateTimeFormat('en-CA', { timeZone: COPENHAGEN, year: 'numeric', month: '2-digit', day: '2-digit' });
const clockFormat = new Intl.DateTimeFormat('en-GB', { timeZone: COPENHAGEN, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** The hour on the wall, 0 to 23. */
export function copenhagenHour(at: Date | number): number {
  return Number(hourFormat.format(at).slice(0, 2));
}

/** `YYYY-MM-DD` on the wall. The key daily facts and daily forecasts use. */
export function copenhagenDayKey(at: Date | number): string {
  return dayKeyFormat.format(at);
}

/**
 * `HH:mm` on the wall, 24-hour.
 *
 * hourCycle 'h23' rather than hour12: false, which is what two of the callers
 * had. They agree in practice, but h23 says which of the two 24-hour cycles is
 * meant, and midnight is 00:00 rather than possibly 24:00.
 */
export function copenhagenClock(at: Date | number): string {
  return clockFormat.format(at);
}
