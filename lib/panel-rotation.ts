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

// Debug mode. `/?scene=map` pins the rotating panel to one scene so a change
// to it can be seen without waiting for the rotation to come round. `scene` is
// one of the phases; `fact` picks which daily fact (zero-based, wrapped like
// the saved index). Anything unrecognised is ignored and the panel rotates as
// normal, so a mistyped URL can never leave the display stuck. A pinned
// rotation has no duration: nothing is scheduled after it.
export const SCENES: ReadonlyArray<Rotation['phase']> = ['transport', 'fact', 'map'];

export function pinnedRotation(search: string, count: number): Rotation | null {
  const params = new URLSearchParams(search);
  const scene = params.get('scene');
  if (!scene || !SCENES.includes(scene as Rotation['phase'])) return null;
  const index = params.has('fact') ? Number(params.get('fact')) : 0;
  return { phase: scene as Rotation['phase'], index: initialRotation(index, count).index, duration: 0 };
}
