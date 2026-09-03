'use client';

import { useEffect, useMemo, useState } from 'react';
import { FORECAST_LATITUDE, FORECAST_LONGITUDE } from '@/lib/weather';
import { openMeteoDailyUrl, parseDailyForecast, type ForecastDay } from '@/lib/daily-forecast';
import { ICONS } from './condition-icons';

// Daily aggregates change with each model run, a few times a day. Hourly is
// already generous; anything faster spends Open-Meteo's quota on identical
// answers.
const REFRESH_MS = 60 * 60 * 1000;
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 10 * 60 * 1000;

export default function WeekStrip({ now }: { now: Date | null }) {
  const [payload, setPayload] = useState<unknown>(null);

  useEffect(() => {
    let active = true;
    let pending = false;
    let failures = 0;
    let retry = 0;
    let inFlight: AbortController | null = null;

    const load = async () => {
      if (pending || document.hidden) return;
      pending = true;
      window.clearTimeout(retry);
      const controller = new AbortController();
      inFlight = controller;
      const timeout = window.setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch(openMeteoDailyUrl(FORECAST_LATITUDE, FORECAST_LONGITUDE), { signal: controller.signal });
        if (!response.ok) throw new Error(String(response.status));
        const body: unknown = await response.json();
        if (!active) return;
        // Validation happens where "today" is known, so the raw body is kept
        // and parsed against the clock; a failure keeps the last good week.
        if (!parseDailyForecast(body, new Date())) throw new Error('unusable');
        failures = 0;
        setPayload(body);
      } catch {
        if (!active) return;
        failures += 1;
        const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (failures - 1));
        retry = window.setTimeout(() => void load(), delay * (0.75 + Math.random() / 2));
      } finally {
        window.clearTimeout(timeout);
        if (inFlight === controller) inFlight = null;
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
      window.clearTimeout(retry);
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
    };
  }, []);

  // Re-parsed once a day, when "today" moves on and the first day falls off.
  const dayStamp = now ? Math.floor(now.getTime() / 3600000) : null;
  const week = useMemo<ForecastDay[] | null>(
    () => payload && dayStamp !== null ? parseDailyForecast(payload, new Date(dayStamp * 3600000)) : null,
    [payload, dayStamp],
  );

  if (!week) return null;

  return <div className="week-strip" role="img"
    aria-label={'Next 7 days. ' + week.map(day => day.label + ' ' + day.kind.replace('-', ' ') + ', ' + Math.round(day.high) + ' to ' + Math.round(day.low) + ' degrees').join('. ')}>
    <div className="ribbon-heading" aria-hidden="true">
      <h2>Next 7 days</h2>
    </div>
    <ol className="week-days" aria-hidden="true">
      {week.map(day => {
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
