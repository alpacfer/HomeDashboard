import { filterDepartures, LINES, resolveStop, type RawDeparture, type TransitData } from '@/lib/transit';

const API = 'https://www.rejseplanen.dk/api/';
const stopCache = new Map<string, { id: string; expires: number }>();
let recent: { data: TransitData; expires: number } | null = null;
let inFlight: Promise<TransitData> | null = null;

async function request(accessId: string, endpoint: string, params: Record<string, string>) {
  const url = new URL(endpoint, API);
  url.search = new URLSearchParams({ accessId, format: 'json', lang: 'da', ...params }).toString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Transit provider unavailable');
    const data = await response.json() as Record<string, unknown>;
    if (data.errorCode || data.errorText) throw new Error('Transit provider returned an error');
    return data;
  } finally { clearTimeout(timeout); }
}
async function location(accessId: string, name: string) {
  const cached = stopCache.get(name);
  if (cached && cached.expires > Date.now()) return cached.id;
  const data = await request(accessId, 'location.name', { input: name, type: 'S', maxNo: '20', withMastNames: '0' });
  const id = resolveStop(data, name);
  stopCache.set(name, { id, expires: Date.now() + 86400000 });
  return id;
}
async function load(accessId: string): Promise<TransitData> {
  const stopNames = [...new Set(LINES.map(line => line.stopName))];
  const boards: Record<string, ReturnType<typeof filterDepartures>> = {};
  await Promise.all(stopNames.map(async name => {
    const id = await location(accessId, name);
    const lines = LINES.filter(line => line.stopName === name);
    const payload = await request(accessId, 'departureBoard', { id, lines: lines.map(line => line.id).join(','), duration: '1439', maxJourneys: '-1', type: 'DEP_STATION', rtMode: 'SERVER_DEFAULT' });
    const raw = payload.Departure === undefined ? [] : Array.isArray(payload.Departure) ? payload.Departure as RawDeparture[] : [payload.Departure as RawDeparture];
    for (const line of lines) for (const direction of line.directions) {
      boards[line.id + ':' + direction.key] = filterDepartures(raw, line.id, Date.now(), direction.key);
    }
  }));
  return { status: 'ready', generatedAt: Date.now(), boards };
}
export async function GET() {
  const key = process.env.REJSEPLANEN_ACCESS_ID;
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (!key) return Response.json({ status: 'needs_key', generatedAt: Date.now(), boards: {} }, { headers });
  // Two stop boards every two minutes (~44,640 calls in a 31-day month).
  // Cache only public transit results, never the API key or request URL.
  if (recent && recent.expires > Date.now()) return Response.json(recent.data, { headers });
  try {
    if (!inFlight) inFlight = load(key);
    const data = await inFlight;
    recent = { data, expires: Date.now() + 120000 };
    return Response.json(data, { headers });
  } catch {
    // Never echo provider error messages: they may contain credential URLs.
    return Response.json({ status: 'unavailable', generatedAt: Date.now(), boards: {} }, { status: 503, headers });
  } finally { inFlight = null; }
}
