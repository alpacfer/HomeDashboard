'use client';

import { useEffect, useState } from 'react';
import { LINES, nextCompactDeparture, type TransitData } from './transit';

const timeFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Copenhagen', hour: '2-digit', minute: '2-digit', hour12: false });

export default function TransportPanel({ compact = false }: { compact?: boolean }) {
  const [data, setData] = useState<TransitData | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let pending = false;
    const controller = new AbortController();
    const refresh = async () => {
      if (pending || document.hidden) return;
      pending = true;
      try {
        const response = await fetch('/api/departures', { cache: 'no-store', signal: controller.signal });
        const value = await response.json() as TransitData;
        if (!response.ok || !['ready', 'needs_key'].includes(value.status)) throw new Error('Unavailable');
        if (active) { setData(value); setFailed(false); }
      } catch { if (active) setFailed(true); }
      finally { pending = false; }
    };
    void refresh();
    const timer = window.setInterval(refresh, 120000);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    const resume = () => { if (!document.hidden) void refresh(); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Enter' && !(event.target as HTMLElement)?.closest?.('a')) void refresh(); };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    window.addEventListener('keydown', key);
    return () => {
      active = false; controller.abort();
      window.clearInterval(timer); window.clearInterval(clock);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
      window.removeEventListener('keydown', key);
    };
  }, []);
  const stale = failed || !!(data && now - data.generatedAt > 180000);
  const expired = !!(data && now - data.generatedAt > 300000);
  if (compact) return <section className="transport-mini" aria-label="Next departure for each route">
    <div className="mini-routes">
      {LINES.flatMap(line => line.directions.map(direction => {
        const departure = nextCompactDeparture(data, line.id + ':' + direction.key, now);
        const minutes = departure ? Math.max(0, Math.ceil((departure.expected - now) / 60000)) : null;
        return <div className="mini-route" key={line.id + ':' + direction.key} aria-label={line.id + ' towards ' + direction.destination}>
          <div className="mini-heading"><span className={'line-badge ' + line.style}>{line.id}</span><span>{direction.destination}</span></div>
          {departure && minutes !== null
            ? <strong className="mini-time" aria-label={'Next departure ' + timeFormat.format(new Date(departure.expected)) + (departure.realtime ? ', live' : ', scheduled')}>
                {minutes < 60 ? minutes : timeFormat.format(new Date(departure.expected))}{minutes < 60 && <small>min</small>}
              </strong>
            : <strong className="mini-time unavailable" aria-label={data?.status === 'ready' && !expired ? 'No upcoming departure' : 'Departures unavailable'}>—</strong>}
        </div>;
      }))}
    </div>
    {stale && data?.status !== 'needs_key' && <p className="transport-status" role="status">{expired || !data ? 'Departures unavailable' : 'Last update ' + timeFormat.format(new Date(data.generatedAt))}</p>}
  </section>;
  return <section className="transport-panel" aria-label="Next public transport departures">
    {LINES.map(line => <article className={'departure-board' + (line.directions.length === 1 ? ' single-direction' : '')} key={line.id}>
        <header className="departure-heading">
          <span className={'line-badge ' + line.style}>{line.id}</span>
          <p>{line.origin}</p>
        </header>
        <div className="direction-columns">
        {line.directions.map(direction => {
          const departures = !expired ? (data?.boards[line.id + ':' + direction.key] || []).filter(departure => departure.expected >= now).slice(0, 3) : [];
          return <section className="direction-column" key={direction.key} aria-label={line.id + ' towards ' + direction.destination}>
        <h2>{direction.destination}</h2>
        <div className="departure-times">
          {[0, 1, 2].map(i => {
            const departure = departures[i];
            if (!departure) return <div className="departure placeholder" key={i} aria-label={data?.status === 'ready' && !expired ? 'No further departure in the next 24 hours' : 'Departures unavailable'}><strong>—</strong><span>—:—</span></div>;
            const minutes = Math.max(0, Math.ceil((departure.expected - now) / 60000));
            return <div className={'departure' + (departure.cancelled ? ' cancelled' : '')} key={departure.id}>
              <strong>{minutes < 60 ? minutes : timeFormat.format(new Date(departure.expected))}{minutes < 60 && <small>min</small>}</strong>
              <span>{timeFormat.format(new Date(departure.expected))}{departure.track && line.id === 'A' ? ' · ' + departure.track : ''}</span>
              {departure.cancelled ? <span className="delay">Cancelled</span> : departure.delay > 0 ? <span className="delay">+{departure.delay} min</span> : <span className="departure-source">{departure.realtime ? 'Live' : 'Scheduled'}</span>}
            </div>;
          })}
        </div>
        </section>;
        })}
        </div>
      </article>)}
    {stale && data?.status !== 'needs_key' && <p className="transport-status" role="status">
      {expired || !data ? 'Departures unavailable' : 'Last update ' + timeFormat.format(new Date(data.generatedAt))}
    </p>}
  </section>;
}
