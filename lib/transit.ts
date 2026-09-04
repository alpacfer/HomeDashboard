export const LINES = [
  { id: '184', origin: 'Kildegårds Plads', stopName: 'Kildegårds Plads (Lyngbyvej)', style: 'local-bus', directions: [
    { key: 'north', destination: 'Lyngby', termini: ['Holte St.', 'Lyngby St.'] },
    { key: 'south', destination: 'Nørreport', termini: ['Nørreport St.'] },
  ] },
  { id: '150S', origin: 'Kildegårds Plads', stopName: 'Kildegårds Plads (Lyngbyvej)', style: 's-bus', directions: [
    { key: 'north', destination: 'Kokkedal', termini: ['Kokkedal St.'] },
    { key: 'south', destination: 'Nørreport', termini: ['Nørreport St.'] },
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

export type Departure = { id: string; scheduled: number; expected: number; cancelled: boolean; realtime: boolean; delay: number; track: string | null; scheduledTrack: string | null; alerts: DepartureAlert[] };
export type TransitSource = 'rejseplanen' | 'transitous';
export type TransitData = { status: 'ready' | 'needs_key' | 'unavailable'; generatedAt: number; boards: Record<string, Departure[]>; source?: TransitSource };

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
  if (!departure.cancelled && departure.delay <= -1) incidents.push({ kind: 'early', severity: 'info', label: Math.abs(departure.delay) + ' min early' });
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

// Pure: provider text and alert text are external input, so they are trimmed,
// collapsed and capped before they can reach React state or a JSON payload.
export function alertText(value: unknown): string {
  if (typeof value !== 'string') return '';
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > ALERT_TEXT_LIMIT ? text.slice(0, ALERT_TEXT_LIMIT - 1).trimEnd() + '\u2026' : text;
}

// Compact mode keeps the next usable departure for every existing direction.
// Never retain old times after the same five-minute expiry used by the full board.
export function nextCompactDeparture(data: TransitData | null, board: string, now: number): Departure | undefined {
  if (data?.status !== 'ready' || now - data.generatedAt > 300000) return undefined;
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
  return [...result.values()].sort((a, b) => a.expected - b.expected).slice(0, 12);
}

type Stop = { id?: string; name?: string; isMainMast?: boolean; mainMast?: Stop; mainMastId?: string };
export function resolveStop(payload: unknown, name: string): string {
  const body = payload as { stopLocationOrCoordLocation?: { StopLocation?: Stop }[]; StopLocation?: Stop[] };
  const stops = body.stopLocationOrCoordLocation?.flatMap(entry => entry.StopLocation ? [entry.StopLocation] : []) || body.StopLocation || [];
  const matching = stops.filter(stop => stop.name && normalize(stop.name) === normalize(name));
  const ids = [...new Set(matching.map(stop => stop.mainMast?.id || stop.mainMastId || stop.id).filter((id): id is string => !!id))];
  const main = matching.find(stop => stop.isMainMast && stop.id);
  if (main?.id) return main.id;
  if (ids.length !== 1) throw new Error('Stop lookup could not be resolved uniquely');
  return ids[0];
}
