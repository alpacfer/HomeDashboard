'use client';

import { useEffect, useMemo, useState } from 'react';
import { describeHour, isDaylight, reviveWeatherHours, type WeatherHour } from '@/lib/weather';
import { SOURCES, type SourceName } from '@/lib/forecast-sources';
import { buildRibbon, rainHeadline, temperatureTrack } from '@/lib/forecast-summary';
import { debugFlags, pinnedNow } from '@/lib/debug-flags';
import { demoWeatherHours } from '@/lib/weather-demo';
import { validStoredForecast, type StoredForecast } from '@/lib/stored-shapes';
import type { Conditions } from '@/lib/clock-conditions';
import { readStored, writeStored } from './device-storage';
import { useProviderChain } from './use-provider-chain';
import WeatherWoodland from './weather-woodland';
import { useSceneSky } from './use-scene-sky';

import { copenhagenClock } from '@/lib/copenhagen';

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

export default function WeatherPanel({ now, onConditions }: { now: Date | null; onConditions?: (conditions: Conditions) => void }) {
  const [hours, setHours] = useState<WeatherHour[] | null>(null);
  const [source, setSource] = useState<SourceName | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // Debug: every mode but `live` makes no request at all. `off` and `demo`
    // draw a placeholder forecast so a capture of something else still shows
    // the card in context; `none` leaves it genuinely empty, which is the
    // state a real outage produces. The placeholder is never a fallback: a
    // provider that fails on the wall shows the dot and the last good answer.
    // The source stays null, so nothing credits a provider for invented data,
    // unless `?source=` names one on purpose to photograph its mark.
    const flags = debugFlags(window.location.search);
    const mode = flags.weather;
    if (mode === 'none') return;
    // Off the effect body in both branches, because setting state
    // synchronously in an effect cascades a render.
    if (mode !== 'live') {
      // Built from the pinned clock, not the wall clock: the ribbon's window
      // has to line up with the digits under `?time=` rather than draw a
      // different hour of the day beside them, and the age that decides
      // whether the card is drawn muted is measured against that same clock.
      const placeholder = window.setTimeout(() => {
        const at = pinnedNow(flags.time, new Date());
        setHours(demoWeatherHours(at));
        setUpdatedAt(at.getTime());
        setSource(flags.source);
      }, 0);
      return () => window.clearTimeout(placeholder);
    }
    const restore = window.setTimeout(() => {
      const saved = readStored(STORAGE_KEY, validStoredForecast);
      if (!saved) return;
      setHours(reviveWeatherHours(saved.hours));
      setSource(saved.source);
      setUpdatedAt(saved.updatedAt);
    }, 0);
    return () => window.clearTimeout(restore);
  }, []);

  // Each provider is tried in preference order until one answers with a
  // forecast that parses; the loop itself is shared with the week strip.
  useProviderChain({
    tag: '[weather]',
    sources: SOURCES,
    refreshMs: REFRESH_MS,
    timeoutMs: REQUEST_TIMEOUT_MS,
    retryBaseMs: RETRY_BASE_MS,
    retryMaxMs: RETRY_MAX_MS,
    penaltyMs: SOURCE_PENALTY_MS,
    retryKeys: ['Enter', 'r', 'R'],
    parse: (body, entry) => {
      const parsed = entry.parse(body);
      return parsed?.length ? parsed : null;
    },
    onAnswer: (answer, entry) => {
      const updated = Date.now();
      setHours(answer);
      setSource(entry.name);
      setUpdatedAt(updated);
      setFailed(false);
      writeStored(STORAGE_KEY, { hours: answer, source: entry.name, updatedAt: updated } satisfies StoredForecast);
    },
    onFailure: () => setFailed(true),
  });

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
  const sky = useSceneSky(now, current?.kind ?? null, current?.band ?? null);

  // Report the current hour to the clock once per change, not once per tick.
  const reportedTemperature = view?.current?.temperature ?? null;
  const reportedWet = current?.wet ?? false;
  const reportedKind = current?.kind ?? null;
  const reportedBand = current?.band ?? null;
  useEffect(() => {
    onConditions?.({ temperature: reportedTemperature, wet: reportedWet, kind: reportedKind, band: reportedBand });
  }, [onConditions, reportedTemperature, reportedWet, reportedKind, reportedBand]);
  const daylight = view ? isDaylight(view.ribbon[0].timestamp + 1800000) : true;
  // Two separate facts. `stale` is about the data: older than STALE_MS, so the
  // card is drawn muted. `offline` is about the connection: the last refresh
  // failed, or there is nothing at all, so the dot appears. A refresh that
  // fails while the data is twenty minutes old shows the dot and nothing else;
  // the forecast on screen is still current and must not look broken.
  const age = now && updatedAt ? now.getTime() - updatedAt : null;
  const stale = age === null ? !hours : age > STALE_MS;
  const offline = failed || stale;
  const offlineDescription = offline
    ? (updatedAt ? 'Last updated at ' + copenhagenClock(updatedAt) + '. Press OK to retry.' : 'Forecast unavailable. Press OK to retry.')
    : '';
  const temperature = view?.current ? Math.round(view.current.temperature) : null;
  // The credit has to name the provider that actually answered, not the one we
  // asked first.
  const credit = (SOURCES.find(entry => entry.name === source) ?? SOURCES[0]).attribution;

  return <section className={'weather-band' + (stale ? ' stale' : '')} aria-label={'Weather. ' + offlineDescription}>
    <div className={'weather' + (current ? ' ct-hillside condition-' + current.kind : ' weather-empty') + (daylight ? '' : ' night') + (view?.headline?.wet ? ' raining-now' : '')}
      data-light={sky?.light} data-weather={sky?.weather} data-fall={sky?.fall}
      // Where each body is, as two fractions of one, plus what the moon looks
      // like: how much of it is lit, and how far its lit side is turned from
      // the right-hand edge it is drawn on. Not layout styles: the card has
      // none in it, and app/horizon.css owns every position on this painting.
      // These are the live half of a rule whose geometry was traced off the
      // artwork by npm run horizon, and they change once a minute.
      // `--moon-lit` is the only phase number written, because the stylesheet
      // derives both halves of the drawn shape from it — a bite out of the
      // crescent, a bulge on the gibbous — and one number cannot disagree with
      // itself the way two would.
      style={sky ? {
        '--sun-cross': sky.sun.cross.toFixed(4), '--sun-climb': sky.sun.climb.toFixed(4),
        '--moon-cross': sky.moon.cross.toFixed(4), '--moon-climb': sky.moon.climb.toFixed(4),
        '--moon-lit': sky.phase.illuminated.toFixed(4), '--moon-tilt': sky.phase.tilt.toFixed(1) + 'deg',
      } as React.CSSProperties : undefined}
      aria-label={current && temperature !== null ? temperature + ' degrees Celsius, ' + current.label : 'Weather unavailable'}>
      {current && <WeatherWoodland />}
      <span className="weather-landing" aria-hidden="true" />
      <p className="temperature" aria-hidden="true">{temperature ?? '—'}<span>°</span>{current && <small>{current.label}</small>}</p>
      <strong className="weather-headline" role={view ? undefined : 'status'}>{view?.headline?.text ?? (offline ? 'Forecast unavailable' : '···')}</strong>
      {offline && <span className="offline-dot" role="status" aria-label={offlineDescription} />}
    </div>

    {view && view.track ? <div className="rain-ribbon" role="group"
      aria-label={'Next ' + view.ribbon.length + ' hours. ' + (view.headline?.text ?? '') + '. Temperature between '
        + Math.round(view.track.low) + ' and ' + Math.round(view.track.high) + ' degrees. '
        + view.ribbon.filter(entry => entry.band !== 'dry')
          .map(entry => String(entry.hour).padStart(2, '0') + ':00 ' + entry.kind.replace('-', ' ') + ' ' + entry.millimetres.toFixed(1) + ' millimetres')
          .join(', ')}>
      {/* The linked monogram credits the provider that actually answered.
          Its accessible label carries the full attribution. */}
      <div className="ribbon-heading">
        <h2>Next {view.ribbon.length} hours</h2>
        {source && <a className="weather-credit" href={credit.href} target="_blank" rel="noreferrer" tabIndex={-1} aria-label={credit.credit}>{credit.mark}</a>}
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
  </section>;
}
