// Transitous (https://transitous.org), the keyless fallback for departures.
//
// Rejseplanen's own API 2.0 stays the primary source, but it needs an access
// ID that has to be applied for. Every *official* Danish alternative turns out
// to be unreachable from this deployment:
//
//   Rejseplanen API 2.0   realtime, but needs the Labs access ID.
//   GTFS Schedule/Static  no realtime at all, and needs a Labs request.
//   NeTEx                 no realtime, and needs a NemLog-in.
//   SIRI-ET               realtime and CC BY, published per operator through
//                         Vejdirektoratet's Dataudveksleren, but delivered as
//                         an AMQP event subscription of operator-wide XML that
//                         a client must match against a full GTFS timetable it
//                         holds in memory. A Render free instance sleeps and
//                         has 512 MB; it cannot hold either.
//
// Transitous is a community-run MOTIS instance, and the data it serves for
// Denmark is the official one: Rejseplanen's GTFS plus the same Rejsekort &
// Rejseplan A/S SIRI realtime feed, converted from that event queue. So the
// departures, delays and cancellations below originate first-party even though
// the endpoint does not. See docs/TRANSPORT.md.
//
// Their usage policy asks for open-source, non-commercial use, an identifying
// User-Agent, and contact before heavy use. This file is the only place that
// talks to them, so all three live here.

import { ALERTS_PER_DEPARTURE, alertText, normalize, type AlertSeverity, type Departure, type DepartureAlert } from '@/lib/transit';

export const TRANSITOUS_ENDPOINT = 'https://api.transitous.org/api/v1/stoptimes';
export const TRANSITOUS_USER_AGENT = 'HomeDashboard/0.1 (wall display; https://github.com/topics/home-dashboard)';

// Enough events to fill three departures in every direction at the busiest
// stop, and no more: one response is about 80 kB and the display asks for two
// of them every two minutes.
export const TRANSITOUS_EVENTS = 50;

// Live times are asked for, never inherited. MOTIS defaults `realtimeMode` to
// REALTIME, so naming it changes nothing today; it is named because the live
// time of the *next* departure is the most valuable thing on the board, and a
// provider default is the wrong place to keep it. `realtimeMode=OFF` returns
// the same events with every live flag cleared, which here would quietly cost
// the display every green dot and every delay while still looking like a
// working board -- the one failure nobody standing at the stop would catch.
export const TRANSITOUS_REALTIME_MODE = 'REALTIME';

// Pure: the `stoptimes` query for one stop. Both callers build it here, because
// `npm run probe:transit` claims to ask "exactly as the route would" and that
// only stays true while there is one definition of the request.
export function stopTimesQuery(stopId: string): Record<string, string> {
  return { stopId, n: String(TRANSITOUS_EVENTS), arriveBy: 'false', realtimeMode: TRANSITOUS_REALTIME_MODE };
}

// Rejseplanen's own stop numbers, in the namespace Transitous gives the Danish
// feed. Hardcoded rather than looked up, because a geocode call before every
// board would double the requests for an answer that does not change. Verify
// with `npm run probe:transit`, which prints what the geocoder returns today.
export const TRANSITOUS_STOPS: Record<string, string> = {
  'Kildegårds Plads (Lyngbyvej)': 'dk-rejseplanen_000000006044',
  'Lyngby St.': 'dk-rejseplanen_000008600675',
};

// GTFS trip headsigns, which are NOT the strings Rejseplanen's API returns in
// DestinationStop: 184 north is signed for Vedbæk, not Holte or Lyngby, and
// 150S north runs to four different termini up the same corridor. That is why
// this list exists separately from the `termini` in lib/transit.ts rather than
// reusing it — matching Rejseplanen's names here would empty every board.
// Unknown headsigns are dropped, so a new short-turn is missing rather than
// filed under the wrong direction. Re-derive with `npm run probe:transit`.
export const TRANSITOUS_HEADSIGNS: Record<string, string[]> = {
  '184:north': ['Vedbæk St.'],
  '184:south': ['Nørreport St.'],
  '150S:north': ['Kokkedal St.', 'Gl. Holte Øverødvej', 'Søhuset, Forskerparken', 'Rævehøjvej, DTU'],
  '150S:south': ['Nørreport St.'],
  'A:north': ['Hillerød St.'],
};

type RawPlace = {
  name?: string; track?: string; scheduledTrack?: string;
  departure?: string; scheduledDeparture?: string;
  cancelled?: boolean; alerts?: RawAlert[];
};
type RawAlert = { headerText?: string; descriptionText?: string; severityLevel?: string; effect?: string };
export type RawStopTime = {
  place?: RawPlace; headsign?: string; routeShortName?: string;
  realTime?: boolean; cancelled?: boolean; tripCancelled?: boolean; tripId?: string;
};

const SEVERITY: Record<string, AlertSeverity> = { SEVERE: 'severe', WARNING: 'warning', INFO: 'info', UNKNOWN_SEVERITY: 'info' };
// Effects that matter to somebody standing at the stop even when the feed
// grades the message itself as merely informational.
const SEVERE_EFFECTS = new Set(['NO_SERVICE', 'SIGNIFICANT_DELAYS']);
const WARNING_EFFECTS = new Set(['REDUCED_SERVICE', 'DETOUR', 'MODIFIED_SERVICE', 'STOP_MOVED']);

function transitousAlerts(raw: RawAlert[] | undefined): DepartureAlert[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap(alert => {
    const text = alertText(alert?.headerText || alert?.descriptionText);
    if (!text) return [];
    const graded = SEVERITY[String(alert?.severityLevel)] ?? 'info';
    const effect = String(alert?.effect);
    const severity: AlertSeverity = SEVERE_EFFECTS.has(effect) ? 'severe'
      : graded === 'severe' ? 'severe'
      : WARNING_EFFECTS.has(effect) || graded === 'warning' ? 'warning' : 'info';
    return [{ severity, text }];
  }).slice(0, ALERTS_PER_DEPARTURE);
}

const timestamp = (value: unknown) => typeof value === 'string' ? Date.parse(value) : NaN;
const matchesHeadsign = (headsign: string, allowed: string[]) => allowed.some(name =>
  headsign === normalize(name) || headsign.startsWith(normalize(name) + ' ('));

/**
 * One board's worth of departures from a MOTIS `stoptimes` response.
 *
 * Validation happens here, at the boundary, before anything reaches React
 * state: the stop the response describes must be the stop that was asked for,
 * or the whole board is refused rather than quietly attributed to the wrong
 * platform. Individual entries that are malformed are skipped.
 */
export function parseStopTimes(payload: unknown, stopName: string, lineId: string, direction: string, now: number): Departure[] {
  const body = payload as { stopTimes?: unknown; place?: RawPlace } | null;
  if (!body || !Array.isArray(body.stopTimes)) throw new Error('Transit fallback returned no departure list');
  const answered = body.place?.name;
  if (typeof answered !== 'string' || normalize(answered) !== normalize(stopName)) {
    throw new Error('Transit fallback answered for a different stop');
  }
  const allowed = TRANSITOUS_HEADSIGNS[lineId + ':' + direction];
  if (!allowed) return [];

  const result = new Map<string, Departure>();
  for (const entry of body.stopTimes as RawStopTime[]) {
    if (String(entry?.routeShortName).toUpperCase() !== lineId.toUpperCase()) continue;
    if (typeof entry.headsign !== 'string' || !matchesHeadsign(normalize(entry.headsign), allowed)) continue;
    const place = entry.place;
    const scheduled = timestamp(place?.scheduledDeparture);
    const expected = timestamp(place?.departure ?? place?.scheduledDeparture);
    if (!Number.isFinite(scheduled) || !Number.isFinite(expected) || expected < now) continue;
    const cancelled = entry.cancelled === true || entry.tripCancelled === true || place?.cancelled === true;
    const id = (typeof entry.tripId === 'string' && entry.tripId ? entry.tripId : lineId + '-' + direction) + '-' + scheduled;
    result.set(id, {
      id,
      scheduled,
      expected,
      cancelled,
      realtime: entry.realTime === true,
      delay: Math.round((expected - scheduled) / 60000),
      track: typeof place?.track === 'string' ? place.track : null,
      scheduledTrack: typeof place?.scheduledTrack === 'string' ? place.scheduledTrack : null,
      alerts: transitousAlerts(place?.alerts),
    });
  }
  return [...result.values()].sort((a, b) => a.expected - b.expected).slice(0, 12);
}
