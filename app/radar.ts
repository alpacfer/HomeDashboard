export type RadarFrame = { time: number; path: string };
export type RadarTimeline = { host: string; frames: RadarFrame[] };

const RAIN_VIEWER_API = 'https://api.rainviewer.com/public/weather-maps.json';
const MAX_FRAMES = 13;

export function radarApiUrl() {
  return RAIN_VIEWER_API;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function parseFrame(value: unknown): RadarFrame | null {
  const item = record(value);
  if (!Number.isSafeInteger(item?.time) || typeof item?.path !== 'string' || !item.path.startsWith('/v2/radar/')) return null;
  return { time: item.time as number, path: item.path };
}

export function parseRadarTimeline(value: unknown, nowSeconds = Date.now() / 1000, limit = MAX_FRAMES): RadarTimeline | null {
  const data = record(value);
  const radar = record(data?.radar);
  const host = typeof data?.host === 'string' ? data.host.replace(/\/$/, '') : '';
  const past = Array.isArray(radar?.past) ? radar.past.map(parseFrame) : [];
  if (!host.startsWith('https://') || !past.length || past.some(frame => !frame)) return null;

  const frameLimit = Math.max(1, Math.min(MAX_FRAMES, Math.floor(limit)));
  const frames = (past as RadarFrame[])
    .filter(frame => frame.time <= nowSeconds + 10 * 60)
    .sort((a, b) => a.time - b.time)
    .slice(-frameLimit);
  return frames.length ? { host, frames } : null;
}

// Universal Blue is RainViewer's current public precipitation palette. The
// two trailing flags enable smooth tiles and keep snow in the same palette.
export function radarTileUrl(host: string, frame: RadarFrame) {
  return `${host.replace(/\/$/, '')}${frame.path}/512/{z}/{x}/{y}/2/1_1.png`;
}
