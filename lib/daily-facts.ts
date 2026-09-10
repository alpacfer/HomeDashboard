import { copenhagenDayKey } from './copenhagen';

export const DAILY_FACT_COUNT = 5;

// The category is an editorial promise about why the fact is worth reading,
// not a subject index. It picks the accent colour and the label above the
// headline, so the list is deliberately short.
export const DAILY_FACT_CATEGORIES = ['tech', 'space', 'curious', 'culture', 'science', 'sport', 'world'] as const;
export type DailyFactCategory = (typeof DAILY_FACT_CATEGORIES)[number];

export type DailyFact = {
  id: string;
  date: string;
  dateLabel: string;
  category: DailyFactCategory;
  categoryName: string;
  year: number;
  title: string;
  body: string;
  source: {
    name: string;
    url: string;
    calendarUrl: string;
    license: { name: string; url: string };
  };
  image: {
    src: string;
    alt: string;
    credit: string;
    source: string;
    license: string;
    licenseUrl: string;
  };
  // Optional animated artwork. `image` remains the still fallback for reduced
  // motion, a failed GIF, and browsers that decline to paint it. Keeping the
  // attribution here means the credit always describes what is actually on
  // screen rather than the fallback hidden behind it.
  animation?: {
    width: number;
    height: number;
    src: string;
    credit: string;
    source: string;
    license: string;
    licenseUrl: string;
  };
  // Optional, and rare: about one date in six offers a freely licensed clip.
  // `src` is Wikimedia's 240p VP9 transcode and `fallback` its 360p H.264 one,
  // because whether Silk decodes VP9 is not established — see docs/DAILY_FACTS.md.
  // `poster` is the still the panel shows until the first frame paints, and is
  // what it falls back to for good if the video will not play.
  video?: {
    /** The playing transcode's own pixel size, so the panel can shape itself
        to the clip before a frame has loaded rather than after. */
    width: number;
    height: number;
    src: string;
    fallback?: string;
    poster: string;
    seconds: number;
    credit: string;
    source: string;
    license: string;
    licenseUrl: string;
  };
};

export type DailyFactsFile = {
  date: string;
  dateLabel: string;
  facts: DailyFact[];
  /** Exact Copenhagen date for a one-day editorial edition. */
  editionDate?: string;
  /** Replaces "On this day" while this edition is active. */
  kicker?: string;
};

// The clock is passed in, never read here: the wall's `?time=` pin has to
// reach the fact key, and a test has to be able to stand at midnight. The
// key is the MM-DD tail of the wall's YYYY-MM-DD.
export function dailyDateKey(date: Date) {
  return copenhagenDayKey(date).slice(5);
}

// "19 years ago" is the whole point of an on-this-day panel: it turns a year
// into a distance. Anniversaries are counted against the Copenhagen year so
// the display never rolls over an hour early or late.
export function yearsAgo(year: number, now: Date) {
  const current = Number(copenhagenDayKey(now).slice(0, 4));
  if (!Number.isFinite(year) || year <= 0 || !Number.isFinite(current)) return '';
  const span = current - year;
  if (span <= 0) return '';
  if (span === 1) return '1 year ago';
  return `${span} years ago`;
}

// Debug mode. `/?date=04-23` holds the panel on one calendar date instead of
// today's, which is the only way to look at a fact that is not today's: the
// curated ones in data/daily-fact-overrides.json land on fourteen dates spread
// across the year. Anything unrecognised is ignored and the display shows the
// real date, so a mistyped URL can never leave the wall on the wrong day.
// See lib/debug-flags.ts and README.md.
export function pinnedDateKey(search: string) {
  const value = new URLSearchParams(search).get('date');
  if (!value) return null;
  const exact = /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (exact && !pinnedDayKey(search)) return null;
  const short = exact ? value.slice(5) : value;
  if (!/^\d{2}-\d{2}$/.test(short)) return null;
  const [month, day] = short.split('-').map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (day > new Date(Date.UTC(2024, month, 0)).getUTCDate()) return null;
  return short;
}

/** An exact debug date, used to inspect a one-day edition before it goes live. */
export function pinnedDayKey(search: string) {
  const value = new URLSearchParams(search).get('date');
  if (!validExactDate(value)) return null;
  return value;
}

function validExactDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function validDailyFactEditionIndex(value: unknown): value is { editions: string[] } {
  if (!value || typeof value !== 'object') return false;
  const editions = (value as { editions?: unknown }).editions;
  return Array.isArray(editions) && new Set(editions).size === editions.length && editions.every(validExactDate);
}

export type DailyFactsCandidate = { url: string; editionDate?: string };

/**
 * Static files to try for the requested day, in editorial order.
 *
 * A real day (or an exact YYYY-MM-DD debug pin) first gets a one-off edition;
 * a recurring MM-DD debug pin deliberately gets only the ordinary calendar.
 */
export function dailyFactsRequest(at: Date, search: string, editions: ReadonlySet<string> = new Set()): {
  identity: string;
  date: string;
  candidates: DailyFactsCandidate[];
} {
  const pinnedDate = pinnedDateKey(search);
  const pinnedDay = pinnedDayKey(search);
  const currentDay = copenhagenDayKey(at);
  const day = pinnedDay ?? currentDay;
  const date = pinnedDate ?? day.slice(5);
  const editionDate = pinnedDay ?? (pinnedDate ? null : currentDay);
  const candidates: DailyFactsCandidate[] = [];
  if (editionDate && editions.has(editionDate)) candidates.push({ url: `/facts/overrides/${editionDate}.json`, editionDate });
  candidates.push({ url: `/facts/daily/${date}.json` });
  return { identity: `${day}|${date}`, date, candidates };
}

function isCategory(value: unknown): value is DailyFactCategory {
  return typeof value === 'string' && (DAILY_FACT_CATEGORIES as readonly string[]).includes(value);
}

// A video is optional, so absent is valid and malformed is not. Anything the
// panel would hand to a <video> element has to be a real https URL before it
// gets there: a broken one on a display nobody reloads is a decoder retrying
// for weeks. A clip with no poster is refused too, because the poster is the
// only thing the panel can fall back to when playback fails.
function validVideo(value: unknown): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object') return false;
  const video = value as Partial<NonNullable<DailyFact['video']>>;
  if (video.fallback !== undefined && !video.fallback.startsWith?.('https://')) return false;
  return Boolean(
    video.src?.startsWith('https://') && video.poster?.startsWith('https://') &&
    typeof video.seconds === 'number' && Number.isFinite(video.seconds) && video.seconds > 0 &&
    typeof video.width === 'number' && Number.isInteger(video.width) && video.width > 0 &&
    typeof video.height === 'number' && Number.isInteger(video.height) && video.height > 0 &&
    typeof video.credit === 'string' && video.credit.length > 0 &&
    video.source?.startsWith('https://') && video.licenseUrl?.startsWith('https://') &&
    typeof video.license === 'string' && video.license.length > 0,
  );
}

function validAnimation(value: unknown): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object') return false;
  const animation = value as Partial<NonNullable<DailyFact['animation']>>;
  return Boolean(
    animation.src?.startsWith('https://') &&
    typeof animation.width === 'number' && Number.isInteger(animation.width) && animation.width > 0 &&
    typeof animation.height === 'number' && Number.isInteger(animation.height) && animation.height > 0 &&
    typeof animation.credit === 'string' && animation.credit.length > 0 &&
    animation.source?.startsWith('https://') && animation.licenseUrl?.startsWith('https://') &&
    typeof animation.license === 'string' && animation.license.length > 0,
  );
}

export function validDailyFacts(value: unknown, expectedDate: string, expectedEditionDate?: string): value is DailyFactsFile {
  if (!value || typeof value !== 'object') return false;
  const file = value as Partial<DailyFactsFile>;
  if (file.date !== expectedDate || !Array.isArray(file.facts) || file.facts.length !== DAILY_FACT_COUNT) return false;
  if (expectedEditionDate ? file.editionDate !== expectedEditionDate : file.editionDate !== undefined) return false;
  if (file.kicker !== undefined && (typeof file.kicker !== 'string' || file.kicker.length === 0 || file.kicker.length > 32)) return false;
  if (new Set(file.facts.map(fact => fact?.id)).size !== DAILY_FACT_COUNT) return false;
  return file.facts.every(fact =>
    fact && fact.date === expectedDate && isCategory(fact.category) && typeof fact.categoryName === 'string' &&
    Number.isInteger(fact.year) && fact.year > 0 &&
    typeof fact.title === 'string' && fact.title.length > 0 && typeof fact.body === 'string' && fact.body.length > 0 &&
    fact.source?.url?.startsWith('https://') && fact.image?.src?.startsWith('https://') &&
    fact.image?.source?.startsWith('https://') && fact.image?.licenseUrl?.startsWith('https://') &&
    validAnimation(fact.animation) && validVideo(fact.video),
  );
}

// Which of the three layouts a clip gets. A picture is always cropped to 4:3
// because a still can be cropped without losing the moment, but a clip cannot:
// the widest one in the calendar is 1.99:1, and forcing that into 4:3 threw
// away a third of the frame — the Mars horizon panorama lost the horizon.
//
// Three bands rather than a continuous ratio, because the panel is a two
// column grid and the column widths are what actually change. Everything from
// academy ratio to 3:2 keeps the layout the calendar was built around; 16:9
// and wider earns a bigger share of the row; anything taller than it is wide
// gets the narrow column and gives the words the space instead.
export type MediaShape = 'wide' | 'boxy' | 'tall';
const WIDE_AT = 1.5;
const TALL_AT = 0.95;
export function mediaShape(width: number, height: number): MediaShape {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 'boxy';
  const ratio = width / height;
  if (ratio >= WIDE_AT) return 'wide';
  if (ratio < TALL_AT) return 'tall';
  return 'boxy';
}
