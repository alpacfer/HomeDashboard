// The shapes the display keeps in device storage between reloads, and the
// validators that decide whether what is there can be trusted.
//
// Storage is an input like a provider: an earlier build may have written a
// different shape, a TV browser may have truncated it, and the one thing a
// reload must never do is crash on what it finds. Every read goes through
// components/device-storage.ts with one of these, and a shape that does not
// match is discarded rather than repaired. The validators used to sit beside
// their components, where nothing could test them; the composite ones are
// here now, next to the tests in tests/stored-shapes.test.mjs.

import { validWeatherHours, type WeatherHour } from './weather';
import { SOURCES, type SourceName } from './forecast-sources';
import { DAILY_SOURCES, type DailySourceName } from './daily-forecast';

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object';

// The weather card's last good answer. Its age decides whether the card is
// drawn muted, so a record without one is useless.
export type StoredForecast = { hours: WeatherHour[]; source: SourceName; updatedAt: number };

export function validStoredForecast(value: unknown): value is StoredForecast {
  return isRecord(value) && validWeatherHours(value.hours)
    && SOURCES.some(entry => entry.name === value.source) && Number.isFinite(value.updatedAt);
}

// The week strip's last good answer: the raw body, because "today" is dropped
// at parse time and moves at midnight, so the same body is re-read against the
// clock; and the provider's name, because only its parser can read it.
export type StoredWeek = { source: DailySourceName; payload: unknown; updatedAt: number };

// A week older than this is not restored. The strip has no muted state, so a
// two-day-old week drawn after an outage would read as current; a fresh fetch
// follows at once in any case, so what is lost is only the head start.
export const WEEK_RESTORE_MS = 24 * 60 * 60_000;

export function validStoredWeek(value: unknown): value is StoredWeek {
  return isRecord(value) && DAILY_SOURCES.some(entry => entry.name === value.source)
    && value.payload !== undefined && Number.isFinite(value.updatedAt);
}

export function restorableWeek(stored: StoredWeek | null, now: number): StoredWeek | null {
  return stored && now - stored.updatedAt <= WEEK_RESTORE_MS ? stored : null;
}

// Where the daily-fact rotation had got to, so a reload mid-morning does not
// start the day's five again from the first. Only good for the day it names.
export type StoredFactCursor = { date: string; index: number };

export function validStoredFactCursor(value: unknown): value is StoredFactCursor {
  return isRecord(value) && typeof value.date === 'string' && /^\d{2}-\d{2}$/.test(value.date)
    && Number.isInteger(value.index) && (value.index as number) >= 0;
}

// The index to resume at: the stored one when it is today's and in range, and
// the first fact otherwise.
export function resumeFactIndex(cursor: StoredFactCursor | null, date: string, count: number): number {
  return cursor && cursor.date === date && cursor.index < count ? cursor.index : 0;
}
