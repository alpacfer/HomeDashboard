'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import TransportPanel from '@/components/transport-panel';
import { DAILY_FACT_COUNTRIES, dailyDateKey, validDailyFacts, type DailyFact } from '@/lib/daily-facts';
import { initialRotation, nextRotation, pinnedRotation, resumeRotation } from '@/lib/panel-rotation';
import ForecastMapPanel from '@/components/forecast-map-panel';
import type { Rotation } from '@/lib/panel-rotation';

const STORAGE_KEY = 'home-dashboard:next-daily-fact:v1';
const artworkCache = new Map<string, HTMLImageElement>();

function preloadArtwork(src: string, priority: 'high' | 'low' = 'low') {
  if (typeof Image === 'undefined') return;
  const cached = artworkCache.get(src);
  if (cached) {
    if (priority === 'high') cached.fetchPriority = 'high';
    return;
  }
  const image = new Image();
  image.decoding = 'async';
  image.fetchPriority = priority;
  image.src = src;
  artworkCache.set(src, image);
  if (typeof image.decode === 'function') void image.decode().catch(() => undefined);
  image.addEventListener('error', () => {
    if (artworkCache.get(src) === image) artworkCache.delete(src);
  }, { once: true });
}

function FactArtwork({ fact }: { fact: DailyFact }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <div className="fact-image-fallback" role="img" aria-label={fact.image.alt}>Picture temporarily unavailable</div>;
  // Wikimedia thumbnails are loaded from the licensed source stored with each fact.
  // eslint-disable-next-line @next/next/no-img-element
  return <img
    src={fact.image.src}
    alt={fact.image.alt}
    width="1000"
    height="750"
    decoding="async"
    loading="eager"
    fetchPriority="high"
    onError={() => setFailed(true)}
  />;
}

function useDailyFacts() {
  const [date, setDate] = useState('');
  const [facts, setFacts] = useState<DailyFact[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let active = true;
    let loadedDate = '';
    let controller: AbortController | undefined;
    const load = async (key: string) => {
      controller?.abort();
      controller = new AbortController();
      setStatus('loading');
      try {
        const response = await fetch(`/facts/daily/${key}.json`, { signal: controller.signal, cache: 'no-cache' });
        if (!response.ok) throw new Error('Daily facts unavailable');
        const value: unknown = await response.json();
        if (!validDailyFacts(value, key)) throw new Error('Invalid daily facts');
        if (!active) return;
        loadedDate = key;
        setDate(key);
        setFacts(value.facts);
        setStatus('ready');
      } catch (error) {
        if (!active || (error instanceof DOMException && error.name === 'AbortError')) return;
        setStatus('error');
      }
    };
    const refresh = () => {
      const key = dailyDateKey();
      if (key !== loadedDate) void load(key);
    };
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      active = false;
      controller?.abort();
      window.clearInterval(timer);
    };
  }, []);

  return { date, facts, status };
}

export default function RotatingPanel({ onSceneChange }: { onSceneChange?: (scene: Rotation['phase']) => void }) {
  const { date, facts, status } = useDailyFacts();
  const [rotation, setRotation] = useState(() => initialRotation(0, DAILY_FACT_COUNTRIES));
  const [wake, setWake] = useState(0);

  useEffect(() => {
    // Debug mode: a scene named in the URL is held and nothing is scheduled.
    // See lib/panel-rotation.ts and README.md.
    const pinned = pinnedRotation(window.location.search, DAILY_FACT_COUNTRIES);
    if (pinned) {
      const timer = window.setTimeout(() => setRotation(pinned), 0);
      return () => window.clearTimeout(timer);
    }
    let start = 0;
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY)?.match(/^(\d{2}-\d{2}):(\d)$/);
      if (saved && saved[1] === date) start = Number(saved[2]);
    } catch { /* Storage can be disabled in a TV browser. Rotation still works. */ }
    let current = initialRotation(start, DAILY_FACT_COUNTRIES);
    let timer: number | undefined;
    const resetTimer = window.setTimeout(() => setRotation(current), 0);
    const schedule = () => {
      window.clearTimeout(timer);
      if (document.hidden) return;
      timer = window.setTimeout(() => {
        current = nextRotation(current, DAILY_FACT_COUNTRIES);
        if (current.phase === 'fact' && date) {
          try { window.localStorage.setItem(STORAGE_KEY, `${date}:${(current.index + 1) % DAILY_FACT_COUNTRIES}`); } catch { /* Device-local persistence is optional. */ }
        }
        setRotation(current);
        schedule();
      }, current.duration);
    };
    const visibility = () => {
      window.clearTimeout(timer);
      if (!document.hidden) {
        current = resumeRotation(current, DAILY_FACT_COUNTRIES);
        setRotation(current);
        setWake(value => value + 1);
        schedule();
      }
    };
    schedule();
    document.addEventListener('visibilitychange', visibility);
    return () => { window.clearTimeout(resetTimer); window.clearTimeout(timer); document.removeEventListener('visibilitychange', visibility); };
  }, [date]);

  const pinned = rotation.duration === 0;
  const showingFact = rotation.phase === 'fact';
  const showingMap = rotation.phase === 'map';
  const showingTransport = rotation.phase === 'transport';
  const fact = facts[rotation.index];

  useEffect(() => { onSceneChange?.(rotation.phase); }, [onSceneChange, rotation.phase]);

  useEffect(() => {
    if (fact) preloadArtwork(fact.image.src, 'high');
  }, [fact]);
  useEffect(() => {
    if (!facts.length) return;
    const timer = window.setTimeout(() => {
      for (const item of facts) preloadArtwork(item.image.src);
    }, 1_000);
    return () => window.clearTimeout(timer);
  }, [facts]);

  return <div className={'rotating-panel' + (!showingTransport ? ' showing-compact-transit' : '') + (showingMap ? ' showing-forecast-map' : '') + (pinned ? ' pinned' : '')} style={{ '--screen-duration': rotation.duration + 'ms' } as CSSProperties}>
    {pinned
      ? <span className="scene-pin" role="status">Pinned · {rotation.phase}</span>
      : <svg className="screen-progress" key={rotation.phase + '-' + rotation.index + '-' + wake} viewBox="0 0 32 32" role="img" aria-label="Time until the next screen">
        <circle className="screen-progress-track" cx="16" cy="16" r="13" />
        <circle className="screen-progress-ring" cx="16" cy="16" r="13" />
      </svg>}
    <div className={'panel-scene transit-scene' + (showingTransport ? ' is-active' : '')}>
      <TransportPanel compact={!showingTransport} />
    </div>
    <ForecastMapPanel active={showingMap} />
    {showingFact && fact && <article className={`panel-scene daily-fact-scene country-${fact.country} is-active`} key={fact.id} aria-label={`Today in ${fact.countryName}`}>
      <header className="daily-fact-heading">
        <span>Today in</span>
        <strong>{fact.countryName}</strong>
        <time dateTime={`2024-${fact.date}`}>{fact.dateLabel}</time>
      </header>
      <div className="fact-feature">
        <div className="fact-copy"><h2>{fact.title}</h2><p>{fact.body}</p></div>
        <figure className="fact-illustration">
          <FactArtwork fact={fact} />
          <figcaption><a href={fact.image.source} target="_blank" rel="noreferrer">{fact.image.credit}</a><br /><a href={fact.image.licenseUrl} target="_blank" rel="noreferrer">{fact.image.license}</a></figcaption>
        </figure>
      </div>
      <footer className="fact-footer">
        <a href={fact.source.url} target="_blank" rel="noreferrer" aria-label={`Source: ${fact.source.name}. Opens in a new tab.`}>{fact.source.name}</a>
        <a href={fact.source.license.url} target="_blank" rel="noreferrer">{fact.source.license.name}</a>
      </footer>
    </article>}
    {showingFact && !fact && <section className="panel-scene daily-fact-scene daily-fact-unavailable is-active" role="status">
      {status === 'loading' ? 'Finding today’s facts…' : 'Today’s facts are temporarily unavailable.'}
    </section>}
  </div>;
}
