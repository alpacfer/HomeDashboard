'use client';

import { useEffect, useMemo, useState } from 'react';
import { Cloud, CloudDrizzle, CloudFog, CloudMoon, CloudOff, CloudRain, CloudRainWind, CloudSnow, CloudSun, Cloudy, Moon, Sun } from 'lucide-react';
import { describeHour, FORECAST_LATITUDE, FORECAST_LONGITUDE, isDaylight, type ConditionKind, type WeatherHour } from '@/lib/weather';
import { SOURCES, type SourceName } from '@/lib/forecast-sources';
import { buildRibbon, rainHeadline, temperatureTrack } from '@/lib/forecast-summary';

const REFRESH_MS = 15 * 60 * 1000;
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

const ICONS: Record<ConditionKind, typeof Sun> = {
  clear: Sun, partly: CloudSun, cloudy: Cloudy, overcast: Cloud, fog: CloudFog,
  drizzle: CloudDrizzle, rain: CloudRain, 'heavy-rain': CloudRainWind, sleet: CloudSnow, snow: CloudSnow,
};
const NIGHT_ICONS: Partial<Record<ConditionKind, typeof Sun>> = { clear: Moon, partly: CloudMoon };

const timeFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Copenhagen', hour: '2-digit', minute: '2-digit', hour12: false });

export default function WeatherPanel({ now }: { now: Date | null }) {
  const [hours, setHours] = useState<WeatherHour[] | null>(null);
  const [source, setSource] = useState<SourceName | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
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

    const attempt = async (entry: typeof SOURCES[number]) => {
      const controller = new AbortController();
      inFlight = controller;
      const timeout = window.setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch(entry.url(FORECAST_LATITUDE, FORECAST_LONGITUDE), { cache: 'no-store', signal: controller.signal });
        if (!response.ok) return null;
        const parsed = entry.parse(await response.json());
        return parsed?.length ? parsed : null;
      } catch {
        return null;
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
        for (const entry of ready.length ? ready : SOURCES) {
          const parsed = await attempt(entry);
          if (!active) return;
          if (!parsed) {
            penalised.set(entry.name, Date.now() + SOURCE_PENALTY_MS);
            continue;
          }
          penalised.delete(entry.name);
          failures = 0;
          setHours(parsed);
          setSource(entry.name);
          setUpdatedAt(Date.now());
          setFailed(false);
          return;
        }
        if (!active) return;
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
  const daylight = view ? isDaylight(view.ribbon[0].timestamp + 1800000) : true;
  const Icon = current ? (daylight ? ICONS[current.kind] : NIGHT_ICONS[current.kind] ?? ICONS[current.kind]) : CloudOff;
  const stale = failed || !!(now && updatedAt && now.getTime() - updatedAt > STALE_MS);
  const staleDescription = stale
    ? (updatedAt ? 'Last updated at ' + timeFormat.format(new Date(updatedAt)) + '. Press OK to retry.' : 'Forecast unavailable. Press OK to retry.')
    : '';
  const temperature = view?.current ? Math.round(view.current.temperature) : null;
  // The credit has to name the provider that actually answered, not the one we
  // asked first.
  const credit = (SOURCES.find(entry => entry.name === source) ?? SOURCES[0]).attribution;

  return <section className={'weather-band' + (stale ? ' stale' : '')} aria-label={'Weather. ' + staleDescription}>
    <div className={'weather' + (view?.headline?.wet ? ' raining-now' : '')}
      aria-label={current && temperature !== null ? temperature + ' degrees Celsius, ' + current.label : 'Weather unavailable'}>
      <a className="weather-icon" href={credit.href} target="_blank" rel="noreferrer"
        aria-label={(current?.label ?? 'Weather unavailable') + '. ' + credit.credit}>
        <Icon strokeWidth={2.3} aria-hidden="true" />
      </a>
      <p className="temperature" aria-hidden="true">{temperature ?? '—'}<span>°</span></p>
      <strong className="weather-headline" role={view ? undefined : 'status'}>{view?.headline?.text ?? (stale ? 'Forecast unavailable' : '···')}</strong>
      {stale && <span className="offline-dot" role="status" aria-label={staleDescription} />}
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
      <svg className="temperature-track" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <polyline points={view.track.points} />
      </svg>
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
  </section>;
}
