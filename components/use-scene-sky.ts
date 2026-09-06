import { useSyncExternalStore } from 'react';
import { clockSky, parsePinnedSky } from '@/lib/clock-sky';
import type { Conditions } from '@/lib/clock-conditions';

// Both rooms share the reported weather and debug sky, with no additional
// weather request or timer. URL snapshots are stable strings after hydration.
const subscribe = () => () => undefined;
const snapshot = () => new URLSearchParams(window.location.search).get('sky') ?? '';
const serverSnapshot = () => '';

export function useSceneSky(now: Date | null, kind: Conditions['kind'], band: Conditions['band']) {
  const pin = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return now ? clockSky(now.getTime(), kind, band, parsePinnedSky(pin)) : null;
}
