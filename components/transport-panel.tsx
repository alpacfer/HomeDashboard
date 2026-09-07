'use client';

import { useEffect, useState } from 'react';
import { BOARD_EXPIRED_MS, boardFreshness, boardIncidents, boardKey, departureIncidents, LINES, nextCompactDeparture, serviceHeadway, validTransitData, type Departure, type TransitData } from '@/lib/transit';
import { debugFlags } from '@/lib/debug-flags';
import { onRefreshTriggers } from './refresh-triggers';

import { copenhagenClock } from '@/lib/copenhagen';

// A request that never settles would leave `pending` set for good and end all
// refreshing on a display nobody reloads, so every request has its own
// deadline and its own controller (see components/weather-panel.tsx).
const REQUEST_TIMEOUT_MS = 12_000;

const clock = copenhagenClock;
const countdown = (departure: Departure, now: number) => Math.max(0, Math.ceil((departure.expected - now) / 60000));

// The one thing worth printing under a departure, or nothing at all. A
// departure with nothing wrong gets no line of its own: saying so for every one
// of the eighteen on screen cost a row of height to tell the reader nothing.
// Whether the time is being tracked is carried by the dot beside it instead
// (see `.is-live` in app/globals.css). Everything the incident list found is
// still in the aria-label.
function departureFlag(departure: Departure) {
  const incidents = departureIncidents(departure);
  const worst = incidents[0];
  const timetable = departure.realtime ? ', tracked live' : ', timetable only';
  if (!worst) return { severity: '', label: '', spoken: 'on time' + timetable };
  return { severity: worst.severity, label: worst.label, spoken: incidents.map(incident => incident.label).join(', ') + timetable };
}

export default function TransportPanel({ compact = false }: { compact?: boolean }) {
  const [data, setData] = useState<TransitData | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let pending = false;
    let inFlight: AbortController | null = null;
    // Debug: `?transit=demo|stale|expired|down` asks the route for a synthetic
    // board instead of a provider, dated or refused. See lib/debug-flags.ts.
    const transit = debugFlags(window.location.search).transit;
    const endpointQuery = transit === 'live' ? '' : '?demo=' + transit;
    const refresh = async () => {
      if (pending || document.hidden) return;
      pending = true;
      const controller = new AbortController();
      inFlight = controller;
      const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch('/api/departures' + endpointQuery, { cache: 'no-store', signal: controller.signal });
        // The status first: a Render 502 page is HTML, and reading it as JSON
        // would report a parse error where the real reason is the status.
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const value: unknown = await response.json();
        if (!validTransitData(value)) throw new Error('unusable payload');
        if (value.status === 'unavailable') throw new Error('every provider failed');
        if (active) { setData(value); setFailed(false); }
      } catch (error) {
        if (!active) return;
        // The one line that explains a board of dashes when the display is
        // inspected over remote debugging, as the weather card's does.
        console.warn('[transit] refresh failed: ' + (controller.signal.aborted ? 'timeout' : error instanceof Error ? error.message : 'network error'));
        setFailed(true);
      } finally {
        window.clearTimeout(timeout);
        if (inFlight === controller) inFlight = null;
        pending = false;
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 120000);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    const off = onRefreshTriggers(() => void refresh(), { keys: ['Enter'] });
    return () => {
      active = false; inFlight?.abort();
      window.clearInterval(timer); window.clearInterval(tick);
      off();
    };
  }, []);
  const expired = !!(data && now - data.generatedAt > BOARD_EXPIRED_MS);
  const incidents = expired ? [] : boardIncidents(data, now);
  const freshness = boardFreshness(data, now, failed);
  // Who answered rides on the same stamp as one word, and only on the full
  // board: the keyless fallback's realtime coverage is thinner than
  // Rejseplanen's, so a departure with no live dot means less there than it
  // would here. It was its own sentence on its own line, which said the same
  // thing at four times the width and moved the boards when it appeared. The
  // strip shows six numbers under another scene and says only how old they are.
  const viaFallback = !compact && !expired && data?.source === 'transitous';
  // Always rendered and out of the flow, so a board that goes stale says so
  // without moving a single departure. See `boardFreshness` and
  // `.transport-age` in app/globals.css.
  const age = freshness.label
    ? <p className={'transport-age' + (freshness.severity ? ' sev-' + freshness.severity : '')}
        aria-label={freshness.spoken + (viaFallback ? '. Live times via Transitous' : '')}>
        <span aria-hidden="true">{freshness.label}</span>
        {viaFallback && <span className="transport-source" aria-hidden="true">Transitous</span>}
      </p>
    : null;

  if (compact) return <section className="transport-mini" aria-label="Next departure for each route">
    <div className="mini-routes">
      {LINES.flatMap(line => line.directions.map(direction => {
        const departure = nextCompactDeparture(data, boardKey(line.id, direction.key), now);
        const flag = departure ? departureFlag(departure) : null;
        return <div className="mini-route" key={boardKey(line.id, direction.key)} aria-label={line.id + ' towards ' + direction.destination}>
          <div className="mini-heading"><span className={'line-badge ' + line.style}>{line.id}</span><span>{direction.destination}</span></div>
          {departure && flag
            ? <strong className={'mini-time' + (flag.severity ? ' sev-' + flag.severity : '')} aria-label={'Next departure ' + clock(departure.expected) + ', ' + flag.spoken}>
                {countdown(departure, now) < 60 ? countdown(departure, now) : clock(departure.expected)}{countdown(departure, now) < 60 && <small>min</small>}
                {flag.label && <em className="mini-flag">{flag.label}</em>}
              </strong>
            : <strong className="mini-time unavailable" aria-label={data?.status === 'ready' && !expired ? 'No upcoming departure' : 'Departures unavailable'}>—</strong>}
        </div>;
      }))}
    </div>
    {incidents.length > 0 && <p className="transport-incidents" role="status">
      {incidents.map(incident => <span className={'incident sev-' + incident.severity} key={incident.kind + incident.label}>{incident.label}</span>)}
    </p>}
    {age}
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
          const departures = !expired ? (data?.boards[boardKey(line.id, direction.key)] || []).filter(departure => departure.expected >= now).slice(0, 3) : [];
          const headway = expired ? null : serviceHeadway(data, line.id, direction.key, now);
          return <section className="direction-column" key={direction.key} aria-label={line.id + ' towards ' + direction.destination + (headway ? ', about every ' + headway + ' minutes' : '')}>
        <h2>{direction.destination}{headway ? <span className="headway">every {headway} min</span> : null}</h2>
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
              aria-label={(departure.cancelled ? 'The ' + clock(departure.scheduled) + ' is cancelled' : 'Departs ' + clock(departure.expected)) + ', ' + flag.spoken}>
              {/* A cancelled service gets no countdown. Minutes until a bus
                  that is not coming is the one number on the board that can
                  send somebody to the stop for nothing. */}
              <strong aria-hidden={departure.cancelled || undefined}>
                {departure.cancelled ? '\u2715' : <>{minutes < 60 ? minutes : clock(departure.expected)}{minutes < 60 && <small>min</small>}</>}
              </strong>
              <span className={departure.realtime && !departure.cancelled ? 'is-live' : undefined}>
                {departure.cancelled
                  ? <s>{clock(departure.scheduled)}</s>
                  : <>{shifted && <s>{clock(departure.scheduled)}</s>}{clock(departure.expected)}{departure.track && line.id === 'A' ? ' · ' + departure.track : ''}</>}
              </span>
              {flag.label && <span className={'departure-flag sev-' + flag.severity}>{flag.label}</span>}
            </div>;
          })}
        </div>
        </section>;
        })}
        </div>
      </article>)}
    {age}
  </section>;
}
