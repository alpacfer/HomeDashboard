'use client';

import { useEffect, useState } from 'react';
import { boardIncidents, departureIncidents, LINES, nextCompactDeparture, type Departure, type TransitData } from '@/lib/transit';
import { debugFlags } from '@/lib/debug-flags';

const timeFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Copenhagen', hour: '2-digit', minute: '2-digit', hour12: false });
// A request that never settles would leave `pending` set for good and end all
// refreshing on a display nobody reloads, so every request has its own
// deadline and its own controller (see components/weather-panel.tsx).
const REQUEST_TIMEOUT_MS = 12_000;

const clock = (value: number) => timeFormat.format(new Date(value));
const countdown = (departure: Departure, now: number) => Math.max(0, Math.ceil((departure.expected - now) / 60000));

// The one thing worth printing under a departure. Everything the incident list
// found is in the aria-label, but the wall has room for the worst of them.
function departureFlag(departure: Departure) {
  const incidents = departureIncidents(departure);
  const worst = incidents[0];
  if (!worst) return { severity: '', label: departure.realtime ? 'Live' : 'Scheduled', live: true, spoken: departure.realtime ? 'on time, live' : 'on time, scheduled' };
  return { severity: worst.severity, label: worst.label, live: false, spoken: incidents.map(incident => incident.label).join(', ') };
}

export default function TransportPanel({ compact = false }: { compact?: boolean }) {
  const [data, setData] = useState<TransitData | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let pending = false;
    let inFlight: AbortController | null = null;
    // Debug: `?transit=demo` asks the route for a synthetic board instead of a
    // provider. See lib/debug-flags.ts.
    const endpointQuery = debugFlags(window.location.search).transit === 'demo' ? '?demo=1' : '';
    const refresh = async () => {
      if (pending || document.hidden) return;
      pending = true;
      const controller = new AbortController();
      inFlight = controller;
      const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch('/api/departures' + endpointQuery, { cache: 'no-store', signal: controller.signal });
        const value = await response.json() as TransitData;
        if (!response.ok || !['ready', 'needs_key'].includes(value.status)) throw new Error('Unavailable');
        if (active) { setData(value); setFailed(false); }
      } catch { if (active) setFailed(true); }
      finally {
        window.clearTimeout(timeout);
        if (inFlight === controller) inFlight = null;
        pending = false;
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 120000);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    const resume = () => { if (!document.hidden) void refresh(); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Enter' && !(event.target as HTMLElement)?.closest?.('a')) void refresh(); };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    window.addEventListener('keydown', key);
    return () => {
      active = false; inFlight?.abort();
      window.clearInterval(timer); window.clearInterval(tick);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
      window.removeEventListener('keydown', key);
    };
  }, []);
  const stale = failed || !!(data && now - data.generatedAt > 180000);
  const expired = !!(data && now - data.generatedAt > 300000);
  const incidents = expired ? [] : boardIncidents(data, now);
  const staleStatus = stale && data?.status !== 'needs_key'
    ? (expired || !data ? 'Departures unavailable' : 'Last update ' + clock(data.generatedAt))
    : '';
  // Provenance is shown only while the keyless fallback is answering, and only
  // on the full board: its realtime coverage is thinner than Rejseplanen's, so
  // a departure with no live flag means less there than it would here. The
  // compact strip sits under another scene and keeps its room for departures.
  const status = staleStatus || (!expired && data?.source === 'transitous' ? 'Live times via Transitous' : '');

  if (compact) return <section className="transport-mini" aria-label="Next departure for each route">
    <div className="mini-routes">
      {LINES.flatMap(line => line.directions.map(direction => {
        const departure = nextCompactDeparture(data, line.id + ':' + direction.key, now);
        const flag = departure ? departureFlag(departure) : null;
        return <div className="mini-route" key={line.id + ':' + direction.key} aria-label={line.id + ' towards ' + direction.destination}>
          <div className="mini-heading"><span className={'line-badge ' + line.style}>{line.id}</span><span>{direction.destination}</span></div>
          {departure && flag
            ? <strong className={'mini-time' + (flag.severity ? ' sev-' + flag.severity : '')} aria-label={'Next departure ' + clock(departure.expected) + ', ' + flag.spoken}>
                {countdown(departure, now) < 60 ? countdown(departure, now) : clock(departure.expected)}{countdown(departure, now) < 60 && <small>min</small>}
                {!flag.live && <em className="mini-flag">{flag.label}</em>}
              </strong>
            : <strong className="mini-time unavailable" aria-label={data?.status === 'ready' && !expired ? 'No upcoming departure' : 'Departures unavailable'}>—</strong>}
        </div>;
      }))}
    </div>
    {incidents.length > 0 && <p className="transport-incidents" role="status">
      {incidents.map(incident => <span className={'incident sev-' + incident.severity} key={incident.kind + incident.label}>{incident.label}</span>)}
    </p>}
    {staleStatus && <p className="transport-status" role="status">{staleStatus}</p>}
  </section>;

  return <section className="transport-panel" aria-label="Next public transport departures">
    {incidents.length > 0 && <p className="transport-incidents" role="status" aria-label="Service disruptions">
      {incidents.map(incident => <span className={'incident sev-' + incident.severity} key={incident.kind + incident.label}>{incident.label}</span>)}
    </p>}
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
            const minutes = countdown(departure, now);
            const flag = departureFlag(departure);
            // A late departure shows the time it should have left, struck
            // through, beside the time it now will: the delay in minutes alone
            // does not say which of two printed times to trust.
            const shifted = !departure.cancelled && departure.delay !== 0;
            return <div className={'departure' + (departure.cancelled ? ' cancelled' : '') + (flag.severity ? ' sev-' + flag.severity : '')} key={departure.id}
              aria-label={'Departs ' + clock(departure.expected) + ', ' + flag.spoken}>
              <strong>{minutes < 60 ? minutes : clock(departure.expected)}{minutes < 60 && <small>min</small>}</strong>
              <span>
                {shifted && <s>{clock(departure.scheduled)}</s>}
                {clock(departure.expected)}{departure.track && line.id === 'A' ? ' · ' + departure.track : ''}
              </span>
              <span className={flag.live ? 'departure-source' : 'departure-flag sev-' + flag.severity}>{flag.label}</span>
            </div>;
          })}
        </div>
        </section>;
        })}
        </div>
      </article>)}
    {status && <p className="transport-status" role="status">{status}</p>}
  </section>;
}
