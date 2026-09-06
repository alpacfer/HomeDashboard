import { useMemo, useSyncExternalStore } from 'react';
import { clockSky, parsePinnedSky } from '@/lib/clock-sky';
import type { Conditions } from '@/lib/clock-conditions';

// Both rooms share the reported weather and debug sky, with no additional
// weather request or timer. URL snapshots are stable strings after hydration.
const subscribe = () => () => undefined;
const snapshot = () => new URLSearchParams(window.location.search).get('sky') ?? '';
const serverSnapshot = () => '';

// The clock ticks once a second and the sky is asked again on every one of
// them. Nothing in the answer can change that fast: the light phase turns over
// twice a day, the weather comes from a forecast refreshed every quarter of an
// hour, and the sun -- the one part that genuinely moves -- crosses the card at
// about half a pixel a minute. Rounding the question down to the minute is what
// keeps the disc's position one write a minute instead of sixty, on a display
// that is never reloaded and paints a full-card gradient every time it changes.
const MINUTE_MS = 60_000;

export function useSceneSky(now: Date | null, kind: Conditions['kind'], band: Conditions['band']) {
  const pin = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const minute = now ? Math.floor(now.getTime() / MINUTE_MS) : null;
  return useMemo(
    () => minute === null ? null : clockSky(minute * MINUTE_MS, kind, band, parsePinnedSky(pin)),
    [minute, kind, band, pin],
  );
}
