'use client';

import { useEffect, useMemo, useState } from 'react';
import { DAILY_SOURCES, type ForecastDay } from '@/lib/daily-forecast';
import { debugFlags, pinnedNow } from '@/lib/debug-flags';
import { demoDailyPayload } from '@/lib/weather-demo';
import { restorableWeek, validStoredWeek, type StoredWeek } from '@/lib/stored-shapes';
import { ICONS } from './condition-icons';
import { readStored, writeStored } from './device-storage';
import { useProviderChain } from './use-provider-chain';

// Daily aggregates change with each model run, a few times a day. Hourly is
// already generous; anything faster spends Open-Meteo's quota on identical
// answers.
const REFRESH_MS = 60 * 60 * 1000;
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;

// The raw body is kept, not the parsed week: "today" is dropped at parse time
// and moves at Copenhagen midnight, so the same body is re-read against the
// clock. Stored with the name of the provider that answered, because only that
// provider's parser can read it, and when, because a week from before an
// outage is not restored (lib/stored-shapes.ts).
const STORAGE_KEY = 'home-dashboard:forecast-week:v2';

export default function WeekStrip({ now }: { now: Date | null }) {
  const [week, setWeek] = useState<StoredWeek | null>(null);

  useEffect(() => {
    // See components/weather-panel.tsx: `off` and `demo` fill the strip from a
    // placeholder body so a capture shows it in context, `none` leaves it
    // empty. The body is Open-Meteo-shaped so its own parser reads it.
    const flags = debugFlags(window.location.search);
    const mode = flags.weather;
    if (mode === 'none') return;
    if (mode !== 'live') {
      // Off the effect body, like the storage restore below, and built from the
      // pinned clock so the week starts on the day the digits show.
      const placeholder = window.setTimeout(() => {
        const at = pinnedNow(flags.time, new Date());
        setWeek({ source: 'Open-Meteo', payload: demoDailyPayload(at), updatedAt: at.getTime() });
      }, 0);
      return () => window.clearTimeout(placeholder);
    }
    const restore = window.setTimeout(() => {
      const saved = restorableWeek(readStored(STORAGE_KEY, validStoredWeek), Date.now());
      if (saved) setWeek(saved);
    }, 0);
    return () => window.clearTimeout(restore);
  }, []);

  // Every provider is asked every hour; none is penalised, since an hourly
  // refresh costs little and the week has fewer providers to fall back on.
  useProviderChain({
    tag: '[week]',
    sources: DAILY_SOURCES,
    refreshMs: REFRESH_MS,
    timeoutMs: REQUEST_TIMEOUT_MS,
    retryBaseMs: RETRY_BASE_MS,
    retryMaxMs: RETRY_MAX_MS,
    // Validation happens where "today" is known; an unusable body is a failed
    // attempt, and the last good week stays on screen. The body itself is
    // what is kept, so it can be re-read when the day changes.
    parse: (body, entry) => (entry.parse(body, new Date()) ? body : null),
    onAnswer: (payload, entry) => {
      const stored: StoredWeek = { source: entry.name, payload, updatedAt: Date.now() };
      setWeek(stored);
      writeStored(STORAGE_KEY, stored);
    },
  });

  // Re-parsed once an hour, so the first day falls off when "today" moves on.
  const dayStamp = now ? Math.floor(now.getTime() / 3600000) : null;
  const days = useMemo<ForecastDay[] | null>(() => {
    if (!week || dayStamp === null) return null;
    const entry = DAILY_SOURCES.find(candidate => candidate.name === week.source);
    return entry ? entry.parse(week.payload, new Date(dayStamp * 3600000)) : null;
  }, [week, dayStamp]);

  if (!days) return null;

  return <div className="week-strip" role="img"
    aria-label={'Next 7 days. ' + days.map(day => day.label + ' ' + day.kind.replace('-', ' ') + ', ' + Math.round(day.high) + ' to ' + Math.round(day.low) + ' degrees').join('. ')}>
    <div className="ribbon-heading" aria-hidden="true">
      <h2>Next 7 days</h2>
    </div>
    <ol className="week-days" aria-hidden="true">
      {days.map(day => {
        const Icon = ICONS[day.kind];
        return <li key={day.date} className={'week-day condition-' + day.kind}>
          <span className="week-name">{day.label}</span>
          <Icon strokeWidth={2.2} />
          <strong>{Math.round(day.high)}°</strong>
          <span className="week-low">{Math.round(day.low)}°</span>
        </li>;
      })}
    </ol>
  </div>;
}
