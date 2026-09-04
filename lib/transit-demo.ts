// A synthetic departure board, for `?transit=demo`.
//
// Delays and cancellations are the states the panel exists to mark and the
// states a live feed almost never shows on demand: waiting for Movia to cancel
// a 184 is not a way to check that the marking still works. This is the same
// answer lib/precipitation-demo.ts gives for the forecast map — a deterministic
// stand-in that makes no request — except that it is only ever built inside the
// route handler, so it never reaches the browser bundle.
//
// It is not a fallback. Nothing reaches for it unless the URL asks.

import { LINES, type Departure, type TransitData } from '@/lib/transit';

type Sketch = {
  minutes: number;
  delay?: number;
  cancelled?: boolean;
  scheduled?: boolean;
  track?: [now: string, planned: string];
  alert?: { severity: 'severe' | 'warning' | 'info'; text: string };
};

// One case per mark the panel can draw, spread so that each board shows a
// different one and a single capture covers the lot.
const SCRIPT: Record<string, Sketch[]> = {
  '184:north': [{ minutes: 4 }, { minutes: 19, delay: 3 }, { minutes: 39, scheduled: true }],
  '184:south': [{ minutes: 2, cancelled: true }, { minutes: 12 }, { minutes: 31, delay: 12 }],
  '150S:north': [{ minutes: 3, delay: -2 }, { minutes: 11 }, { minutes: 22, scheduled: true }],
  '150S:south': [{ minutes: 6, alert: { severity: 'warning', text: 'Omkørsel ved Ryparken' } }, { minutes: 14 }, { minutes: 26 }],
  'A:north': [{ minutes: 5, track: ['2', '1'] }, { minutes: 15, alert: { severity: 'severe', text: 'Sporarbejde: tog aflyst mod Hillerød' } }, { minutes: 25 }],
};

export function demoTransitData(now: number): TransitData {
  const boards: Record<string, Departure[]> = {};
  for (const line of LINES) for (const direction of line.directions) {
    const key = line.id + ':' + direction.key;
    boards[key] = (SCRIPT[key] ?? []).map((sketch, index) => {
      const delay = sketch.delay ?? 0;
      const expected = now + sketch.minutes * 60000;
      return {
        id: key + '-demo-' + index,
        scheduled: expected - delay * 60000,
        expected,
        cancelled: sketch.cancelled === true,
        realtime: sketch.scheduled !== true,
        delay,
        track: sketch.track?.[0] ?? null,
        scheduledTrack: sketch.track?.[1] ?? null,
        alerts: sketch.alert ? [sketch.alert] : [],
      };
    });
  }
  return { status: 'ready', generatedAt: now, boards };
}
