// Transport and facts are read at a glance and get fifteen seconds. The
// forecast map keeps thirty because it is the only animated scene and has a
// whole six-hour sequence to play. Its frame timing in
// components/forecast-map-panel.tsx is budgeted against MAP_MS and will cut the
// sequence short if this shrinks without it.
export const TRANSPORT_MS = 15_000;
export const FACT_MS = 15_000;
export const MAP_MS = 30_000;
export type Rotation = { phase: 'transport' | 'fact' | 'map'; index: number; duration: number };

export function initialRotation(index: number, count: number): Rotation {
  const safe = Number.isSafeInteger(index) && index >= 0 ? index : 0;
  return { phase: 'transport', index: safe % Math.max(1, count), duration: TRANSPORT_MS };
}

export function nextRotation(current: Rotation, count: number): Rotation {
  if (current.phase === 'transport') return { phase: 'fact', index: current.index, duration: FACT_MS };
  if (current.phase === 'fact') return { phase: 'map', index: current.index, duration: MAP_MS };
  return initialRotation(current.index + 1, count);
}

export function resumeRotation(current: Rotation, count: number): Rotation {
  return initialRotation(current.index + (current.phase === 'transport' ? 0 : 1), count);
}
