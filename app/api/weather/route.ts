// The Google Weather API proxy. See lib/google-weather.ts for what is asked
// and why; this file exists only because the key cannot ship to the browser.
//
// Everything about the request is decided here, including where. The caller
// says which of the two forecasts it wants and nothing else: a route that
// forwarded coordinates would be an open proxy onto a metered key, and the
// display only ever asks about one place.
//
// Nothing is cached across a redeploy and nothing is persisted. The window is
// shorter than the refresh interval of whichever component asks, so the
// display never sees data older than it would have anyway; what it absorbs is
// the burst of page loads from `npm run audit`, `npm run shot` and a reload,
// each of which would otherwise spend a call from a monthly tier.

import { googleUpstreamUrl, isGoogleKind, type GoogleKind } from '@/lib/google-weather';
import { FORECAST_LATITUDE, FORECAST_LONGITUDE } from '@/lib/weather';

const TIMEOUT_MS = 8000;
// The card refreshes every 15 minutes and the strip every hour, so neither is
// ever served something staler than its own cycle. WeatherNext 3 initialises
// hourly in any case, so a few minutes is well inside the model's own step.
const TTL_MS: Record<GoogleKind, number> = { hours: 10 * 60 * 1000, days: 30 * 60 * 1000 };

const recent = new Map<GoogleKind, { payload: unknown; expires: number }>();
const inFlight = new Map<GoogleKind, Promise<unknown>>();

async function load(kind: GoogleKind, key: string) {
  // One controller per request with its own deadline, never a shared signal:
  // an AbortSignal stays aborted once it fires.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(googleUpstreamUrl(kind, FORECAST_LATITUDE, FORECAST_LONGITUDE, key), {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    // The status, never the body or the URL: both can quote the key back. The
    // body is cancelled rather than left unread: this process runs for weeks,
    // and an undici body nobody consumes holds its socket until it is
    // collected.
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('Google answered ' + response.status);
    }
    return await response.json() as unknown;
  } finally { clearTimeout(timeout); }
}

export async function GET(request: Request) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  const kind = new URL(request.url).searchParams.get('kind') ?? 'hours';
  if (!isGoogleKind(kind)) return Response.json({ error: 'unknown forecast' }, { status: 400, headers });

  // Not configured is not an error. Without a key the browser falls through to
  // DMI on the same refresh, which is what it did before this route existed.
  const key = process.env.GOOGLE_WEATHER_API_KEY;
  if (!key) return Response.json({ error: 'not configured' }, { status: 503, headers });

  const cached = recent.get(kind);
  if (cached && cached.expires > Date.now()) return Response.json(cached.payload, { headers });

  let pending = inFlight.get(kind);
  if (!pending) {
    pending = load(kind, key);
    inFlight.set(kind, pending);
  }
  try {
    const payload = await pending;
    recent.set(kind, { payload, expires: Date.now() + TTL_MS[kind] });
    return Response.json(payload, { headers });
  } catch (error) {
    // Named for the `[weather]` line the browser prints when every provider
    // fails, so the two can be read together. The message is ours, not
    // Google's, for the reason given in load().
    console.warn('[weather] Google ' + kind + ' failed:', (error as Error).message);
    return Response.json({ error: 'provider unavailable' }, { status: 503, headers });
  } finally { inFlight.delete(kind); }
}
