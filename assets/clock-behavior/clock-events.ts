// Set pieces: the clock's choreographed moments, and when they are allowed.
//
// Each set piece is one class on `.clock-block` (`sp-<id>`) whose keyframes
// live in app/globals.css. Every keyframe set starts and ends at identity, so
// adding the class and removing it after `duration` is invisible at both ends.
// This module decides which piece may run, and when the next quiet moment is:
// a piece must never overlap the minute roll, because two animations fighting
// over the same digit is the one thing that reads as a glitch.

export type SetPieceId = 'domino' | 'zerog' | 'rubber' | 'cradle' | 'ink' | 'morph' | 'quake' | 'flap';

export type SetPiece = {
  id: SetPieceId;
  duration: number;
  // Only right after the hour changes, when the roll has already drawn the eye
  // and a briefly wrong or missing digit is forgivable.
  hourOnly: boolean;
  // Needs an outfit whose digit face is a variable font (Outfit.morph).
  needsMorph: boolean;
};

export const SET_PIECES: readonly SetPiece[] = [
  { id: 'domino', duration: 2600, hourOnly: false, needsMorph: false },
  { id: 'zerog', duration: 3400, hourOnly: false, needsMorph: false },
  { id: 'rubber', duration: 1900, hourOnly: false, needsMorph: false },
  { id: 'cradle', duration: 2200, hourOnly: false, needsMorph: false },
  { id: 'ink', duration: 2900, hourOnly: false, needsMorph: false },
  { id: 'morph', duration: 3200, hourOnly: false, needsMorph: true },
  { id: 'quake', duration: 3600, hourOnly: true, needsMorph: false },
  { id: 'flap', duration: 1900, hourOnly: true, needsMorph: false },
];

export function setPieceById(id: SetPieceId): SetPiece {
  return SET_PIECES.find(piece => piece.id === id) ?? SET_PIECES[0];
}

// One random piece every 5 to 15 minutes, plus one at the hour.
export const EVENT_GAP_MS = { min: 5 * 60 * 1000, max: 15 * 60 * 1000 };
// How long after the hour roll the hour piece starts: late enough that the
// roll has finished, soon enough to still feel caused by it.
export const HOUR_PIECE_DELAY_MS = 2600;
// Keep clear of the minute boundary on both sides: the roll itself takes
// about 0.8 s and the parent's one-second tick can deliver it up to a second
// late.
export const QUIET_MARGIN_MS = 2000;

export function nextEventDelay(random: number): number {
  return Math.round(EVENT_GAP_MS.min + clamp01(random) * (EVENT_GAP_MS.max - EVENT_GAP_MS.min));
}

export function eligibleSetPieces(outfitMorphs: boolean, atHour: boolean): SetPiece[] {
  return SET_PIECES.filter(piece => (atHour ? piece.hourOnly : !piece.hourOnly) && (!piece.needsMorph || outfitMorphs));
}

// Never the same piece twice in a row, unless it is the only one eligible.
export function pickSetPiece(outfitMorphs: boolean, atHour: boolean, random: number, last: SetPieceId | null): SetPiece | null {
  let pool = eligibleSetPieces(outfitMorphs, atHour);
  if (pool.length > 1) pool = pool.filter(piece => piece.id !== last);
  if (!pool.length) return null;
  return pool[Math.min(pool.length - 1, Math.floor(clamp01(random) * pool.length))];
}

// A moment is quiet when the whole piece fits inside the current minute with
// a margin at both ends.
export function fitsQuietWindow(now: Date, durationMs: number, marginMs = QUIET_MARGIN_MS): boolean {
  const into = now.getTime() % 60000;
  return into >= marginMs && 60000 - into >= durationMs + marginMs;
}

// Milliseconds to wait until a piece of this length fits. Zero when it fits
// now. A piece that can never fit in a minute waits for the margin only.
export function delayToQuiet(now: Date, durationMs: number, marginMs = QUIET_MARGIN_MS): number {
  if (fitsQuietWindow(now, durationMs, marginMs)) return 0;
  const into = now.getTime() % 60000;
  if (into < marginMs) return marginMs - into;
  return 60000 - into + marginMs;
}

// The split-flap piece flips every digit through three wrong numbers and lands
// on the right one. The wrong numbers are the next three in sequence, so the
// board reads as counting rather than as random noise.
export function flapSequence(text: string, steps = 3): string[] {
  const digits = [...text.replace(':', '')];
  const frames: string[] = [];
  for (let step = 1; step <= steps; step++) {
    frames.push(digits.map(digit => /\d/.test(digit) ? String((Number(digit) + step) % 10) : digit).join(''));
  }
  frames.push(digits.join(''));
  return frames;
}

function clamp01(value: number) {
  return Number.isFinite(value) ? Math.min(0.999999, Math.max(0, value)) : 0;
}
