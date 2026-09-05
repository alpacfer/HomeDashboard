// The clock's wardrobe: which typeface, colour and date format it wears, and
// how the next outfit is chosen.
//
// An outfit is one class on `.clock-block` (`o-<id>`) that sets custom
// properties in app/globals.css: digit face, digit scale so the glyphs fill the
// fixed grid cells, date face, case and size, and the colours. The date format
// belongs to the outfit too, so a terminal outfit shows an ISO date and an
// editorial one a spelt-out weekday with a comma.
//
// The pick is random but weighted by context the display already has: the hour
// and weekday from the clock, the temperature and whether the current hour is
// wet from the weather panel. Holidays win outright. Nothing here touches the
// DOM; the component only asks "what next" and "what does the date say".

export type OutfitId =
  | 'grotesk' | 'editorial' | 'poster' | 'casual' | 'fashion' | 'doodle'
  | 'neon' | 'terminal' | 'arcade' | 'crt' | 'dotmatrix'
  | 'wonky' | 'shade' | 'stencil'
  | 'wet' | 'burned' | 'halloween' | 'christmas';

export type DateStyle = 'caps' | 'editorial' | 'iso' | 'short' | 'mid';

export type Outfit = {
  id: OutfitId;
  date: DateStyle;
  // True when the digit face is a variable font with an axis worth animating,
  // which is what the "morph" set piece needs. See lib/clock-events.ts.
  morph: boolean;
  // Families the outfit draws with, so they can be loaded before the crossfade
  // starts. A face that swaps in halfway through the dress is the abrupt change
  // the whole system exists to avoid.
  fonts: string[];
};

// Every face here fits the .62em digit cells at the scale its `.o-<id>` rule
// sets. Rubik Glitch was dropped: its displaced slices reach 0.59em either
// side of a digit's centre, so it could only fit at half the size of the
// other faces, and clipped at any size that read from across a room.
export const OUTFITS: readonly Outfit[] = [
  { id: 'grotesk', date: 'caps', morph: true, fonts: ['Clock Grotesk'] },
  { id: 'editorial', date: 'editorial', morph: true, fonts: ['Fraunces'] },
  { id: 'poster', date: 'caps', morph: false, fonts: ['Anton', 'Bebas Neue'] },
  { id: 'casual', date: 'editorial', morph: true, fonts: ['Recursive'] },
  { id: 'fashion', date: 'editorial', morph: true, fonts: ['Bodoni Moda'] },
  { id: 'doodle', date: 'editorial', morph: false, fonts: ['Rubik Doodle Shadow', 'Cabin Sketch'] },
  { id: 'neon', date: 'mid', morph: true, fonts: ['Monoton', 'Tilt Neon'] },
  { id: 'terminal', date: 'iso', morph: false, fonts: ['Space Mono'] },
  { id: 'arcade', date: 'short', morph: false, fonts: ['Press Start 2P'] },
  { id: 'crt', date: 'iso', morph: true, fonts: ['Sixtyfour'] },
  { id: 'dotmatrix', date: 'short', morph: true, fonts: ['Handjet'] },
  { id: 'wonky', date: 'mid', morph: true, fonts: ['Kablammo'] },
  { id: 'shade', date: 'caps', morph: false, fonts: ['Bungee Shade', 'Bungee'] },
  { id: 'stencil', date: 'caps', morph: false, fonts: ['Black Ops One'] },
  { id: 'wet', date: 'mid', morph: false, fonts: ['Rubik Wet Paint'] },
  { id: 'burned', date: 'mid', morph: false, fonts: ['Rubik Burned'] },
  { id: 'halloween', date: 'mid', morph: false, fonts: ['Creepster'] },
  { id: 'christmas', date: 'editorial', morph: false, fonts: ['Mountains of Christmas'] },
];

export const DEFAULT_OUTFIT: OutfitId = 'grotesk';

export function outfitById(id: OutfitId): Outfit {
  return OUTFITS.find(outfit => outfit.id === id) ?? OUTFITS[0];
}

// One change every 20 to 40 minutes. Rare enough that the clock is a clock
// first, frequent enough that a glance across a day sees several.
export const OUTFIT_GAP_MS = { min: 20 * 60 * 1000, max: 40 * 60 * 1000 };
// The crossfade between two outfits. The component keeps the old outfit on
// screen as a fading ghost for exactly this long.
export const DRESS_MS = 1000;

export function nextOutfitDelay(random: number): number {
  return Math.round(OUTFIT_GAP_MS.min + clamp01(random) * (OUTFIT_GAP_MS.max - OUTFIT_GAP_MS.min));
}

export type Conditions = { temperature: number | null; wet: boolean };

export type WardrobeContext = {
  hour: number;      // Copenhagen hour, 0-23
  weekday: number;   // 0 = Sunday ... 6 = Saturday
  month: number;     // 1-12
  day: number;       // 1-31
  temperature: number | null;
  wet: boolean;
};

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Copenhagen', hour: 'numeric', hourCycle: 'h23', weekday: 'short', month: 'numeric', day: 'numeric',
});
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function wardrobeContext(now: Date, conditions: Conditions | null): WardrobeContext {
  const parts = Object.fromEntries(partsFormatter.formatToParts(now).map(part => [part.type, part.value]));
  return {
    hour: Number(parts.hour) % 24,
    weekday: Math.max(0, WEEKDAYS.indexOf(parts.weekday)),
    month: Number(parts.month),
    day: Number(parts.day),
    temperature: conditions?.temperature ?? null,
    wet: conditions?.wet ?? false,
  };
}

export function isHoliday(context: Pick<WardrobeContext, 'month' | 'day'>): OutfitId | null {
  if (context.month === 10 && context.day === 31) return 'halloween';
  if (context.month === 12 && context.day >= 24 && context.day <= 26) return 'christmas';
  return null;
}

// The weight table from the proposal. Time of day sets the base, the weather
// adds to it, a holiday replaces it. Anything with weight 0 cannot be picked.
export function outfitWeights(context: WardrobeContext): Partial<Record<OutfitId, number>> {
  const holiday = isHoliday(context);
  if (holiday) return { [holiday]: 1 };

  const weights: Partial<Record<OutfitId, number>> = {};
  const add = (id: OutfitId, weight: number) => { weights[id] = (weights[id] ?? 0) + weight; };
  const weekend = context.weekday === 0 || context.weekday === 6;
  const night = context.hour >= 23 || context.hour < 6;

  if (night) {
    add('terminal', 3); add('crt', 1); add('arcade', 1); add('dotmatrix', 1);
  } else if (weekend && context.hour < 12) {
    add('editorial', 3); add('fashion', 2); add('grotesk', 1); add('casual', 1);
  } else if ((context.weekday === 5 || context.weekday === 6) && context.hour >= 18) {
    add('neon', 3); add('wonky', 1); add('shade', 1); add('grotesk', 1);
  } else {
    add('grotesk', 3); add('poster', 1); add('casual', 1); add('doodle', 1); add('stencil', 1); add('editorial', 1);
  }

  if (context.wet) add('wet', 4);
  if (context.temperature !== null && context.temperature > 25) { add('burned', 4); add('neon', 1); }
  if (context.temperature !== null && context.temperature < 0) { add('crt', 1); add('dotmatrix', 1); add('fashion', 1); }
  return weights;
}

// Weighted pick that never returns the outfit already worn unless it is the
// only one allowed (a holiday). `random` is in [0, 1).
export function pickOutfit(context: WardrobeContext, random: number, current: OutfitId | null): OutfitId {
  const weights = outfitWeights(context);
  let entries = Object.entries(weights).filter(([, weight]) => weight! > 0) as [OutfitId, number][];
  if (entries.length > 1) entries = entries.filter(([id]) => id !== current);
  if (!entries.length) return current ?? DEFAULT_OUTFIT;
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let cursor = clamp01(random) * total;
  for (const [id, weight] of entries) {
    cursor -= weight;
    if (cursor < 0) return id;
  }
  return entries[entries.length - 1][0];
}

// Date formats. The long ones stay en-GB like the rest of the display; the
// short ones use en-US so September abbreviates to "Sep", not "Sept".
const long = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Copenhagen', weekday: 'long', day: 'numeric', month: 'long' });
const iso = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' });
const short2 = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Copenhagen', weekday: 'short', day: '2-digit', month: 'short' });
const short1 = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Copenhagen', weekday: 'short', day: 'numeric', month: 'short' });

const pick = (formatter: Intl.DateTimeFormat, now: Date) =>
  Object.fromEntries(formatter.formatToParts(now).map(part => [part.type, part.value]));

export type OutfitDate = { label: string; dateTime?: string };

export function outfitDate(id: OutfitId, now: Date | null): OutfitDate {
  if (!now) return { label: '—' };
  const dateTime = (() => { const p = pick(iso, now); return `${p.year}-${p.month}-${p.day}`; })();
  switch (outfitById(id).date) {
    case 'editorial': { const p = pick(long, now); return { label: `${p.weekday}, ${p.day} ${p.month}`, dateTime }; }
    case 'iso': { const p = pick(iso, now); return { label: `${p.year}-${p.month}-${p.day} ${p.weekday}`, dateTime }; }
    case 'short': { const p = pick(short2, now); return { label: `${p.weekday} ${p.day} ${p.month}`, dateTime }; }
    case 'mid': { const p = pick(short1, now); return { label: `${p.weekday} ${p.day} ${p.month}`, dateTime }; }
    default: { const p = pick(long, now); return { label: `${p.weekday} ${p.day} ${p.month}`, dateTime }; }
  }
}

function clamp01(value: number) {
  return Number.isFinite(value) ? Math.min(0.999999, Math.max(0, value)) : 0;
}
