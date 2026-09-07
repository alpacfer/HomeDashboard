// Debug flags read from the page URL, beside the `?scene=` pin in
// lib/panel-rotation.ts. Everything here is for checking a change, and every
// flag defaults to normal behaviour, so a mistyped URL can never leave the
// wall display in a debug state.
//
//   ?weather=off   No weather, week or forecast-map request is made. The card,
//                  the ribbon and the week strip are filled from
//                  lib/weather-demo.ts instead, so a capture of something else
//                  still shows the dashboard in context. Nothing spends
//                  provider quota: Open-Meteo counts one forecast-map load as
//                  about three hundred calls against a daily quota of ten
//                  thousand that the display shares with every machine on the
//                  same connection (lib/open-meteo-quota.ts). Use it for any
//                  screenshot that is not about the weather.
//   ?weather=demo  As `off`, and the forecast map draws the synthetic run in
//                  lib/precipitation-demo.ts as well. It is the only way to
//                  photograph the map's animation without buying a grid, and
//                  it is deterministic, so two captures of the same change are
//                  comparable.
//   ?weather=dry   As `demo`, but the synthetic run holds no precipitation at
//                  all. That is the state the rotation skips the forecast map
//                  for (lib/panel-rotation.ts), and a live forecast will not
//                  produce it to order any more than it will produce rain, so
//                  it is the only way to look at the skipped scene and at the
//                  shortened cycle around it.
//   ?weather=none  No request and no placeholder: the card shows its genuinely
//                  unavailable state. That is a state the display has to get
//                  right when every provider is down, so it stays reachable.
//   ?transit=demo  The departure boards are drawn from a synthetic answer that
//                  contains a cancellation, a long delay, an early departure, a
//                  platform change and two service messages. No provider is
//                  asked. Delays and cancellations are what the panel exists to
//                  mark and what a live feed almost never shows on demand, so
//                  this is the only way to check the marking on purpose. The
//                  data is built in the route handler and never ships to the
//                  browser (lib/transit-demo.ts).
//   ?transit=stale     The same synthetic board, dated four minutes ago, which
//                  is past the three-minute mark the freshness stamp turns
//                  amber at.
//   ?transit=expired   Dated seven minutes ago: past the five-minute mark, so
//                  the stamp is red and the boards blank themselves.
//   ?transit=down  The route answers 503 and the browser takes its real
//                  failure path, so the stamp reads "no data". Together these
//                  three are the only way to photograph a board that is not
//                  fresh: waiting for the network to fail on cue is not a
//                  method, and the age of what is on screen is the one thing
//                  the panel says about itself at every moment.
//   ?time=HH:MM    The page's clock reads this Copenhagen time instead of the
//                  real one; seconds still tick, so the minute still rolls.
//                  Which digits the clock shows otherwise depends on when the
//                  screenshot is taken, and a face that clips on a 4 looks
//                  fine at 21:21. Everything that reads the clock follows:
//                  the Tenant's mood and the ribbon's window.
//   ?date=MM-DD    The daily-fact panel shows that calendar date instead of
//                  today's, and stops rolling over at midnight. It is the only
//                  way to look at a fact that is not today's, which matters
//                  because the reviewed ones in data/daily-fact-overrides.json
//                  land on fourteen dates spread across the year. Read in
//                  lib/daily-facts.ts, not here, because that is where the date
//                  key is derived.
//   ?source=<id>   Credits this provider under the ribbon while the weather is
//                  a placeholder, so each source mark can be photographed
//                  without asking anyone for a forecast. One of google, dmi,
//                  open-meteo, met. Ignored when the weather is live: the mark
//                  there names whoever actually answered, and inventing that is
//                  the one thing a credit must never do.
//   ?pet=<spot>    Holds the Tenant at weather, week, transport, fact or map.
//   ?pet=travel-<spot>  Sends it there through the measured safe-spot route,
//                  then holds it. This makes locomotion reproducible too.
//   ?pet-motion=<move>  Plays the Tenant's real gravity and spring motion
//                  after a short setup: hop jumps at home, balance and peek
//                  use a measured round digit. Reload to replay. Takes
//                  precedence over the two flags above, because it is the
//                  motion being looked at rather than the destination. Pass
//                  the whole URL with --url to the screenshot and motion
//                  tools, which is how the frame rate is measured.

import type { WorldSpotId } from './clock-tenant';
import type { SourceName } from './forecast-sources';

export type PinnedTime = { hour: number; minute: number };
export type Weather = 'live' | 'off' | 'demo' | 'dry' | 'none';
export type Transit = 'live' | 'demo' | 'stale' | 'expired' | 'down';
export type PetMotionPreview = 'hop' | 'balance' | 'peek';
export type DebugFlags = {
  weather: Weather;
  transit: Transit;
  time: PinnedTime | null;
  source: SourceName | null;
  pet: WorldSpotId | null;
  petTravel: WorldSpotId | null;
  petMotion: PetMotionPreview | null;
};

export function debugFlags(search: string): DebugFlags {
  const params = new URLSearchParams(search);
  const weather = params.get('weather');
  const pet = params.get('pet');
  const motion = params.get('pet-motion');
  return {
    weather: weather === 'off' || weather === 'demo' || weather === 'dry' || weather === 'none' ? weather : 'live',
    transit: parseTransit(params.get('transit')),
    time: parseTime(params.get('time')),
    source: parseSource(params.get('source')),
    pet: parsePet(pet),
    petTravel: pet?.startsWith('travel-') ? parsePet(pet.slice('travel-'.length)) : null,
    petMotion: motion === 'hop' || motion === 'balance' || motion === 'peek' ? motion : null,
  };
}

const TRANSIT_STATES: readonly string[] = ['demo', 'stale', 'expired', 'down'];

function parseTransit(value: string | null): Transit {
  return TRANSIT_STATES.includes(value ?? '') ? value as Transit : 'live';
}

// URL ids rather than the provider names themselves, so the flag does not
// carry a space and a capital letter into a query string.
// A Map rather than an object literal: a plain lookup answers `?source=
// constructor` with something from Object.prototype, and this table decides
// what the display credits.
const SOURCE_IDS = new Map<string, SourceName>([
  ['google', 'Google'], ['dmi', 'DMI'], ['open-meteo', 'Open-Meteo'], ['met', 'MET Norway'],
]);

function parseSource(value: string | null): SourceName | null {
  return SOURCE_IDS.get(value ?? '') ?? null;
}

function parsePet(value: string | null): WorldSpotId | null {
  return value === 'weather' || value === 'week' || value === 'transport' || value === 'fact' || value === 'map' ? value : null;
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
