export const LINES = [
  { id: '184', origin: 'Kildegårds Plads', stopName: 'Kildegårds Plads (Lyngbyvej)', style: 'local-bus', directions: [
    { key: 'north', destination: 'Lyngby', termini: ['Holte St.', 'Lyngby St.'] },
    { key: 'south', destination: 'Nørreport', termini: ['Nørreport St.'] },
  ] },
  { id: '150S', origin: 'Kildegårds Plads', stopName: 'Kildegårds Plads (Lyngbyvej)', style: 's-bus', directions: [
    { key: 'north', destination: 'Kokkedal', termini: ['Kokkedal St.'] },
    { key: 'south', destination: 'Nørreport', termini: ['Nørreport St.'] },
  ] },
  // Not the Lyngbyvej mast the other two buses use: 164 calls at the other
  // side of the square, and only the Ballerup-bound one passes Vangede --
  // eastbound it has already been there. So the origin names the mast, because
  // a board that sends somebody to the wrong kerb is worse than no board.
  { id: '164', origin: 'Kildegårds Plads (Ellegårdsvej)', stopName: 'Kildegårds Plads (Ellegårdsvej)', style: 'local-bus', directions: [
    { key: 'west', destination: 'Vangede', termini: ['Ballerup St.'] },
  ] },
  { id: 'A', origin: 'Lyngby St.', stopName: 'Lyngby St.', style: 's-train', directions: [
    { key: 'north', destination: 'Hillerød', termini: ['Hillerød St.'] },
  ] },
];

// A service message carried with a departure. Rejseplanen's API 2.0 and the
// Transitous fallback both expose these; the fields are the GTFS-Realtime
// Alert ones, kept to the three the display can actually show. Text is capped
// at ALERT_TEXT_LIMIT before it reaches React state so a provider cannot grow
// the payload the Fire TV has to parse.
export type AlertSeverity = 'severe' | 'warning' | 'info';
export type DepartureAlert = { severity: AlertSeverity; text: string };
export const ALERT_TEXT_LIMIT = 90;
export const ALERTS_PER_DEPARTURE = 2;

// How many departures a board carries. Three are shown and the rest let the
// headway and the compact strip read ahead; both providers cut here, and the
// tests restated the number until it had a name.
export const BOARD_DEPTH = 12;

// The key a board is filed under, `150S:north`. It was spelt out by hand in
// twelve places across both providers, the route, the panel and the probe.
export function boardKey(lineId: string, direction: string) {
  return lineId + ':' + direction;
}

export type Departure = { id: string; scheduled: number; expected: number; cancelled: boolean; realtime: boolean; delay: number; track: string | null; scheduledTrack: string | null; alerts: DepartureAlert[] };
export type TransitSource = 'rejseplanen' | 'transitous';
export type TransitData = { status: 'ready' | 'needs_key' | 'unavailable'; generatedAt: number; boards: Record<string, Departure[]>; source?: TransitSource };

const STATUSES: readonly string[] = ['ready', 'needs_key', 'unavailable'];
const SEVERITIES: readonly string[] = ['severe', 'warning', 'info'];
const SOURCES: readonly string[] = ['rejseplanen', 'transitous'];

function validAlert(value: unknown): value is DepartureAlert {
  const alert = value as DepartureAlert | null;
  return !!alert && typeof alert === 'object'
    && SEVERITIES.includes(alert.severity) && typeof alert.text === 'string';
}

function validDeparture(value: unknown): value is Departure {
  const departure = value as Departure | null;
  if (!departure || typeof departure !== 'object') return false;
  if (typeof departure.id !== 'string') return false;
  // Finite, not merely numeric: the panel subtracts these from Date.now() to
  // decide "in 4 min", and NaN compares false against every threshold, so a
  // bad timestamp reads as neither late nor early nor stale.
  if (!Number.isFinite(departure.scheduled) || !Number.isFinite(departure.expected)) return false;
  if (!Number.isFinite(departure.delay)) return false;
  if (typeof departure.cancelled !== 'boolean' || typeof departure.realtime !== 'boolean') return false;
  if (departure.track !== null && typeof departure.track !== 'string') return false;
  if (departure.scheduledTrack !== null && typeof departure.scheduledTrack !== 'string') return false;
  return Array.isArray(departure.alerts) && departure.alerts.every(validAlert);
}

/**
 * The `/api/departures` body, checked before it reaches React state.
 *
 * Same origin is not the same as trusted: the route answers 503 with its own
 * shape, a proxy or a cold Render instance can answer with something else
 * entirely, and the panel does arithmetic on `generatedAt` the moment it
 * arrives. A body that is merely well-formed-looking is the dangerous one --
 * a string `generatedAt` makes `now - generatedAt` NaN, which is not greater
 * than the stale threshold or the expired one, so the board would sit there
 * showing yesterday's departures with nothing marking them.
 */
export function validTransitData(value: unknown): value is TransitData {
  const data = value as TransitData | null;
  if (!data || typeof data !== 'object') return false;
  if (!STATUSES.includes(data.status)) return false;
  if (!Number.isFinite(data.generatedAt)) return false;
  if (data.source !== undefined && !SOURCES.includes(data.source)) return false;
  if (!data.boards || typeof data.boards !== 'object' || Array.isArray(data.boards)) return false;
  return Object.values(data.boards).every(board => Array.isArray(board) && board.every(validDeparture));
}

// What is wrong with a departure, most severe first, as short strings the
// display can print without further formatting. The wall is read at a glance
// from across a room, so the label carries the whole message: there is no
// second line to expand into and no pointer to reveal one.
export type IncidentKind = 'cancelled' | 'alert' | 'delayed' | 'track' | 'early';
export type Incident = { kind: IncidentKind; severity: AlertSeverity; label: string };
const RANK: Record<AlertSeverity, number> = { severe: 0, warning: 1, info: 2 };

// Pure: everything the display marks about one departure. A cancellation
// outranks its own delay, a changed platform is worth a warning of its own,
// and running early is reported too, because a bus that leaves two minutes
// before the timetable is as easy to miss as one that runs late.
export function departureIncidents(departure: Departure): Incident[] {
  const incidents: Incident[] = [];
  if (departure.cancelled) incidents.push({ kind: 'cancelled', severity: 'severe', label: 'Cancelled' });
  for (const alert of departure.alerts.slice(0, ALERTS_PER_DEPARTURE)) {
    incidents.push({ kind: 'alert', severity: alert.severity, label: alert.text });
  }
  if (!departure.cancelled && departure.delay >= 1) incidents.push({ kind: 'delayed', severity: departure.delay >= 10 ? 'severe' : 'warning', label: '+' + departure.delay + ' min' });
  // Signed like the delay it mirrors: "-1 min" beside "+12 min" reads as one
  // scale, where "1 min early" made the reader translate between two.
  if (!departure.cancelled && departure.delay <= -1) incidents.push({ kind: 'early', severity: 'info', label: departure.delay + ' min' });
  if (departure.track && departure.scheduledTrack && departure.track !== departure.scheduledTrack) {
    incidents.push({ kind: 'track', severity: 'warning', label: 'Track ' + departure.track + ' (was ' + departure.scheduledTrack + ')' });
  }
  return incidents.sort((a, b) => RANK[a.severity] - RANK[b.severity]);
}

// Pure: the worst thing happening across every board, for the one line the
// panel has room to show above the boards. Labels repeat across departures of
// the same disrupted line, so they are counted once.
export function boardIncidents(data: TransitData | null, now: number): Incident[] {
  if (data?.status !== 'ready') return [];
  const seen = new Map<string, Incident>();
  for (const board of Object.values(data.boards)) {
    for (const departure of board) {
      if (departure.expected < now) continue;
      for (const incident of departureIncidents(departure)) {
        if (incident.kind === 'cancelled' || incident.kind === 'alert') seen.set(incident.kind + ':' + incident.label, incident);
      }
    }
  }
  return [...seen.values()].sort((a, b) => RANK[a.severity] - RANK[b.severity]).slice(0, 2);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// How many upcoming departures a headway is read from. Enough to average out a
// single irregular gap, few enough to still describe now rather than tonight:
// six departures of a twenty-minute line is two hours, and the frequency has
// usually changed by then.
const HEADWAY_SAMPLE = 6;
const HEADWAY_MAX_MIN = 60;

// Pure: roughly how often one line runs in one direction, from the gaps
// between the departures still to come, or null when there are too few to say.
//
// Per direction, and never per stop: a stop is served by several lines and a
// line by two directions, so anything wider answers a question nobody asked.
// 184 runs every twenty minutes each way; counting both directions at
// Kildegårds Plads would have called it ten. Read from `scheduled` rather than
// `expected`, because "every twenty minutes" is a property of the timetable and
// one late bus should not restate it, and taken as a median, because the last
// gap on a 24-hour board runs to the end of service. Deliberately rounded: it
// is a description, not a promise.
export function serviceHeadway(data: TransitData | null, lineId: string, direction: string, now: number): number | null {
  if (data?.status !== 'ready') return null;
  const times = (data.boards[boardKey(lineId, direction)] || [])
    .filter(departure => departure.expected >= now && !departure.cancelled)
    .map(departure => departure.scheduled)
    .sort((a, b) => a - b)
    .slice(0, HEADWAY_SAMPLE);
  const gaps = times.slice(1).map((time, index) => (time - times[index]) / 60000).filter(gap => gap > 0);
  if (gaps.length < 2) return null;
  const typical = median(gaps);
  if (typical > HEADWAY_MAX_MIN) return null;
  return typical >= 10 ? Math.round(typical / 5) * 5 : Math.max(1, Math.round(typical));
}

// Pure: provider text and alert text are external input, so they are trimmed,
// collapsed and capped before they can reach React state or a JSON payload.
export function alertText(value: unknown): string {
  if (typeof value !== 'string') return '';
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > ALERT_TEXT_LIMIT ? text.slice(0, ALERT_TEXT_LIMIT - 1).trimEnd() + '\u2026' : text;
}

// How old the board is allowed to get, in the two thresholds everything reads
// it against. The panel asks again every two minutes, so three is one missed
// round trip -- worth marking -- and five is two, at which point the times are
// old enough to send somebody to a stop for a bus that has already gone, and
// the boards blank themselves rather than show them.
export const BOARD_STALE_MS = 180_000;
export const BOARD_EXPIRED_MS = 300_000;

export type Freshness = { label: string; spoken: string; severity: '' | 'warning' | 'severe' };

/**
 * Pure: how old the board on screen is, in the few characters the display
 * keeps permanently in its corner.
 *
 * Permanent is the point. This used to be a line that appeared only once
 * something was wrong, and appearing cost the panel a row of its height, so
 * every departure on screen moved the moment the network hiccupped -- on a
 * wall nobody is standing in front of to re-read. The stamp is always
 * rendered and always the same box now; what changes is the number in it and
 * its colour. `spoken` is the long form, which costs no pixels.
 */
export function boardFreshness(data: TransitData | null, now: number, failed: boolean): Freshness {
  if (data?.status === 'needs_key') return { label: 'no key', spoken: 'Departures unavailable: no provider key', severity: 'severe' };
  // Before the first answer there is nothing to date. A failure with no
  // earlier answer behind it is the one state with no number to show at all.
  if (!data) return failed
    ? { label: 'no data', spoken: 'Departures unavailable', severity: 'severe' }
    : { label: '', spoken: '', severity: '' };
  // Clamped, because `generatedAt` is the server's clock and the subtraction
  // is the browser's: a Fire TV a few seconds behind Render would otherwise
  // floor to -1 and print "-1 min ago".
  const minutes = Math.floor(Math.max(0, now - data.generatedAt) / 60_000);
  const age = now - data.generatedAt;
  const label = minutes < 1 ? 'just now' : minutes + ' min ago';
  return {
    label,
    spoken: 'Departures updated ' + label,
    severity: age > BOARD_EXPIRED_MS ? 'severe' : age > BOARD_STALE_MS ? 'warning' : '',
  };
}

// Compact mode keeps the next usable departure for every existing direction.
// Never retain old times after the same five-minute expiry used by the full board.
export function nextCompactDeparture(data: TransitData | null, board: string, now: number): Departure | undefined {
  if (data?.status !== 'ready' || now - data.generatedAt > BOARD_EXPIRED_MS) return undefined;
  return (data.boards[board] || []).filter(item => item.expected >= now && !item.cancelled)
    .sort((a, b) => a.expected - b.expected)[0];
}
type RawProduct = { line?: string; name?: string };
export type RawDeparture = {
  name?: string; direction?: string; date?: string; time?: string; tz?: number;
  rtDate?: string; rtTime?: string; rtTz?: number; cancelled?: boolean | string;
  track?: string; rtTrack?: string; trackHidden?: boolean; rtTrackHidden?: boolean;
  ProductAtStop?: RawProduct; Product?: RawProduct[] | RawProduct;
  JourneyDetailRef?: { ref?: string }; DestinationStop?: { name?: string };
  Messages?: { Message?: RawMessage[] | RawMessage };
};
type RawMessage = { head?: string; text?: string; lead?: string; priority?: number };

// Rejseplanen grades a message only by `priority`, an open-ended number that
// rises with urgency. Anything from 50 up is what the app itself shows in red.
function rejseplanenAlerts(raw: RawDeparture['Messages']): DepartureAlert[] {
  const messages = raw?.Message === undefined ? [] : Array.isArray(raw.Message) ? raw.Message : [raw.Message];
  return messages.flatMap(message => {
    const text = alertText(message?.head || message?.lead || message?.text);
    if (!text) return [];
    const priority = typeof message?.priority === 'number' ? message.priority : 0;
    return [{ severity: priority >= 80 ? 'severe' : priority >= 50 ? 'warning' : 'info', text } as DepartureAlert];
  }).slice(0, ALERTS_PER_DEPARTURE);
}
export const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const localParts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
export function departureTimestamp(date?: string, time?: string, offset?: number) {
  if (!date || !time || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}(:\d{2})?$/.test(time)) return NaN;
  const wall = Date.parse(date + 'T' + time + 'Z');
  if (!Number.isFinite(wall)) return NaN;
  if (typeof offset === 'number' && Number.isFinite(offset)) return wall - offset * 60000;
  // Deterministic Copenhagen conversion when an API response omits tz.
  let result = wall;
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(localParts.formatToParts(new Date(result)).map(part => [part.type, part.value]));
    const localWall = Date.parse(p.year + '-' + p.month + '-' + p.day + 'T' + p.hour + ':' + p.minute + ':' + p.second + 'Z');
    result += wall - localWall;
  }
  return result;
}
// The departure list out of a Rejseplanen board answer: one object, a list of
// them, or nothing. Only objects are kept. The route used to cast the list
// and let filterDepartures dereference each entry, so a single null in an
// otherwise good answer threw, and the whole board fell back to the thinner
// provider for nothing.
export function rawDepartures(payload: unknown): RawDeparture[] {
  const field = (payload as { Departure?: unknown } | null)?.Departure;
  const list = field === undefined || field === null ? [] : Array.isArray(field) ? field : [field];
  return list.filter((entry): entry is RawDeparture => !!entry && typeof entry === 'object');
}

export function filterDepartures(raw: RawDeparture[], lineId: string, now: number, direction = 'north'): Departure[] {
  const config = LINES.find(line => line.id === lineId)?.directions.find(item => item.key === direction);
  if (!config) return [];
  const result = new Map<string, Departure>();
  for (const item of raw) {
    const products = item.ProductAtStop ? [item.ProductAtStop] : Array.isArray(item.Product) ? item.Product : item.Product ? [item.Product] : [];
    const line = products[0]?.line || item.name?.replace(/^(bus|s-tog|s)\s+/i, '').trim();
    if (line?.toUpperCase() !== lineId) continue;
    const destination = normalize(item.DestinationStop?.name || item.direction || '');
    if (!config.termini.some(terminus => destination === normalize(terminus) || destination.startsWith(normalize(terminus) + ' ('))) continue;
    const scheduled = departureTimestamp(item.date, item.time, item.tz);
    const realtime = !!item.rtTime;
    const expected = realtime ? departureTimestamp(item.rtDate || item.date, item.rtTime, item.rtTz ?? item.tz) : scheduled;
    if (!Number.isFinite(scheduled) || !Number.isFinite(expected) || expected < now) continue;
    const cancelled = item.cancelled === true || item.cancelled === 'true';
    const id = (item.JourneyDetailRef?.ref || lineId + '-' + destination) + '-' + scheduled;
    const track = item.rtTrack ? (item.rtTrackHidden ? null : item.rtTrack) : item.trackHidden ? null : item.track || null;
    // The planned platform is kept beside the realtime one so a change can be
    // marked rather than silently swapped under a waiting passenger.
    const scheduledTrack = item.trackHidden ? null : item.track || null;
    result.set(id, { id, scheduled, expected, cancelled, realtime, delay: Math.round((expected - scheduled) / 60000), track, scheduledTrack, alerts: rejseplanenAlerts(item.Messages) });
  }
  return [...result.values()].sort((a, b) => a.expected - b.expected).slice(0, BOARD_DEPTH);
}

type Stop = { id?: string; name?: string; isMainMast?: boolean; mainMast?: Stop; mainMastId?: string };
export function resolveStop(payload: unknown, name: string): string {
  // An HTML error page or a null body is this module's own error, not a
  // TypeError from dereferencing it.
  if (!payload || typeof payload !== 'object') throw new Error('Stop lookup answered something other than a stop list');
  const body = payload as { stopLocationOrCoordLocation?: { StopLocation?: Stop }[]; StopLocation?: Stop[] };
  const stops = body.stopLocationOrCoordLocation?.flatMap(entry => entry.StopLocation ? [entry.StopLocation] : []) || body.StopLocation || [];
  const matching = stops.filter(stop => stop.name && normalize(stop.name) === normalize(name));
  const ids = [...new Set(matching.map(stop => stop.mainMast?.id || stop.mainMastId || stop.id).filter((id): id is string => !!id))];
  const main = matching.find(stop => stop.isMainMast && stop.id);
  if (main?.id) return main.id;
  if (ids.length !== 1) throw new Error('Stop lookup could not be resolved uniquely');
  return ids[0];
}
