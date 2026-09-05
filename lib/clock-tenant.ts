// The Tenant: the small character that lives beside the minutes.
//
// This module holds everything about it that is not a DOM concern: its mood
// from the hour and the weather, what it does when idle, when the next minute
// rolls and which digit that changes, and the geometry that turns measured
// glyph boxes into the translations it needs to reach a digit. The component
// measures, this module computes, so every rule here is testable without a
// renderer.

export type Mood = 'asleep' | 'rain' | 'cold' | 'hot' | 'awake';

export type MoodContext = { hour: number; temperature: number | null; wet: boolean };

// Sleep beats weather: at 03:00 it is asleep whatever the sky is doing.
export function tenantMood({ hour, temperature, wet }: MoodContext): Mood {
  if (hour >= 23 || hour < 6) return 'asleep';
  if (wet) return 'rain';
  if (temperature !== null && temperature < 0) return 'cold';
  if (temperature !== null && temperature > 25) return 'hot';
  return 'awake';
}

// Small things it does with its face and body while settled. Blinks dominate
// so the rest stay surprising; the body gestures (stretch, wiggle, lean, hop)
// animate an inner group so they compose with whatever the pose is doing. The
// hop is selected here but executed by the shared root jump pipeline.
export type IdleAction =
  | 'blink' | 'double-blink' | 'glance-digits' | 'glance-up' | 'look-around' | 'smile'
  | 'stretch' | 'wiggle' | 'lean' | 'yawn' | 'hop' | 'scratch' | 'sneeze' | 'wave' | 'doze' | 'listen';

const IDLE_WEIGHTS: [IdleAction, number][] = [
  ['blink', 28], ['double-blink', 8], ['glance-digits', 10], ['glance-up', 5], ['look-around', 8],
  ['smile', 7], ['stretch', 5], ['wiggle', 4], ['lean', 5], ['yawn', 3], ['hop', 3],
  ['scratch', 5], ['sneeze', 2], ['wave', 3], ['doze', 2], ['listen', 2],
];

const BODY_GESTURES: IdleAction[] = ['stretch', 'wiggle', 'lean', 'hop', 'scratch', 'sneeze', 'wave', 'doze'];

// While perched the body is busy balancing, so only the face plays.
// At rest, recent special gestures are strongly suppressed and energy changes
// the style of idling. Blinks may repeat because real blinking does; a sneeze
// or wave should remain a surprise.
export function pickIdle(random: number, perched = false, recent: readonly IdleAction[] = [], energy = 0.7): IdleAction {
  const table = (perched ? IDLE_WEIGHTS.filter(([action]) => !BODY_GESTURES.includes(action)) : IDLE_WEIGHTS).map(([action, base]) => {
    let weight = base;
    if (energy < 0.4 && (action === 'yawn' || action === 'doze' || action === 'stretch')) weight *= 2;
    if (energy < 0.4 && (action === 'hop' || action === 'wiggle' || action === 'wave')) weight *= 0.25;
    if (action !== 'blink' && recent.includes(action)) weight *= 0.08;
    return [action, weight] as [IdleAction, number];
  });
  return weighted(table, random);
}

// The shape of the top of a glyph, which decides how the Tenant stands on it:
//   flat   a bar wider than its stance (3, 5, 7): stands square
//   ledge  a flat top narrower than its stance (the stem of a 1 or a 4): teeters
//   round  an arch (0, 2, 6, 8, 9): sways, and may slip off down the curve
//   ball   the colon's dot: a hard balance
export type TopKind = 'flat' | 'ledge' | 'round' | 'ball';

// What it does now and then while perched, by the shape under its feet.
export type PerchAction = 'sit' | 'peer' | 'teeter' | 'slip';

const PERCH_WEIGHTS: Record<TopKind, [PerchAction, number][]> = {
  flat: [['sit', 40], ['peer', 60]],
  ledge: [['teeter', 55], ['peer', 45]],
  round: [['slip', 40], ['peer', 40], ['teeter', 20]],
  ball: [['teeter', 70], ['slip', 30]],
};

export function pickPerchAction(kind: TopKind, random: number): PerchAction {
  return weighted(PERCH_WEIGHTS[kind], random);
}

// Where to perch next: one of the four digits, or the colon's top dot (4).
export const DOTS_SPOT = 4;
export function pickPerch(random: number): number {
  return weighted([[0, 18], [1, 18], [2, 22], [3, 26], [DOTS_SPOT, 16]], random);
}

function weighted<T>(table: [T, number][], random: number): T {
  let cursor = clamp01(random) * table.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [value, weight] of table) {
    cursor -= weight;
    if (cursor < 0) return value;
  }
  return table[0][0];
}

// How long it stays up before coming down: 6 to 14 seconds on a digit, less
// on the colon's dot, which is hard work.
export function perchDuration(random: number, kind: TopKind = 'flat'): number {
  const base = kind === 'ball' ? 3500 : 6000;
  return Math.round(base + clamp01(random) * (kind === 'ball' ? 3000 : 8000));
}
// Between things it does while perched.
export function perchIdleDelay(random: number): number {
  return Math.round(2200 + clamp01(random) * 2300);
}

export function msToNextMinute(now: Date): number {
  return 60000 - (now.getTime() % 60000);
}

const timeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Copenhagen', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

// Index (0-3) of the leftmost digit that changes at the next minute: 3 most
// minutes, 2 at a ten, 0 or 1 at an hour. Used to aim a glance.
export function nextChangingDigit(now: Date): number {
  const current = timeFormatter.format(now).replace(':', '');
  const next = timeFormatter.format(new Date(now.getTime() + msToNextMinute(now))).replace(':', '');
  for (let index = 0; index < 4; index++) if (current[index] !== next[index]) return index;
  return 3;
}

// Geometry. Boxes are in any shared pixel space (the component uses the clock
// block's own coordinates).
export type Box = { left: number; top: number; right: number; bottom: number };

export type GlyphMetrics = {
  width: number;
  actualBoundingBoxLeft: number;
  actualBoundingBoxRight: number;
  actualBoundingBoxAscent: number;
  actualBoundingBoxDescent: number;
  fontBoundingBoxAscent: number;
  fontBoundingBoxDescent: number;
};

// Where the ink of one digit actually is, from its cell and its canvas text
// metrics. The face is a flex box that centres its one glyph in the cell, so
// the glyph advance is centred horizontally and the line box vertically, with
// the content area (font ascent + descent) centred in the line box. Ink is
// then offset from the baseline and the advance start by the actual bounds.
export function inkBox(cell: Box, metrics: GlyphMetrics, lineHeight: number): Box {
  const centreX = (cell.left + cell.right) / 2;
  const centreY = (cell.top + cell.bottom) / 2;
  const start = centreX - metrics.width / 2;
  const content = metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent;
  const baseline = centreY - lineHeight / 2 + (lineHeight - content) / 2 + metrics.fontBoundingBoxAscent;
  return {
    left: start - metrics.actualBoundingBoxLeft,
    right: start + metrics.actualBoundingBoxRight,
    top: baseline - metrics.actualBoundingBoxAscent,
    bottom: baseline + metrics.actualBoundingBoxDescent,
  };
}

// The top of a glyph, read from a bitmap of it. The component draws each digit
// on a small canvas; these two functions turn the pixels into a stance.

export type Columns = {
  // The ink's bounding box in bitmap pixels, inclusive.
  left: number; right: number; top: number; bottom: number;
  // For each column from left to right, the top inked row relative to `top`,
  // or null where the column has no ink at all.
  tops: (number | null)[];
};

// Per-column tops from an RGBA bitmap (a canvas ImageData's data). Null when
// nothing was drawn.
export function inkColumns(rgba: ArrayLike<number>, width: number, height: number, threshold = 127): Columns | null {
  const tops: (number | null)[] = [];
  let left = -1, right = -1, top = height, bottom = -1;
  for (let x = 0; x < width; x++) {
    let first: number | null = null, last = -1;
    for (let y = 0; y < height; y++) {
      if (rgba[(y * width + x) * 4 + 3] > threshold) { if (first === null) first = y; last = y; }
    }
    if (first !== null) {
      if (left < 0) left = x;
      right = x;
      top = Math.min(top, first);
      bottom = Math.max(bottom, last);
    }
    tops.push(first);
  }
  if (right < 0) return null;
  return { left, right, top, bottom, tops: tops.slice(left, right + 1).map(t => t === null ? null : t - top) };
}

export type TopProfile = {
  kind: Exclude<TopKind, 'ball'>;
  // Centre of the highest flat run, as a fraction of the ink width from its
  // left edge. .5 for a 7, about .68 for a 1 whose flag hangs off the left.
  apex: number;
  // Width of that run as a fraction of the ink width.
  plateau: number;
  // Which way it would slip off an arch: +1 right, -1 left. Towards the lower
  // side, or right when the arch is symmetric.
  slide: 1 | -1;
};

// Classify a top. `body` is the Tenant's width in the same pixels as the
// columns; a flat top narrower than most of it is a ledge. Columns within 3% of
// the glyph height of the apex form the plateau; the band within 15% shows
// how quickly the sides fall away. An arch has a plateau much narrower than
// its band, a bar or a stem has the two nearly equal.
export function topProfile(columns: Columns, body: number): TopProfile {
  const { tops } = columns;
  const width = tops.length;
  const height = columns.bottom - columns.top + 1;
  const near = Math.max(1, height * 0.03);
  const wide = Math.max(2, height * 0.15);
  const run = longestRun(tops, near);
  const band = longestRun(tops, wide);
  const steepness = band.length ? run.length / band.length : 1;
  const plateau = run.length / width;
  const apex = (run.start + run.length / 2) / width;
  let kind: TopProfile['kind'] = 'round';
  if (steepness >= 0.7) kind = run.length >= body * 0.7 ? 'flat' : 'ledge';
  const centre = (band.start + band.length / 2) / width;
  return { kind, apex: round(apex, 1000), plateau: round(plateau, 1000), slide: apex < centre - 0.02 ? 1 : apex > centre + 0.02 ? -1 : 1 };
}

// The longest contiguous run of columns whose top lies within `tolerance` of
// the highest top.
function longestRun(tops: (number | null)[], tolerance: number): { start: number; length: number } {
  let best = { start: 0, length: 0 };
  let start = -1;
  for (let x = 0; x <= tops.length; x++) {
    const t = tops[x];
    const inside = x < tops.length && t !== null && t !== undefined && t <= tolerance;
    if (inside && start < 0) start = x;
    if (!inside && start >= 0) {
      if (x - start > best.length) best = { start, length: x - start };
      start = -1;
    }
  }
  return best;
}

export type Perch = {
  // Translation that stands the Tenant on the spot, feet on its top.
  x: number; y: number;
  kind: TopKind;
  slide: 1 | -1;
};

export type Targets = {
  // The four digits' tops, then the colon's top dot (DOTS_SPOT) when known.
  perch: Perch[];
  // Where the Tenant rests: bottom on the digits' baseline, just right of the
  // last cell. In the block's coordinates.
  rest: { left: number; top: number };
  // Safe edges elsewhere in the dashboard. They are measured only when the
  // layout or active panel changes, then crossed with compositor transforms.
  world: WorldSpot[];
  // Every measured place sturdy enough to land. World destinations are also
  // included, but the extra pads let a long trip become several real jumps
  // instead of one diagonal glide through the dashboard.
  safe: LandingSpot[];
};

export type WorldSpotId = 'weather' | 'week' | 'transport' | 'fact' | 'map';
export type WorldSpot = { id: WorldSpotId; x: number; y: number; look: 1 | -1 };
export type LandingSpot = { key: string; x: number; y: number };
export type TravelPoint = { x: number; y: number };

// Turn a UI surface into the translation that puts the Tenant's feet on its
// top or bottom edge. All boxes share viewport coordinates; `rest` is local to
// the clock block, which is why the origin is removed as well.
export function worldSpotTarget(id: WorldSpotId, surface: Box, origin: Box, rest: Targets['rest'], size: number,
  align = 0.5, edge: 'top' | 'bottom' = 'top'): WorldSpot {
  const target = surfaceTarget(surface, origin, rest, size, align, edge);
  return { id, x: target.x, y: target.y, look: target.align >= 0.5 ? -1 : 1 };
}

export function landingSpotTarget(key: string, surface: Box, origin: Box, rest: Targets['rest'], size: number,
  align = 0.5, edge: 'top' | 'bottom' = 'top'): LandingSpot {
  const target = surfaceTarget(surface, origin, rest, size, align, edge);
  return { key, x: target.x, y: target.y };
}

function surfaceTarget(surface: Box, origin: Box, rest: Targets['rest'], size: number,
  align: number, edge: 'top' | 'bottom') {
  const safeAlign = Math.min(1, Math.max(0, Number.isFinite(align) ? align : 0.5));
  const landingLeft = surface.left + safeAlign * Math.max(0, surface.right - surface.left - size);
  const landingBottom = edge === 'bottom' ? surface.bottom : surface.top;
  return {
    x: round(landingLeft - origin.left - rest.left),
    y: round(landingBottom - origin.top - size - rest.top),
    align: safeAlign,
  };
}

// Ballistic flight under constant gravity. Solve the ascent and descent
// separately: the apex of a jump onto a higher ledge is NOT halfway along it.
// All timing follows the height and landing speed, in body-sized units.
export type HopArc = {
  from: TravelPoint;
  to: TravelPoint;
  duration: number;
  flightMs: number;
  chargeMs: number;
  settleMs: number;
  gravity: number;
  launchSpeed: number;
  impactSpeed: number;
  squash: number;
  apexAt: number;
  quarter: TravelPoint;
  apex: TravelPoint;
  threeQuarter: TravelPoint;
};

export function tenantHopArc(from: TravelPoint, to: TravelPoint, size: number, ceiling = -Infinity, vigor = 0.5): HopArc {
  const body = Math.max(1, Number.isFinite(size) ? size : 1);
  const horizontal = Math.abs(to.x - from.x);
  const desired = Math.min(body * 2.35, body * 1.15 + horizontal * 0.24) * (0.94 + clamp01(vigor) * 0.12);
  const highest = Math.min(from.y, to.y);
  const lift = Math.min(desired, Math.max(1, highest - ceiling));
  const apexY = highest - lift;
  const gravity = body * 34;
  const launchSpeed = Math.sqrt(2 * gravity * (from.y - apexY));
  const impactSpeed = Math.sqrt(2 * gravity * (to.y - apexY));
  const seconds = (launchSpeed + impactSpeed) / gravity;
  const effort = Math.min(1, launchSpeed / (body * 13));
  const settleMs = Math.round(330 + Math.min(1, impactSpeed / (body * 18)) * 170);
  const point = (at: number): TravelPoint => ({
    x: from.x + (to.x - from.x) * at,
    y: from.y - launchSpeed * seconds * at + gravity * (seconds * at) ** 2 / 2,
  });
  const apexAt = launchSpeed / gravity / seconds;
  return { from, to, gravity, launchSpeed, impactSpeed, apexAt,
    flightMs: seconds * 1000, settleMs, duration: seconds * 1000 + settleMs,
    chargeMs: Math.round(330 + effort * 230), squash: 0.16 + effort * 0.12,
    quarter: point(0.25), apex: { x: point(apexAt).x, y: apexY }, threeQuarter: point(0.75),
  };
}

export function tenantHopPoint(arc: HopArc, progress: number): TravelPoint {
  const at = Math.min(1, Math.max(0, progress));
  if (at === 0) return arc.from;
  if (at === 1) return arc.to;
  const seconds = arc.flightMs * at / 1000;
  return { x: arc.from.x + (arc.to.x - arc.from.x) * at,
    y: arc.from.y - arc.launchSpeed * seconds + arc.gravity * seconds ** 2 / 2 };
}

// Find the shortest chain whose individual jumps fit the Tenant's scale. A
// distant destination is never connected directly when a measured pad can
// break the trip up; if the measured graph has a gap, the best real pad still
// becomes an intermediate landing rather than inventing a point in empty air.
export function tenantTravelRoute(from: TravelPoint, to: TravelPoint, safe: readonly LandingSpot[], size: number): TravelPoint[] {
  const direct = distance(from, to);
  const hopLimit = Math.min(310, Math.max(190, size * 4.2));
  if (direct <= hopLimit) return [to];

  const pads = uniquePoints(safe.filter(spot => distance(spot, from) > 2 && distance(spot, to) > 2));
  const nodes: TravelPoint[] = [from, ...pads, to];
  const destination = nodes.length - 1;
  const costs = nodes.map(() => Number.POSITIVE_INFINITY);
  const previous = nodes.map(() => -1);
  const open = new Set(nodes.map((_, index) => index));
  costs[0] = 0;
  while (open.size) {
    let current = -1;
    for (const index of open) if (current < 0 || costs[index] < costs[current]) current = index;
    if (current < 0 || !Number.isFinite(costs[current]) || current === destination) break;
    open.delete(current);
    for (const next of open) {
      const hop = distance(nodes[current], nodes[next]);
      if (hop > hopLimit) continue;
      const cost = costs[current] + hop;
      if (cost < costs[next]) { costs[next] = cost; previous[next] = current; }
    }
  }
  if (Number.isFinite(costs[destination])) {
    const route: TravelPoint[] = [];
    for (let at = destination; at > 0; at = previous[at]) route.unshift(nodes[at]);
    return route;
  }

  const middle = pads.reduce<TravelPoint | null>((best, pad) => {
    const score = distance(from, pad) + distance(pad, to) + Math.abs(distance(from, pad) - distance(pad, to)) * 0.35;
    if (!best) return pad;
    const bestScore = distance(from, best) + distance(best, to) + Math.abs(distance(from, best) - distance(best, to)) * 0.35;
    return score < bestScore ? pad : best;
  }, null);
  return middle ? [middle, to] : [to];
}

function uniquePoints(spots: readonly LandingSpot[]): LandingSpot[] {
  return spots.filter((spot, index) => spots.findIndex(other => distance(spot, other) < 2) === index);
}

function distance(a: TravelPoint, b: TravelPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function tenantTargets(ink: Box[], lastCell: Box, size: number, gap: number, profiles: (TopProfile | null)[] = [], dot: Box | null = null): Targets {
  const baseline = Math.max(...ink.map(box => box.bottom));
  const rest = { left: lastCell.right + gap, top: baseline - size };
  const restBox = { left: rest.left, top: rest.top, right: rest.left + size, bottom: baseline };
  const restCentre = (restBox.left + restBox.right) / 2;
  const perch: Perch[] = ink.map((box, index) => {
    const profile = profiles[index] ?? null;
    const width = box.right - box.left;
    const apex = profile ? box.left + profile.apex * width : (box.left + box.right) / 2;
    return {
      x: round(apex - restCentre),
      y: round(box.top - restBox.bottom),
      kind: profile?.kind ?? 'flat',
      slide: profile?.slide ?? 1,
    };
  });
  if (dot) perch.push({ x: round((dot.left + dot.right) / 2 - restCentre), y: round(dot.top - restBox.bottom), kind: 'ball', slide: 1 });
  return {
    perch,
    rest: { left: round(rest.left), top: round(rest.top) },
    world: [],
    safe: [],
  };
}

function round(value: number, precision = 10) {
  return Math.round(value * precision) / precision;
}

function clamp01(value: number) {
  return Number.isFinite(value) ? Math.min(0.999999, Math.max(0, value)) : 0;
}
