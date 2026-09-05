export const DAILY_FACT_COUNT = 3;

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
};

export type DailyFactsFile = { date: string; dateLabel: string; facts: DailyFact[] };

const dateParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Copenhagen',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function copenhagenParts(date: Date) {
  return Object.fromEntries(dateParts.formatToParts(date).map(part => [part.type, part.value]));
}

export function dailyDateKey(date = new Date()) {
  const parts = copenhagenParts(date);
  return `${parts.month}-${parts.day}`;
}

// "19 years ago" is the whole point of an on-this-day panel: it turns a year
// into a distance. Anniversaries are counted against the Copenhagen year so
// the display never rolls over an hour early or late.
export function yearsAgo(year: number, now = new Date()) {
  const current = Number(copenhagenParts(now).year);
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
  if (!value || !/^\d{2}-\d{2}$/.test(value)) return null;
  const [month, day] = value.split('-').map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (day > new Date(Date.UTC(2024, month, 0)).getUTCDate()) return null;
  return value;
}

function isCategory(value: unknown): value is DailyFactCategory {
  return typeof value === 'string' && (DAILY_FACT_CATEGORIES as readonly string[]).includes(value);
}

export function validDailyFacts(value: unknown, expectedDate: string): value is DailyFactsFile {
  if (!value || typeof value !== 'object') return false;
  const file = value as Partial<DailyFactsFile>;
  if (file.date !== expectedDate || !Array.isArray(file.facts) || file.facts.length !== DAILY_FACT_COUNT) return false;
  if (new Set(file.facts.map(fact => fact?.id)).size !== DAILY_FACT_COUNT) return false;
  return file.facts.every(fact =>
    fact && fact.date === expectedDate && isCategory(fact.category) && typeof fact.categoryName === 'string' &&
    Number.isInteger(fact.year) && fact.year > 0 &&
    typeof fact.title === 'string' && fact.title.length > 0 && typeof fact.body === 'string' && fact.body.length > 0 &&
    fact.source?.url?.startsWith('https://') && fact.image?.src?.startsWith('https://') &&
    fact.image?.source?.startsWith('https://') && fact.image?.licenseUrl?.startsWith('https://'),
  );
}
