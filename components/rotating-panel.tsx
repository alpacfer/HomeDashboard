'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import TransportPanel from '@/components/transport-panel';
import { DAILY_FACT_COUNT, dailyFactsRequest, mediaShape, validDailyFactEditionIndex, validDailyFacts, yearsAgo, type DailyFact } from '@/lib/daily-facts';
import { initialRotation, nextRotation, pinnedRotation, resumeRotation } from '@/lib/panel-rotation';
import { resumeFactIndex, validStoredFactCursor, type StoredFactCursor } from '@/lib/stored-shapes';
import ForecastMapPanel from '@/components/forecast-map-panel';
import type { SkyLight } from '@/lib/clock-sky';
import type { Rotation } from '@/lib/panel-rotation';
import { readStored, writeStored } from './device-storage';
import { useReducedMotion } from './use-reduced-motion';

// Where the day's rotation had got to. v2: a JSON record read through the
// same validator as every other stored shape; v1 was a bare "MM-DD:n" string.
const STORAGE_KEY = 'home-dashboard:next-daily-fact:v2';

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

/**
 * Drop every decoded image that is not one of `keep`.
 *
 * The cache only ever needs today's five. Without this it gained five more at
 * every Copenhagen midnight and released none, because the only delete was on
 * a load error — a slow leak of decoded bitmaps that a reload would have
 * hidden, on the one display that never gets one. A week of uptime is
 * thirty-five images the page can no longer show.
 */
function retainArtwork(keep: Iterable<string>) {
  const wanted = new Set(keep);
  for (const src of artworkCache.keys()) {
    if (!wanted.has(src)) artworkCache.delete(src);
  }
}

function FactStill({ fact, animated, onError }: { fact: DailyFact; animated: boolean; onError: () => void }) {
  const artwork = animated && fact.animation ? fact.animation : fact.image;
  // Wikimedia thumbnails are loaded from the licensed source stored with each fact.
  // eslint-disable-next-line @next/next/no-img-element
  return <img
    src={artwork.src}
    alt={fact.image.alt}
    width={'width' in artwork ? artwork.width : 1000}
    height={'height' in artwork ? artwork.height : 750}
    decoding="async"
    loading="eager"
    fetchPriority="high"
    onError={onError}
  />;
}

// The only moving picture on the display, and the only thing here that holds a
// decoder. Three rules follow from a wall that is never reloaded:
//
//   1. It is mounted only while its own fact is on screen, and torn down the
//      moment the scene changes — paused, src cleared, load() called. Dropping
//      the element alone leaves the decoder holding its buffers, which is the
//      overnight leak docs/DEPLOYMENT.md is about.
//   2. Any failure falls back to the still for the rest of the scene rather
//      than retrying. A clip that cannot be decoded on this device would
//      otherwise retry every time its date came round, for weeks.
//   3. Reduced motion gets the poster and nothing else.
//
// muted is what makes autoplay legal without a gesture, and there is no
// speaker on this wall in any case.
function FactVideo({ fact, onFail }: { fact: DailyFact; onFail: () => void }) {
  const node = useRef<HTMLVideoElement | null>(null);
  const src = fact.video?.src;
  const fallback = fact.video?.fallback;
  // Read through a ref so a new callback from the parent does not restart the
  // clip; the effect below is keyed on the source alone.
  const fail = useRef(onFail);
  useEffect(() => { fail.current = onFail; });

  useEffect(() => {
    const element = node.current;
    if (!element || !src) return;
    // The source is set here rather than in the JSX, and that is the whole
    // point. Teardown has to strip it to let the decoder go, and anything
    // React also owns it would put back on its own terms: stripping a
    // <source> child's src left React's tree unchanged, so on the next mount
    // it re-attached an empty element, load() failed, and the panel fell back
    // to the still for good. React owning nothing here means the two cannot
    // disagree.
    //
    // Asking the browser first is also how the H.264 derivative gets used at
    // all. Whether Silk decodes VP9 is unverified; if it says no, and the clip
    // has a fallback, it plays that instead. If it says no to both, onError
    // takes over and the still comes back.
    // React sets muted as a property and not as an attribute, and an older
    // Chromium can read the attribute when it decides whether autoplay is
    // allowed. Setting both costs nothing and is the difference between a clip
    // that plays on the wall and a poster that never moves.
    element.muted = true;
    element.setAttribute('muted', '');
    const webm = element.canPlayType('video/webm; codecs="vp9"');
    element.src = webm === 'probably' || webm === 'maybe' ? src : (fallback ?? src);
    element.load();
    const start = element.play();
    // A refused autoplay does not fire onError, so without this the row stayed
    // shaped for a clip that never played, with the poster floating in a
    // video-shaped column. The one rejection that is not a refusal is the
    // AbortError this effect's own teardown causes by pausing a clip that was
    // still starting, which must not mark the fact as unplayable for the day.
    if (start && typeof start.catch === 'function') {
      start.catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        fail.current();
      });
    }
    return () => {
      element.pause();
      element.removeAttribute('src');
      element.load();
    };
  }, [src, fallback]);

  if (!fact.video) return null;
  return <video
    ref={node}
    className="fact-video"
    poster={fact.video.poster}
    aria-label={fact.image.alt}
    width={fact.video.width}
    height={fact.video.height}
    muted
    loop
    playsInline
    preload="metadata"
    disablePictureInPicture
    onError={onFail}
  />;
}

// Whether a clip is playing is decided by the panel and not here, because the
// row's column widths depend on it: a clip that fell back to its still is a
// 4:3 picture again, and sizing the row for the clip would leave the picture
// floating in a column shaped for something else.
function FactArtwork({ fact, moving, onMotionFail }: { fact: DailyFact; moving: boolean; onMotionFail: () => void }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <div className="fact-image-fallback" role="img" aria-label={fact.image.alt}>Picture temporarily unavailable</div>;
  if (moving && fact.video) return <FactVideo fact={fact} onFail={onMotionFail} />;
  if (moving && fact.animation) return <FactStill fact={fact} animated onError={onMotionFail} />;
  return <FactStill fact={fact} animated={false} onError={() => setFailed(true)} />;
}

// A static JSON file off the same origin, so this is generous. It exists to
// bound the wait, not to tune it: Render's free instance can be cold.
const REQUEST_TIMEOUT_MS = 15_000;

function useDailyFacts(now: Date | null) {
  const [date, setDate] = useState('');
  const [facts, setFacts] = useState<DailyFact[]>([]);
  const [kicker, setKicker] = useState<string>();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  // The wall's clock, pinned or not, read through a ref so the minute timer
  // below is not rebuilt on every tick. `?time=` reaches the fact key this
  // way: a clock pinned across midnight shows that day's facts.
  const clock = useRef(now);
  useEffect(() => { clock.current = now; });

  useEffect(() => {
    let active = true;
    let loadedIdentity = '';
    let controller: AbortController | undefined;
    let editionsPromise: Promise<ReadonlySet<string>> | undefined;
    const editions = () => {
      if (editionsPromise) return editionsPromise;
      editionsPromise = (async () => {
        const own = new AbortController();
        controller = own;
        const timeout = window.setTimeout(() => own.abort(), REQUEST_TIMEOUT_MS);
        try {
          const response = await fetch('/facts/overrides/index.json', { signal: own.signal, cache: 'no-cache' });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const value: unknown = await response.json();
          if (!validDailyFactEditionIndex(value)) throw new Error('invalid edition index');
          return new Set(value.editions);
        } catch (error) {
          const aborted = error instanceof DOMException && error.name === 'AbortError';
          if (active) console.warn('[facts] edition index failed: ' + (aborted ? 'timeout' : error instanceof Error ? error.message : 'network error'));
          return new Set<string>();
        } finally {
          window.clearTimeout(timeout);
        }
      })();
      return editionsPromise;
    };
    const load = async (request: ReturnType<typeof dailyFactsRequest>) => {
      controller?.abort();
      setStatus('loading');
      for (const candidate of request.candidates) {
        // Every attempt owns both its AbortController and its deadline. The
        // ordinary daily file is a fallback, not a second fetch sharing a
        // signal that a missing or slow edition may already have aborted.
        const own = new AbortController();
        controller = own;
        const timeout = window.setTimeout(() => own.abort(), REQUEST_TIMEOUT_MS);
        try {
          const response = await fetch(candidate.url, { signal: own.signal, cache: 'no-cache' });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const value: unknown = await response.json();
          if (!validDailyFacts(value, request.date, candidate.editionDate)) throw new Error('invalid daily facts');
          if (!active) return;
          loadedIdentity = request.identity;
          setDate(request.date);
          setFacts(value.facts);
          setKicker(value.kicker);
          setStatus('ready');
          return;
        } catch (error) {
          if (!active) return;
          const aborted = error instanceof DOMException && error.name === 'AbortError';
          if (aborted && controller !== own) return;
          console.warn('[facts] ' + candidate.url + ' failed: ' + (aborted ? 'timeout' : error instanceof Error ? error.message : 'network error'));
        } finally {
          window.clearTimeout(timeout);
        }
      }
      if (active) setStatus('error');
    };
    const refresh = async () => {
      const request = dailyFactsRequest(clock.current ?? new Date(), window.location.search, await editions());
      if (active && request.identity !== loadedIdentity) void load(request);
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 60_000);
    return () => {
      active = false;
      controller?.abort();
      window.clearInterval(timer);
    };
  }, []);

  return { date, facts, kicker, status };
}

export default function RotatingPanel({ now, onSceneChange, mapLight }: { now: Date | null; onSceneChange?: (scene: Rotation['phase']) => void; mapLight: SkyLight | null }) {
  const { date, facts, kicker, status } = useDailyFacts(now);
  const [rotation, setRotation] = useState(() => initialRotation(0, DAILY_FACT_COUNT));
  const [wake, setWake] = useState(0);
  // Whether the forecast map has said it is not worth its thirty seconds,
  // which it does when the next six hours hold no precipitation anywhere on
  // its grid. A ref rather than state on purpose: this is read once, at the
  // moment the rotation steps out of a fact, and a forecast refresh landing
  // mid-scene must not rebuild the rotation effect and restart the cycle with
  // it. The map keeps refreshing while it is skipped, so it comes back on its
  // own when rain does.
  const dryForecast = useRef(false);
  const onDry = useCallback((dry: boolean) => { dryForecast.current = dry; }, []);

  useEffect(() => {
    // Debug mode: a scene named in the URL is held and nothing is scheduled.
    // See lib/panel-rotation.ts and README.md.
    const pinned = pinnedRotation(window.location.search, DAILY_FACT_COUNT);
    if (pinned) {
      const timer = window.setTimeout(() => setRotation(pinned), 0);
      return () => window.clearTimeout(timer);
    }
    // Storage can be disabled in a TV browser; the read then answers null and
    // the rotation starts from the first fact.
    const start = resumeFactIndex(readStored(STORAGE_KEY, validStoredFactCursor), date, DAILY_FACT_COUNT);
    let current = initialRotation(start, DAILY_FACT_COUNT);
    let timer: number | undefined;
    const resetTimer = window.setTimeout(() => setRotation(current), 0);
    const schedule = () => {
      window.clearTimeout(timer);
      if (document.hidden) return;
      timer = window.setTimeout(() => {
        current = nextRotation(current, DAILY_FACT_COUNT, !dryForecast.current);
        if (current.phase === 'fact' && date) {
          writeStored(STORAGE_KEY, { date, index: (current.index + 1) % DAILY_FACT_COUNT } satisfies StoredFactCursor);
        }
        setRotation(current);
        schedule();
      }, current.duration);
    };
    const visibility = () => {
      window.clearTimeout(timer);
      if (!document.hidden) {
        current = resumeRotation(current, DAILY_FACT_COUNT);
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

  // Only a clip that is actually playing reshapes the row. A still is cropped
  // to 4:3 and always was, so no shape means the layout the panel has always
  // used — which is also what reduced motion and a refused decoder get.
  // The refusal is remembered against the fact it happened to, so moving to
  // the next one clears it without an effect that resets state on every change
  // of fact — which is a cascading render, and lint says so.
  const [refusedId, setRefusedId] = useState<string | null>(null);
  const stillOnly = useReducedMotion();
  const moving = Boolean(fact?.video ?? fact?.animation) && !stillOnly && refusedId !== fact?.id;
  const movingMedia = moving ? (fact?.video ?? fact?.animation) : undefined;
  const shape = movingMedia ? mediaShape(movingMedia.width, movingMedia.height) : null;
  const credit = moving ? (fact?.video ?? fact?.animation ?? fact?.image) : fact?.image;

  useEffect(() => {
    if (fact) preloadArtwork(fact.image.src, 'high');
  }, [fact]);
  useEffect(() => {
    if (!facts.length) return;
    const timer = window.setTimeout(() => {
      // Today's five are the whole working set. Releasing yesterday's here,
      // rather than on unmount, is what keeps this bounded on a display that
      // crosses midnight a few hundred times between reloads.
      retainArtwork(facts.map(item => item.image.src));
      for (const item of facts) preloadArtwork(item.image.src);
    }, 1_000);
    return () => window.clearTimeout(timer);
  }, [facts]);

  // The light phase is carried on the panel as well as on the map's own frame:
  // the countdown ring is a sibling of the scenes, not a child of the frame,
  // so it cannot inherit the map's palette, and on the glass timeline it has to
  // be drawn in the map's ink rather than in the dashboard's. Set only while
  // the map is showing; on the other two scenes the ring keeps its own colours.
  return <div className={'rotating-panel' + (!showingTransport ? ' showing-compact-transit' : '') + (showingMap ? ' showing-forecast-map' : '') + (pinned ? ' pinned' : '')}
    data-light={showingMap ? mapLight ?? undefined : undefined} style={{ '--screen-duration': rotation.duration + 'ms' } as CSSProperties}>
    {pinned
      ? <span className="scene-pin" role="status">Pinned · {rotation.phase}</span>
      : <svg className="screen-progress" key={rotation.phase + '-' + rotation.index + '-' + wake} viewBox="0 0 32 32" role="img" aria-label="Time until the next screen">
        <circle className="screen-progress-track" cx="16" cy="16" r="13" />
        <circle className="screen-progress-ring" cx="16" cy="16" r="13" />
      </svg>}
    <div className={'panel-scene transit-scene' + (showingTransport ? ' is-active' : '')}>
      <TransportPanel compact={!showingTransport} />
    </div>
    <ForecastMapPanel active={showingMap} onDry={onDry} light={mapLight} />
    {showingFact && fact && <article className={`panel-scene daily-fact-scene category-${fact.category} is-active`} key={fact.id} aria-label={`On this day in ${fact.year}: ${fact.title}`}>
      <header className="daily-fact-heading">
        <span>{kicker ?? 'On this day'}</span>
        <strong>{fact.categoryName}</strong>
        <time dateTime={`2024-${fact.date}`}>{fact.dateLabel}</time>
      </header>
      <div className={'fact-feature' + (shape ? ' media-' + shape : '')}>
        <div className="fact-copy">
          <p className="fact-year"><strong>{fact.year}</strong><span>{yearsAgo(fact.year, now ?? new Date())}</span></p>
          <h2>{fact.title}</h2>
          <p className="fact-body">{fact.body}</p>
        </div>
        <figure
          className={'fact-illustration' + (shape ? ' media-' + shape : '') + (moving && fact.video ? ' has-video' : '') + (moving && fact.animation ? ' has-animation' : '')}
          style={movingMedia ? ({ '--media-ar': `${movingMedia.width} / ${movingMedia.height}` } as CSSProperties) : undefined}
        >
          <FactArtwork fact={fact} moving={moving} onMotionFail={() => setRefusedId(fact.id)} />
          {credit && <figcaption><a href={credit.source} target="_blank" rel="noreferrer" tabIndex={-1}>{credit.credit}</a><span className="credit-dot"> · </span><a href={credit.licenseUrl} target="_blank" rel="noreferrer" tabIndex={-1}>{credit.license}</a></figcaption>}
        </figure>
      </div>
      {/* The article title the old footer spelled out is the headline two lines
          above it, so the visible credit is the site and the licence and the
          link still resolves to the article. Wikipedia's own reuse guidance
          takes a link to the article as attribution; the full source name
          stays in the accessible label. */}
      <footer className="fact-footer">
        <a href={fact.source.url} target="_blank" rel="noreferrer" tabIndex={-1} aria-label={`Source: ${fact.source.name}. Opens in a new tab.`}>Wikipedia</a>
        <span className="credit-dot">·</span>
        <a href={fact.source.license.url} target="_blank" rel="noreferrer" tabIndex={-1}>{fact.source.license.name}</a>
      </footer>
    </article>}
    {showingFact && !fact && <section className="panel-scene daily-fact-scene daily-fact-unavailable is-active" role="status">
      {status === 'loading' ? 'Finding today’s facts…' : 'Today’s facts are temporarily unavailable.'}
    </section>}
  </div>;
}
