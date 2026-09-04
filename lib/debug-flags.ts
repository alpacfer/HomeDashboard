// Debug flags read from the page URL, beside the `?scene=` pin in
// lib/panel-rotation.ts. Everything here is for checking a change, and every
// flag defaults to normal behaviour, so a mistyped URL can never leave the
// wall display in a debug state.
//
//   ?weather=off   No weather, week or forecast-map request is made. The card
//                  shows its unavailable state and nothing spends provider
//                  quota. Use it for any screenshot that is not about the
//                  weather: Open-Meteo counts one forecast-map load as about
//                  three hundred calls against a daily quota of ten thousand
//                  that the display shares with every machine on the same
//                  connection (lib/open-meteo-quota.ts).
//   ?weather=demo  As `off` for every request, but the forecast map draws the
//                  synthetic run in lib/precipitation-demo.ts instead of
//                  nothing. It is the only way to photograph the map's
//                  animation without buying a grid, and it is deterministic,
//                  so two captures of the same change are comparable.
//   ?time=HH:MM    The page's clock reads this Copenhagen time instead of the
//                  real one; seconds still tick, so the minute still rolls.
//                  Which digits an outfit shows otherwise depends on when the
//                  screenshot is taken, and a face that clips on a 4 looks
//                  fine at 21:21. Everything that reads the clock follows:
//                  the wardrobe, the Tenant's mood and the ribbon's window.

export type PinnedTime = { hour: number; minute: number };
export type Weather = 'live' | 'off' | 'demo';
export type DebugFlags = { weather: Weather; time: PinnedTime | null };

export function debugFlags(search: string): DebugFlags {
  const params = new URLSearchParams(search);
  const weather = params.get('weather');
  return { weather: weather === 'off' || weather === 'demo' ? weather : 'live', time: parseTime(params.get('time')) };
}

function parseTime(value: string | null): PinnedTime | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value ?? '');
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour < 24 && minute < 60 ? { hour, minute } : null;
}

const wall = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Copenhagen', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });

// `now` shifted by whole hours and minutes so that its Copenhagen wall clock
// reads the pinned time. Shifting rather than constructing keeps the seconds,
// so the clock ticks and rolls as it does live.
export function pinnedNow(time: PinnedTime | null, now: Date): Date {
  if (!time) return now;
  const parts = Object.fromEntries(wall.formatToParts(now).map(part => [part.type, part.value]));
  const shift = (time.hour - Number(parts.hour)) * 3_600_000 + (time.minute - Number(parts.minute)) * 60_000;
  return new Date(now.getTime() + shift);
}
