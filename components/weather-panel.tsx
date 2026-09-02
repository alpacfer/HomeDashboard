'use client';

import { useEffect, useMemo, useState } from 'react';
import { Cloud, CloudDrizzle, CloudFog, CloudHail, CloudMoon, CloudOff, CloudRain, CloudRainWind, CloudSnow, CloudSun, Cloudy, Moon, Sun } from 'lucide-react';
import { describeHour, dmiForecastUrl, isDaylight, parseHours, validCoverage, type ConditionKind, type WeatherHour } from '@/lib/weather';
import { buildRibbon, rainHeadline, temperatureTrack } from '@/lib/forecast-summary';

const REFRESH_MS = 15 * 60 * 1000;
const STALE_MS = 45 * 60 * 1000;
// DMI's fair-use limit is 500 requests per 5 seconds across all callers, and it
// answers 429 rather than queueing, so a busy moment is the normal case and not
// an outage. Back off, keep the last good run on screen, and never spin: this
// display refreshes 96 times a day and has no reason to add to the pressure.
const RETRY_BASE_MS = 20_000;
const RETRY_MAX_MS = 5 * 60 * 1000;

const ICONS: Record<ConditionKind, typeof Sun> = {
  clear: Sun, partly: CloudSun, cloudy: Cloudy, overcast: Cloud, fog: CloudFog,
  drizzle: CloudDrizzle, rain: CloudRain, 'heavy-rain': CloudRainWind, sleet: CloudSnow, snow: CloudSnow, hail: CloudHail,
};
const NIGHT_ICONS: Partial<Record<ConditionKind, typeof Sun>> = { clear: Moon, partly: CloudMoon };

const timeFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Copenhagen', hour: '2-digit', minute: '2-digit', hour12: false });

export default function WeatherPanel({ now }: { now: Date | null }) {
  const [hours, setHours] = useState<WeatherHour[] | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let pending = false;
    let attempt = 0;
    let retry = 0;
    const controller = new AbortController();

    const load = async () => {
      if (pending || document.hidden) return;
      pending = true;
      window.clearTimeout(retry);
      const timeout = window.setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch(dmiForecastUrl(), { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('DMI unavailable');
        const payload: unknown = await response.json();
        if (!validCoverage(payload)) throw new Error('Unexpected DMI payload');
        const parsed = parseHours(payload);
        if (!parsed.length) throw new Error('Empty DMI forecast');
        if (!active) return;
        attempt = 0;
        setHours(parsed);
        setUpdatedAt(Date.now());
        setFailed(false);
      } catch {
        if (!active) return;
        setFailed(true);
        attempt += 1;
        const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (attempt - 1));
        retry = window.setTimeout(() => void load(), delay * (0.75 + Math.random() / 2));
      } finally {
        window.clearTimeout(timeout);
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
      controller.abort();
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

  return <section className={'weather-band' + (stale ? ' stale' : '')} aria-label={'Weather. ' + staleDescription}>
    <div className={'weather' + (view?.headline?.wet ? ' raining-now' : '')}
      aria-label={current && temperature !== null ? temperature + ' degrees Celsius, ' + current.label : 'Weather unavailable'}>
      <a className="weather-icon" href="https://www.dmi.dk/friedata/dokumentation/terms-of-use" target="_blank" rel="noreferrer"
        aria-label={(current?.label ?? 'Weather unavailable') + '. DMI Harmonie forecast, DMI free data, CC BY 4.0.'}>
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
