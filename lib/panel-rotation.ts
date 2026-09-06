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

// `map` says whether the forecast map is worth its thirty seconds. It is not
// when the next six hours hold no precipitation anywhere on the grid: half a
// minute of an empty map with a caption saying so is half a minute the
// departures and the next fact could have had, on a display whose whole cycle
// is a minute. The map then rejoins the rotation by itself when rain returns,
// so this is a skip and never a removal. The panel decides; see
// components/forecast-map-panel.tsx, which reports it, and
// components/rotating-panel.tsx, which passes it here.
//
// Only the step into the map is skipped. A map already on screen when the
// forecast turns dry plays out its scene and says so, rather than being cut
// off mid-sequence by a refresh landing behind it.
export function nextRotation(current: Rotation, count: number, map = true): Rotation {
  if (current.phase === 'transport') return { phase: 'fact', index: current.index, duration: FACT_MS };
  if (current.phase === 'fact' && map) return { phase: 'map', index: current.index, duration: MAP_MS };
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
