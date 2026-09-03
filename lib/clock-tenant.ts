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
// animate an inner group so they compose with whatever the pose is doing.
export type IdleAction =
  | 'blink' | 'double-blink' | 'glance-digits' | 'glance-up' | 'look-around' | 'smile'
  | 'stretch' | 'wiggle' | 'lean' | 'yawn' | 'hop';

const IDLE_WEIGHTS: [IdleAction, number][] = [
  ['blink', 34], ['double-blink', 10], ['glance-digits', 12], ['glance-up', 6], ['look-around', 8],
  ['smile', 8], ['stretch', 5], ['wiggle', 5], ['lean', 6], ['yawn', 3], ['hop', 3],
];

const BODY_GESTURES: IdleAction[] = ['stretch', 'wiggle', 'lean', 'hop'];

// While perched the body is busy balancing or pacing, so only the face plays.
export function pickIdle(random: number, perched = false): IdleAction {
  return weighted(perched ? IDLE_WEIGHTS.filter(([action]) => !BODY_GESTURES.includes(action)) : IDLE_WEIGHTS, random);
}

// The shape of the top of a glyph, which decides how the Tenant stands on it:
//   flat   a bar wider than its stance (3, 5, 7): stands square, can pace
//   ledge  a flat top narrower than its stance (the stem of a 1 or a 4): teeters
//   round  an arch (0, 2, 6, 8, 9): sways, and may slip off down the curve
//   ball   the colon's dot: a hard balance
export type TopKind = 'flat' | 'ledge' | 'round' | 'ball';

// What it does now and then while perched, by the shape under its feet.
export type PerchAction = 'pace' | 'sit' | 'peer' | 'teeter' | 'slip';

const PERCH_WEIGHTS: Record<TopKind, [PerchAction, number][]> = {
  flat: [['pace', 45], ['sit', 25], ['peer', 30]],
  ledge: [['teeter', 55], ['peer', 45]],
  round: [['slip', 40], ['peer', 40], ['teeter', 20]],
  ball: [['teeter', 70], ['slip', 30]],
};

export function pickPerchAction(kind: TopKind, random: number): PerchAction {
  return weighted(PERCH_WEIGHTS[kind], random);
}

// How it comes down: climbs back, hops off, or, from an arch, slides off it.
export type Descent = 'climb-down' | 'hop-off' | 'slide';

export function pickDescent(kind: TopKind, random: number): Descent {
  const r = clamp01(random);
  if (kind === 'round' || kind === 'ball') return r < 0.45 ? 'slide' : r < 0.75 ? 'hop-off' : 'climb-down';
  return r < 0.55 ? 'climb-down' : 'hop-off';
}

// How it meets the rolling digit, and how it marks the hour.
export type Strike = 'shove' | 'kick' | 'headbutt';
export function pickStrike(random: number): Strike {
  return weighted([['shove', 55], ['kick', 25], ['headbutt', 20]], random);
}
export type HourAction = 'jump' | 'hops';
export function pickHourAction(random: number): HourAction {
  return clamp01(random) < 0.6 ? 'jump' : 'hops';
}

// Where to climb next: one of the four digits, or the colon's top dot (4).
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

// Blinks and glances every 3 to 8 seconds; a climb somewhere every 25 to 45.
export function idleDelay(random: number): number {
  return Math.round(3000 + clamp01(random) * 5000);
}
export function climbDelay(random: number): number {
  return Math.round(25000 + clamp01(random) * 20000);
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

// The approach starts this long before the minute boundary. The walk takes
// APPROACH_MS, so it arrives and holds a ready pose until the roll actually
// shows up, which the parent's one-second tick can deliver up to a second late.
export const APPROACH_LEAD_MS = 1600;
export const APPROACH_MS = 1100;
// If no roll follows an approach (hidden tab, clock correction), give up and
// walk back after this long.
export const APPROACH_TIMEOUT_MS = 3500;

export function msToNextMinute(now: Date): number {
  return 60000 - (now.getTime() % 60000);
}

// True on the one tick per minute at which the approach should begin. The
// parent ticks every second, so exactly one tick lands in this window.
export function shouldApproach(now: Date): boolean {
  const remaining = msToNextMinute(now);
  return remaining <= APPROACH_LEAD_MS && remaining > APPROACH_LEAD_MS - 1000;
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
  // How far it can step each way along a flat top and keep both feet on it.
  pace: number;
  slide: 1 | -1;
};

export type Targets = {
  // Translation that brings the Tenant's left edge against the last digit's
  // right ink edge, overlapping a little so the shove reads as contact.
  pushX: number;
  // The four digits' tops, then the colon's top dot (DOTS_SPOT) when known.
  perch: Perch[];
  // Where the Tenant rests: bottom on the digits' baseline, just right of the
  // last cell. In the block's coordinates.
  rest: { left: number; top: number };
};

const STANCE = 0.42; // feet span as a fraction of the Tenant's width

export function tenantTargets(ink: Box[], lastCell: Box, size: number, gap: number, profiles: (TopProfile | null)[] = [], dot: Box | null = null, overlap = 0.14): Targets {
  const baseline = Math.max(...ink.map(box => box.bottom));
  const rest = { left: lastCell.right + gap, top: baseline - size };
  const restBox = { left: rest.left, top: rest.top, right: rest.left + size, bottom: baseline };
  const restCentre = (restBox.left + restBox.right) / 2;
  const last = ink[ink.length - 1];
  const perch: Perch[] = ink.map((box, index) => {
    const profile = profiles[index] ?? null;
    const width = box.right - box.left;
    const apex = profile ? box.left + profile.apex * width : (box.left + box.right) / 2;
    const plateau = profile ? profile.plateau * width : 0;
    return {
      x: round(apex - restCentre),
      y: round(box.top - restBox.bottom),
      kind: profile?.kind ?? 'flat',
      pace: profile?.kind === 'flat' ? round(Math.max(0, (plateau - STANCE * size) / 2)) : 0,
      slide: profile?.slide ?? 1,
    };
  });
  if (dot) perch.push({ x: round((dot.left + dot.right) / 2 - restCentre), y: round(dot.top - restBox.bottom), kind: 'ball', pace: 0, slide: 1 });
  return {
    pushX: round(last.right + overlap * size - restBox.left),
    perch,
    rest: { left: round(rest.left), top: round(rest.top) },
  };
}

function round(value: number, precision = 10) {
  return Math.round(value * precision) / precision;
}

function clamp01(value: number) {
  return Number.isFinite(value) ? Math.min(0.999999, Math.max(0, value)) : 0;
}
