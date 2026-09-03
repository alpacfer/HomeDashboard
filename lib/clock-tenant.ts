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

export type IdleAction = 'blink' | 'double-blink' | 'glance-digits' | 'glance-up' | 'smile';

const IDLE_WEIGHTS: [IdleAction, number][] = [
  ['blink', 50], ['double-blink', 15], ['glance-digits', 15], ['glance-up', 10], ['smile', 10],
];

export function pickIdle(random: number): IdleAction {
  let cursor = clamp01(random) * IDLE_WEIGHTS.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [action, weight] of IDLE_WEIGHTS) {
    cursor -= weight;
    if (cursor < 0) return action;
  }
  return 'blink';
}

// Blinks and glances every 3 to 8 seconds; a climb somewhere every 25 to 45.
export function idleDelay(random: number): number {
  return Math.round(3000 + clamp01(random) * 5000);
}
export function climbDelay(random: number): number {
  return Math.round(25000 + clamp01(random) * 20000);
}
// How long it sits on a digit before coming down.
export function perchDuration(random: number): number {
  return Math.round(5000 + clamp01(random) * 6000);
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

export type Targets = {
  // Translation that brings the Tenant's left edge against the last digit's
  // right ink edge, overlapping a little so the shove reads as contact.
  pushX: number;
  // Per digit: the translation that stands the Tenant centred on top of that
  // digit's ink.
  perch: { x: number; y: number }[];
  // Where the Tenant rests: bottom on the digits' baseline, just right of the
  // last cell. In the block's coordinates.
  rest: { left: number; top: number };
};

export function tenantTargets(ink: Box[], lastCell: Box, size: number, gap: number, overlap = 0.14): Targets {
  const baseline = Math.max(...ink.map(box => box.bottom));
  const rest = { left: lastCell.right + gap, top: baseline - size };
  const restBox = { left: rest.left, top: rest.top, right: rest.left + size, bottom: baseline };
  const last = ink[ink.length - 1];
  return {
    pushX: round(last.right + overlap * size - restBox.left),
    perch: ink.map(box => ({
      x: round((box.left + box.right) / 2 - (restBox.left + restBox.right) / 2),
      y: round(box.top - restBox.bottom),
    })),
    rest: { left: round(rest.left), top: round(rest.top) },
  };
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}

function clamp01(value: number) {
  return Number.isFinite(value) ? Math.min(0.999999, Math.max(0, value)) : 0;
}
