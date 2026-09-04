import { filterDepartures, LINES, resolveStop, type Departure, type RawDeparture, type TransitData } from '@/lib/transit';
import { parseStopTimes, TRANSITOUS_ENDPOINT, TRANSITOUS_EVENTS, TRANSITOUS_STOPS, TRANSITOUS_USER_AGENT } from '@/lib/transitous';
import { demoTransitData } from '@/lib/transit-demo';

const API = 'https://www.rejseplanen.dk/api/';
// Both providers are tried inside the twelve seconds the browser waits, so a
// primary that hangs still leaves room for the fallback to answer. A shared
// deadline would not: one slow board would spend the whole budget.
const PRIMARY_TIMEOUT_MS = 6000;
const FALLBACK_TIMEOUT_MS = 5000;
const stopCache = new Map<string, { id: string; expires: number }>();
let recent: { data: TransitData; expires: number } | null = null;
let inFlight: Promise<TransitData> | null = null;

type Boards = Record<string, Departure[]>;

async function request(accessId: string, endpoint: string, params: Record<string, string>) {
  const url = new URL(endpoint, API);
  url.search = new URLSearchParams({ accessId, format: 'json', lang: 'da', ...params }).toString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PRIMARY_TIMEOUT_MS);
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
  const boards: Boards = {};
  await Promise.all(stopNames.map(async name => {
    const id = await location(accessId, name);
    const lines = LINES.filter(line => line.stopName === name);
    const payload = await request(accessId, 'departureBoard', { id, lines: lines.map(line => line.id).join(','), duration: '1439', maxJourneys: '-1', type: 'DEP_STATION', rtMode: 'SERVER_DEFAULT' });
    const raw = payload.Departure === undefined ? [] : Array.isArray(payload.Departure) ? payload.Departure as RawDeparture[] : [payload.Departure as RawDeparture];
    for (const line of lines) for (const direction of line.directions) {
      boards[line.id + ':' + direction.key] = filterDepartures(raw, line.id, Date.now(), direction.key);
    }
  }));
  return { status: 'ready', generatedAt: Date.now(), boards, source: 'rejseplanen' };
}

// The keyless fallback. One MOTIS `stoptimes` call per stop, each with its own
// controller and deadline, and an identifying User-Agent because Transitous
// asks for one. See lib/transitous.ts for why this provider and not another.
async function loadTransitous(): Promise<TransitData> {
  const stopNames = [...new Set(LINES.map(line => line.stopName))];
  const boards: Boards = {};
  await Promise.all(stopNames.map(async name => {
    const id = TRANSITOUS_STOPS[name];
    if (!id) throw new Error('Transit fallback has no stop id for this stop');
    const url = new URL(TRANSITOUS_ENDPOINT);
    url.search = new URLSearchParams({ stopId: id, n: String(TRANSITOUS_EVENTS), arriveBy: 'false' }).toString();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FALLBACK_TIMEOUT_MS);
    let payload: unknown;
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json', 'User-Agent': TRANSITOUS_USER_AGENT } });
      if (!response.ok) throw new Error('Transit fallback unavailable');
      payload = await response.json();
    } finally { clearTimeout(timeout); }
    const now = Date.now();
    for (const line of LINES.filter(item => item.stopName === name)) for (const direction of line.directions) {
      boards[line.id + ':' + direction.key] = parseStopTimes(payload, name, line.id, direction.key, now);
    }
  }));
  return { status: 'ready', generatedAt: Date.now(), boards, source: 'transitous' };
}

// Rejseplanen first when there is a key, Transitous when there is not or when
// Rejseplanen fails. Provider errors are logged for `npm run probe:transit` to
// corroborate but never returned: a message can carry the credentialed URL.
async function loadChain(key: string | undefined): Promise<TransitData> {
  if (key) {
    try { return await load(key); }
    catch (error) { console.warn('[transit] Rejseplanen failed, falling back to Transitous:', (error as Error).message); }
  }
  return loadTransitous();
}

export async function GET(request: Request) {
  const key = process.env.REJSEPLANEN_ACCESS_ID;
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  // Debug: `?transit=demo` on the page reaches the route as `?demo=1`. No
  // provider is asked and nothing is cached, so a capture of the marking can
  // never leave a synthetic board behind. See lib/transit-demo.ts.
  if (new URL(request.url).searchParams.get('demo') === '1') {
    return Response.json(demoTransitData(Date.now()), { headers });
  }
  // Two stop boards every two minutes (~44,640 calls in a 31-day month).
  // Cache only public transit results, never the API key or request URL.
  if (recent && recent.expires > Date.now()) return Response.json(recent.data, { headers });
  try {
    if (!inFlight) inFlight = loadChain(key);
    const data = await inFlight;
    recent = { data, expires: Date.now() + 120000 };
    return Response.json(data, { headers });
  } catch (error) {
    console.warn('[transit] every provider failed:', (error as Error).message);
    // Never echo provider error messages: they may contain credential URLs.
    return Response.json({ status: 'unavailable', generatedAt: Date.now(), boards: {} }, { status: 503, headers });
  } finally { inFlight = null; }
}
