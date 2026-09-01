export const TRANSPORT_MS = 30_000;
export const FACT_MS = 30_000;
export const RADAR_MS = 30_000;
export type Rotation = { phase: 'transport' | 'fact' | 'radar'; index: number; duration: number };

export function initialRotation(index: number, count: number): Rotation {
  const safe = Number.isSafeInteger(index) && index >= 0 ? index : 0;
  return { phase: 'transport', index: safe % Math.max(1, count), duration: TRANSPORT_MS };
}

export function nextRotation(current: Rotation, count: number): Rotation {
  if (current.phase === 'transport') return { phase: 'fact', index: current.index, duration: FACT_MS };
  if (current.phase === 'fact') return { phase: 'radar', index: current.index, duration: RADAR_MS };
  return initialRotation(current.index + 1, count);
}

export function resumeRotation(current: Rotation, count: number): Rotation {
  return initialRotation(current.index + (current.phase === 'transport' ? 0 : 1), count);
}
