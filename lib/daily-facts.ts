export const DAILY_FACT_COUNTRIES = 3;

export type DailyFactCountry = 'spain' | 'denmark' | 'greece';
export type DailyFact = {
  id: string;
  date: string;
  dateLabel: string;
  country: DailyFactCountry;
  countryName: string;
  kind: 'events' | 'births' | 'daylight';
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
  month: '2-digit',
  day: '2-digit',
});

export function dailyDateKey(date = new Date()) {
  const parts = Object.fromEntries(dateParts.formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.month}-${parts.day}`;
}

export function validDailyFacts(value: unknown, expectedDate: string): value is DailyFactsFile {
  if (!value || typeof value !== 'object') return false;
  const file = value as Partial<DailyFactsFile>;
  if (file.date !== expectedDate || !Array.isArray(file.facts) || file.facts.length !== DAILY_FACT_COUNTRIES) return false;
  const countries = new Set(file.facts.map(fact => fact?.country));
  if (!['spain', 'denmark', 'greece'].every(country => countries.has(country as DailyFactCountry))) return false;
  return file.facts.every(fact =>
    fact && fact.date === expectedDate && typeof fact.title === 'string' && typeof fact.body === 'string' &&
    fact.source?.url?.startsWith('https://') && fact.image?.src?.startsWith('https://') &&
    fact.image?.source?.startsWith('https://') && fact.image?.licenseUrl?.startsWith('https://'),
  );
}
