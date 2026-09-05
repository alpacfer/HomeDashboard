'use client';

import { useEffect, useMemo, useState } from 'react';
import { FORECAST_LATITUDE, FORECAST_LONGITUDE } from '@/lib/weather';
import { DAILY_SOURCES, type DailySourceName, type ForecastDay } from '@/lib/daily-forecast';
import { debugFlags, pinnedNow } from '@/lib/debug-flags';
import { demoDailyPayload } from '@/lib/weather-demo';
import { describeLockout } from '@/lib/open-meteo-quota';
import { ICONS } from './condition-icons';
import { readStored, writeStored } from './device-storage';
import { openMeteoLockout, recordOpenMeteoRefusal } from './open-meteo-lockout';

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
// provider's parser can read it.
const STORAGE_KEY = 'home-dashboard:forecast-week:v1';
type StoredWeek = { source: DailySourceName; payload: unknown };
function validStoredWeek(value: unknown): value is StoredWeek {
  const stored = value as StoredWeek | null;
  return !!stored && typeof stored === 'object' && DAILY_SOURCES.some(entry => entry.name === stored.source) && stored.payload !== undefined;
}

type Attempt = { payload: unknown } | { reason: string };

export default function WeekStrip({ now }: { now: Date | null }) {
  const [week, setWeek] = useState<StoredWeek | null>(null);

  useEffect(() => {
    // See components/weather-panel.tsx: `off` and `demo` fill the strip from a
    // placeholder body so a capture shows it in context, `none` leaves it
    // empty. The body is Open-Meteo-shaped so its own parser reads it.
    const flags = debugFlags(window.location.search);
    const mode = flags.weather;
    if (mode !== 'live') {
      if (mode === 'none') return;
      // Off the effect body, like the storage restore below, and built from the
      // pinned clock so the week starts on the day the digits show.
      const placeholder = window.setTimeout(() => setWeek({ source: 'Open-Meteo', payload: demoDailyPayload(pinnedNow(flags.time, new Date())) }), 0);
      return () => window.clearTimeout(placeholder);
    }
    let active = true;
    let pending = false;
    let failures = 0;
    let retry = 0;
    let inFlight: AbortController | null = null;

    const restore = window.setTimeout(() => {
      const saved = readStored(STORAGE_KEY, validStoredWeek);
      if (saved && active) setWeek(saved);
    }, 0);

    const attempt = async (entry: typeof DAILY_SOURCES[number]): Promise<Attempt> => {
      // Open-Meteo is not asked while it has said the quota is spent. The
      // lockout is shared with the weather card and the map, which pay from
      // the same per-address quota. See components/open-meteo-lockout.ts.
      if (entry.name === 'Open-Meteo') {
        const lockout = openMeteoLockout();
        if (lockout) return { reason: describeLockout(lockout) };
      }
      const controller = new AbortController();
      inFlight = controller;
      const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch(entry.url(FORECAST_LATITUDE, FORECAST_LONGITUDE), { cache: entry.cache, signal: controller.signal });
        if (!response.ok) {
          if (entry.name === 'Open-Meteo') recordOpenMeteoRefusal(response.status, await response.text());
          return { reason: 'HTTP ' + response.status };
        }
        const body: unknown = await response.json();
        // Validation happens where "today" is known; an unusable body is a
        // failed attempt, and the last good week stays on screen.
        return entry.parse(body, new Date()) ? { payload: body } : { reason: 'unusable payload' };
      } catch (error) {
        return { reason: controller.signal.aborted ? 'timeout' : error instanceof Error ? error.message : 'network error' };
      } finally {
        window.clearTimeout(timeout);
        if (inFlight === controller) inFlight = null;
      }
    };

    const load = async () => {
      if (pending || document.hidden) return;
      pending = true;
      window.clearTimeout(retry);
      try {
        const reasons: string[] = [];
        for (const entry of DAILY_SOURCES) {
          const result = await attempt(entry);
          if (!active) return;
          if ('reason' in result) {
            reasons.push(entry.name + ': ' + result.reason);
            continue;
          }
          failures = 0;
          const stored: StoredWeek = { source: entry.name, payload: result.payload };
          setWeek(stored);
          writeStored(STORAGE_KEY, stored);
          return;
        }
        if (!active) return;
        console.warn('[week] every provider failed: ' + reasons.join('; '));
        failures += 1;
        const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (failures - 1));
        retry = window.setTimeout(() => void load(), delay * (0.75 + Math.random() / 2));
      } finally {
        pending = false;
      }
    };

    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    const resume = () => { if (!document.hidden) void load(); };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    return () => {
      active = false;
      inFlight?.abort();
      window.clearTimeout(restore);
      window.clearTimeout(retry);
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
    };
  }, []);

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
