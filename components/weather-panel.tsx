'use client';

import { useEffect, useMemo, useState } from 'react';
import { CloudOff } from 'lucide-react';
import { describeHour, FORECAST_LATITUDE, FORECAST_LONGITUDE, isDaylight, reviveWeatherHours, validWeatherHours, type WeatherHour } from '@/lib/weather';
import { SOURCES, type SourceName } from '@/lib/forecast-sources';
import { buildRibbon, rainHeadline, temperatureTrack } from '@/lib/forecast-summary';
import { debugFlags } from '@/lib/debug-flags';
import { describeLockout } from '@/lib/open-meteo-quota';
import type { Conditions } from '@/lib/clock-conditions';
import { ICONS, NIGHT_ICONS } from './condition-icons';
import { readStored, writeStored } from './device-storage';
import { openMeteoLockout, recordOpenMeteoRefusal } from './open-meteo-lockout';

const REFRESH_MS = 15 * 60 * 1000;
// Older than this, the forecast is drawn muted: it is still the best answer
// there is, but the viewer should know it is not current.
const STALE_MS = 45 * 60 * 1000;
// Back off on failure, keep the last good run on screen, and never spin: the
// display is unattended for weeks and must survive an outage of any length
// without help.
const RETRY_BASE_MS = 20_000;
const RETRY_MAX_MS = 5 * 60 * 1000;
// DMI is asked first every refresh, but not once a minute during a multi-day
// outage: after it fails, the fallback leads for an hour before DMI is tried
// again. That keeps DMI the first opinion without spending a request on a
// provider that just refused one.
const SOURCE_PENALTY_MS = 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;

// The last good forecast, so a reload shows it at once and its age decides the
// styling rather than the reload pretending nothing is known.
const STORAGE_KEY = 'home-dashboard:forecast-hours:v1';
type StoredForecast = { hours: WeatherHour[]; source: SourceName; updatedAt: number };
function validStoredForecast(value: unknown): value is StoredForecast {
  const stored = value as StoredForecast | null;
  return !!stored && typeof stored === 'object' && validWeatherHours(stored.hours)
    && SOURCES.some(entry => entry.name === stored.source) && Number.isFinite(stored.updatedAt);
}

const timeFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Copenhagen', hour: '2-digit', minute: '2-digit', hour12: false });

// A refusal may say when asking again becomes worthwhile; the provider is
// penalised until then rather than for the standard hour.
type Attempt = { hours: WeatherHour[] } | { reason: string; until?: number };

export default function WeatherPanel({ now, onConditions }: { now: Date | null; onConditions?: (conditions: Conditions) => void }) {
  const [hours, setHours] = useState<WeatherHour[] | null>(null);
  const [source, setSource] = useState<SourceName | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // Debug: `?weather=off` makes no request at all. See lib/debug-flags.ts.
    if (debugFlags(window.location.search).weather !== 'live') return;
    let active = true;
    let pending = false;
    let failures = 0;
    let retry = 0;
    // One controller per request, never one shared across them. An AbortSignal
    // is permanently aborted once it fires, so a single request that outran the
    // timeout would poison every later fetch on a display that never reloads.
    let inFlight: AbortController | null = null;

    // Each provider is tried in preference order until one answers with a
    // forecast that parses. A provider that fails is skipped for a while so a
    // long outage upstream does not cost a request every refresh.
    const penalised = new Map<SourceName, number>();

    const restore = window.setTimeout(() => {
      const saved = readStored(STORAGE_KEY, validStoredForecast);
      if (!saved || !active) return;
      setHours(reviveWeatherHours(saved.hours));
      setSource(saved.source);
      setUpdatedAt(saved.updatedAt);
    }, 0);

    const attempt = async (entry: typeof SOURCES[number]): Promise<Attempt> => {
      // Open-Meteo is not asked while it has said the quota is spent: the
      // answer would be the same 429, and the quota is shared with the week
      // strip and the map, which recorded or will read the same lockout.
      if (entry.name === 'Open-Meteo') {
        const lockout = openMeteoLockout();
        if (lockout) return { reason: describeLockout(lockout), until: lockout.until };
      }
      const controller = new AbortController();
      inFlight = controller;
      const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch(entry.url(FORECAST_LATITUDE, FORECAST_LONGITUDE), { cache: entry.cache, signal: controller.signal });
        if (!response.ok) {
          const lockout = entry.name === 'Open-Meteo' ? recordOpenMeteoRefusal(response.status, await response.text()) : null;
          return { reason: 'HTTP ' + response.status + (lockout ? ', ' + describeLockout(lockout) : ''), until: lockout?.until };
        }
        const parsed = entry.parse(await response.json());
        return parsed?.length ? { hours: parsed } : { reason: 'unusable payload' };
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
        const now = Date.now();
        const ready = SOURCES.filter(entry => (penalised.get(entry.name) ?? 0) <= now);
        // If every provider is still penalised, try them all rather than skip
        // the refresh: a stale penalty must never outrank having no forecast.
        const reasons: string[] = [];
        for (const entry of ready.length ? ready : SOURCES) {
          const result = await attempt(entry);
          if (!active) return;
          if ('reason' in result) {
            reasons.push(entry.name + ': ' + result.reason);
            penalised.set(entry.name, result.until ?? Date.now() + SOURCE_PENALTY_MS);
            continue;
          }
          penalised.delete(entry.name);
          failures = 0;
          const updated = Date.now();
          setHours(result.hours);
          setSource(entry.name);
          setUpdatedAt(updated);
          setFailed(false);
          writeStored(STORAGE_KEY, { hours: result.hours, source: entry.name, updatedAt: updated } satisfies StoredForecast);
          return;
        }
        if (!active) return;
        // The one line that explains a muted card when the display is
        // inspected over remote debugging or by scripts/screenshot.mjs.
        console.warn('[weather] every provider failed: ' + reasons.join('; '));
        setFailed(true);
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
    const key = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.closest?.('a')) return;
      if (event.key === 'Enter' || event.key === 'r' || event.key === 'R') void load();
    };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    window.addEventListener('keydown', key);
    return () => {
      active = false;
      inFlight?.abort();
      window.clearTimeout(restore);
      window.clearTimeout(retry);
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
      window.removeEventListener('keydown', key);
    };
  }, []);

  // The ribbon only moves on the hour, so it is rebuilt on the hour rather than
  // on every clock tick from the parent.
  const hourStamp = now ? Math.floor(now.getTime() / 3600000) : null;
  const view = useMemo(() => {
    if (!hours || hourStamp === null) return null;
    const at = new Date(hourStamp * 3600000);
    const ribbon = buildRibbon(hours, at);
    if (!ribbon.length) return null;
    return { ribbon, track: temperatureTrack(ribbon), headline: rainHeadline(ribbon, at), current: hours.find(hour => hour.timestamp === ribbon[0].timestamp) ?? null };
  }, [hours, hourStamp]);

  const current = view?.current ? describeHour(view.current) : null;

  // Report the current hour to the clock once per change, not once per tick.
  const reportedTemperature = view?.current?.temperature ?? null;
  const reportedWet = current?.wet ?? false;
  useEffect(() => {
    onConditions?.({ temperature: reportedTemperature, wet: reportedWet });
  }, [onConditions, reportedTemperature, reportedWet]);
  const daylight = view ? isDaylight(view.ribbon[0].timestamp + 1800000) : true;
  const Icon = current ? (daylight ? ICONS[current.kind] : NIGHT_ICONS[current.kind] ?? ICONS[current.kind]) : CloudOff;
  // Two separate facts. `stale` is about the data: older than STALE_MS, so the
  // card is drawn muted. `offline` is about the connection: the last refresh
  // failed, or there is nothing at all, so the dot appears. A refresh that
  // fails while the data is twenty minutes old shows the dot and nothing else;
  // the forecast on screen is still current and must not look broken.
  const age = now && updatedAt ? now.getTime() - updatedAt : null;
  const stale = age === null ? !hours : age > STALE_MS;
  const offline = failed || stale;
  const offlineDescription = offline
    ? (updatedAt ? 'Last updated at ' + timeFormat.format(new Date(updatedAt)) + '. Press OK to retry.' : 'Forecast unavailable. Press OK to retry.')
    : '';
  const temperature = view?.current ? Math.round(view.current.temperature) : null;
  // The credit has to name the provider that actually answered, not the one we
  // asked first.
  const credit = (SOURCES.find(entry => entry.name === source) ?? SOURCES[0]).attribution;

  return <section className={'weather-band' + (stale ? ' stale' : '')} aria-label={'Weather. ' + offlineDescription}>
    <div className={'weather' + (current ? ' condition-' + current.kind : '') + (daylight ? '' : ' night') + (view?.headline?.wet ? ' raining-now' : '')}
      aria-label={current && temperature !== null ? temperature + ' degrees Celsius, ' + current.label : 'Weather unavailable'}>
      <a className="weather-icon" href={credit.href} target="_blank" rel="noreferrer"
        aria-label={(current?.label ?? 'Weather unavailable') + '. ' + credit.credit}>
        <Icon strokeWidth={2.3} aria-hidden="true" />
      </a>
      <p className="temperature" aria-hidden="true">{temperature ?? '—'}<span>°</span>{current && <small>{current.label}</small>}</p>
      <strong className="weather-headline" role={view ? undefined : 'status'}>{view?.headline?.text ?? (offline ? 'Forecast unavailable' : '···')}</strong>
      {offline && <span className="offline-dot" role="status" aria-label={offlineDescription} />}
    </div>

    {view && view.track ? <div className="rain-ribbon" role="img"
      aria-label={'Next ' + view.ribbon.length + ' hours. ' + (view.headline?.text ?? '') + '. Temperature between '
        + Math.round(view.track.low) + ' and ' + Math.round(view.track.high) + ' degrees. '
        + view.ribbon.filter(entry => entry.band !== 'dry')
          .map(entry => String(entry.hour).padStart(2, '0') + ':00 ' + entry.kind.replace('-', ' ') + ' ' + entry.millimetres.toFixed(1) + ' millimetres')
          .join(', ')}>
      <div className="ribbon-heading" aria-hidden="true">
        <h2>Next {view.ribbon.length} hours</h2>
        <span>{Math.round(view.track.high)}° / {Math.round(view.track.low)}°</span>
      </div>
      <div className="temperature-track" aria-hidden="true">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none">
          <polyline points={view.track.points} />
        </svg>
        <div className="track-marks" style={{ '--columns': view.ribbon.length } as React.CSSProperties}>
          {view.track.marks.map(mark => <span key={mark.timestamp}
            style={{ gridColumn: mark.index + 1, '--y': mark.y } as React.CSSProperties}>{mark.degrees}°</span>)}
        </div>
      </div>
      <div className="ribbon-bars" aria-hidden="true" style={{ '--columns': view.ribbon.length } as React.CSSProperties}>
        {view.ribbon.map(entry => <div key={entry.timestamp}
          className={'ribbon-bar band-' + entry.band + (entry.midnight ? ' day-break' : '') + (entry.kind === 'snow' || entry.kind === 'sleet' ? ' frozen' : '')}>
          <span style={{ height: (entry.height * 100).toFixed(1) + '%' }} />
        </div>)}
      </div>
      <div className="ribbon-ticks" aria-hidden="true" style={{ '--columns': view.ribbon.length } as React.CSSProperties}>
        {view.ribbon.map(entry => <span key={entry.timestamp} className={entry.midnight ? 'day-break' : undefined}>{entry.label}</span>)}
      </div>
    </div> : null}

    {/* Google's policy asks for its credit on or beside the data, not only in
        the label on the icon, so the provider that answered is named in print.
        Only once something has answered: crediting a provider for a card that
        is still empty would name the wrong one. */}
    {source && <small className="weather-credit" aria-hidden="true">{credit.credit}</small>}
  </section>;
}
