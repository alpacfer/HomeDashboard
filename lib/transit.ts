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
export type Departure = { id: string; scheduled: number; expected: number; cancelled: boolean; realtime: boolean; delay: number; track: string | null };
export type TransitData = { status: 'ready' | 'needs_key' | 'unavailable'; generatedAt: number; boards: Record<string, Departure[]> };

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
};
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
    result.set(id, { id, scheduled, expected, cancelled, realtime, delay: Math.round((expected - scheduled) / 60000), track });
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
