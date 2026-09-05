'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Map } from 'leaflet';
import {
  coversView, displayFrames, GRID_HOURS, gridForView, hasPrecipitation, isQuietHours, MAP_BOUNDS,
  parsePrecipitationGrid, precipitationColour, precipitationGridUrl, quietHoursEnd, SEQUENCE_LOOPS, timelineTicks,
  validPrecipitationGrid, type MapBounds, type PrecipitationGrid,
} from '@/lib/precipitation-grid';
import {
  advectedCells, distinctStates, estimateFlows, MIN_DRAW_MS, momentAt, PLAYHEAD_MS, sequencePosition, steadyFlows,
} from '@/lib/precipitation-flow';
import { demoGrid } from '@/lib/precipitation-demo';
import { CHECK_RETRY_MS, MODEL_META_URL, nextCheckAt, parseModelRun, shouldFetchGrid, type ModelRun } from '@/lib/forecast-refresh';
import { MAP_MS } from '@/lib/panel-rotation';
import { debugFlags } from '@/lib/debug-flags';
import { readStored, writeStored } from './device-storage';
import { openMeteoLockout, recordOpenMeteoRefusal } from './open-meteo-lockout';

// The last grid, kept on the device. One grid request is about three hundred
// coordinates, each of which Open-Meteo counts against a daily quota of ten
// thousand per address (lib/open-meteo-quota.ts), so a reload (a crash, a
// development session, a screenshot) must not buy the same run again. The
// scheduler compares the stored run against the metadata and fetches only
// when a newer one exists.
const STORAGE_KEY = 'home-dashboard:forecast-grid:v1';

const HOME: [number, number] = [55.73825, 12.53836];
const PLACES: Array<{ label: string; coordinates: [number, number]; home?: boolean }> = [
  { label: 'Home', coordinates: HOME, home: true },
  { label: 'Copenhagen', coordinates: [55.6761, 12.5683] },
  { label: 'Hillerød', coordinates: [55.9279, 12.3008] },
];
const FIT_OPTIONS = { animate: false, maxZoom: 12, padding: [18, 18] as [number, number] };
const frameTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Copenhagen',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

type MapStatus = 'loading' | 'ready' | 'error';

export default function ForecastMapPanel({ active }: { active: boolean }) {
  const canvas = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLCanvasElement | null>(null);
  const image = useRef<HTMLCanvasElement | null>(null);
  const map = useRef<Map | null>(null);
  const held = useRef<PrecipitationGrid | null>(null);
  // The view as measured the last time the scene was on screen. The frame is
  // a different size while hidden, so the live bounds cannot be trusted then;
  // every request and every coverage check uses this instead.
  const view = useRef<MapBounds | null>(null);
  const refresh = useRef<() => void>(() => undefined);
  // Whether the scheduler's timer has ever been armed. See the first-appearance
  // effect below, which is the only thing that arms it.
  const started = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [grid, setGrid] = useState<PrecipitationGrid | null>(null);
  // How far through the sequence the animation is, 0 to 1. The canvas is
  // painted from the clock many times a second; this is only what the playhead
  // and its label are drawn from, and is set far more slowly.
  const [progress, setProgress] = useState(0);
  // How much of this appearance has already been played, in milliseconds, and
  // whether the scene was on screen the last time the loop was built.
  //
  // Together they decide where the animation starts. The scene coming round is
  // the one thing that restarts it: the map is meant to be read from the
  // beginning of the forecast, not joined halfway through. But the loop is
  // also rebuilt while the scene stays on screen, whenever the displayed
  // window shifts as frames expire, and that must not restart anything or the
  // sequence would jump back to its beginning at random.
  const played = useRef(0);
  const wasActive = useRef(false);
  const [status, setStatus] = useState<MapStatus>('loading');
  const [nowMs, setNowMs] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void import('leaflet').then(L => {
      if (cancelled || !canvas.current) return;
      const nextMap = L.map(canvas.current, {
        attributionControl: false,
        boxZoom: false,
        doubleClickZoom: false,
        dragging: false,
        keyboard: false,
        scrollWheelZoom: false,
        touchZoom: false,
        zoomControl: false,
        zoomSnap: 0.25,
      });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        className: 'forecast-map-basemap',
        maxZoom: 19,
        updateWhenIdle: true,
      }).addTo(nextMap);
      for (const place of PLACES) {
        L.circleMarker(place.coordinates, {
          className: 'forecast-map-dot',
          color: '#f3f2ee',
          fillColor: place.home ? '#ff623b' : '#74caff',
          fillOpacity: 1,
          opacity: 1,
          radius: place.home ? 5 : 4,
          weight: 2,
        }).addTo(nextMap).bindTooltip(place.label, {
          className: 'forecast-map-label',
          direction: 'right',
          offset: [7, 0],
          permanent: true,
        });
      }
      nextMap.fitBounds([[MAP_BOUNDS.south, MAP_BOUNDS.west], [MAP_BOUNDS.north, MAP_BOUNDS.east]], FIT_OPTIONS);
      map.current = nextMap;
      setMapReady(true);
    }).catch(() => {
      if (!cancelled) setStatus('error');
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // What the map is showing, in degrees, or null while the container has no
  // size. Read only while the scene is active; see `view`.
  const viewBounds = (): MapBounds | null => {
    const nextMap = map.current;
    const element = canvas.current;
    if (!nextMap || !element || !element.clientWidth || !element.clientHeight) return null;
    const bounds = nextMap.getBounds();
    return { south: bounds.getSouth(), west: bounds.getWest(), north: bounds.getNorth(), east: bounds.getEast() };
  };

  // One scheduler, one pending timer. Each pass reads the run metadata (a
  // kilobyte, CDN-cached) and fetches the grid only when that names a run the
  // map does not hold, or the view has outgrown the grid. It then books the
  // next pass for when the following run is expected, or for 06:00 if that
  // would fall in the quiet hours. See lib/forecast-refresh.ts.
  //
  // Nothing is requested before the scene has been on screen once, and the
  // lattice is always built for the view measured then. The frame is a
  // different size while hidden, so a grid fetched for the hidden layout would
  // be refetched for the real view at the next appearance, and two grid
  // requests inside a minute is more than Open-Meteo allows.
  useEffect(() => {
    if (!mapReady) return;
    if (debugFlags(window.location.search).weather !== 'live') return;
    let cancelled = false;
    let busy = false;
    let failures = 0;
    const restore = window.setTimeout(() => {
      if (cancelled || held.current) return;
      const saved = readStored(STORAGE_KEY, validPrecipitationGrid);
      if (!saved) return;
      held.current = saved;
      setGrid(saved);
      setNowMs(Date.now());
      setStatus('ready');
    }, 0);
    // After a failure, nothing may ask for the grid before this moment. The
    // scheduled retry honours it by construction; the scene's own appearance
    // and a visibility change must honour it too, or a display cycling through
    // the map once a minute would request a 300-coordinate grid once a minute
    // for as long as the provider kept refusing, and spend the whole day's
    // quota inside the first hour of an outage.
    let allowedAt = 0;
    let timer = 0;
    let inFlight: AbortController | null = null;
    const schedule = (at: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void load(), Math.max(1_000, at - Date.now()));
    };
    // One controller per request: a shared signal stays aborted once its
    // timeout fires, which would silently kill every later refresh on a
    // display that is never reloaded.
    const fetchJson = async (url: string, timeoutMs: number): Promise<unknown> => {
      const controller = new AbortController();
      inFlight = controller;
      const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, { signal: controller.signal, cache: 'no-cache' });
        if (!response.ok) {
          // Both URLs are Open-Meteo's. A 429 naming the daily limit becomes
          // a lockout the card and the week honour too.
          recordOpenMeteoRefusal(response.status, await response.text());
          throw new Error('HTTP ' + response.status);
        }
        return await response.json();
      } finally {
        window.clearTimeout(timeout);
        if (inFlight === controller) inFlight = null;
      }
    };
    const load = async () => {
      if (busy || cancelled || document.hidden || !view.current) return;
      const now = Date.now();
      setNowMs(now);
      // Nothing is requested in the quiet hours unless there is nothing on
      // screen at all. Whatever is already loaded keeps playing.
      if (isQuietHours(now) && held.current) {
        schedule(quietHoursEnd(now));
        return;
      }
      // Open-Meteo has said the quota is spent, to this component or to the
      // card or the week: nothing is asked, not even the metadata, until it
      // resets. The stored run keeps playing for as long as its frames last.
      const lockout = openMeteoLockout(now);
      if (lockout) {
        if (!held.current) setStatus('error');
        allowedAt = lockout.until;
        schedule(lockout.until + 1_000);
        return;
      }
      busy = true;
      let run: ModelRun | null = null;
      try {
        try {
          run = parseModelRun(await fetchJson(MODEL_META_URL, 10_000));
        } catch {
          // Unreadable metadata is not fatal: the grid falls back to a plain
          // three-hour cadence until it can be read again.
          run = null;
        }
        if (cancelled) return;
        if (shouldFetchGrid({ now, grid: held.current, run, view: view.current, covers: coversView })) {
          const spec = gridForView(view.current ?? MAP_BOUNDS);
          try {
            const parsed = parsePrecipitationGrid(await fetchJson(precipitationGridUrl(spec), 15_000), spec, run?.initialised ?? null, Date.now());
            if (!parsed) throw new Error('Invalid forecast grid');
            if (cancelled) return;
            failures = 0;
            held.current = parsed;
            setGrid(parsed);
            setNowMs(Date.now());
            setStatus('ready');
            writeStored(STORAGE_KEY, parsed);
          } catch {
            // A failed refresh keeps the previous forecast on screen. It is
            // still a forecast, and its own frame times say how much is left.
            failures += 1;
            if (!cancelled && !held.current) setStatus('error');
          }
        }
      } finally {
        busy = false;
        if (!cancelled) {
          // After a failure, retry soon and back off (5, 10, 20, 40, then 60
          // minutes) so a rate limit or an outage is picked up again as soon
          // as it clears; otherwise wait for the next run. A refusal that
          // named its limit has said when that is, and the retry waits for it.
          const backoff = Date.now() + Math.min(CHECK_RETRY_MS * 2 ** Math.max(0, failures - 1), 60 * 60_000);
          const retry = Math.max(backoff, (openMeteoLockout(Date.now())?.until ?? 0) + 1_000);
          allowedAt = failures ? retry : 0;
          schedule(failures ? retry : nextCheckAt(Date.now(), run));
        }
      }
    };
    refresh.current = () => { if (Date.now() >= allowedAt) void load(); };
    void load();
    const clock = window.setInterval(() => setNowMs(Date.now()), 60_000);
    const resume = () => { if (!document.hidden && Date.now() >= allowedAt) void load(); };
    // Coming back online is the one event that makes an earlier failure moot.
    const online = () => { allowedAt = 0; resume(); };
    window.addEventListener('online', online);
    document.addEventListener('visibilitychange', resume);
    return () => {
      cancelled = true;
      refresh.current = () => undefined;
      inFlight?.abort();
      window.clearTimeout(restore);
      window.clearTimeout(timer);
      window.clearInterval(clock);
      window.removeEventListener('online', online);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [mapReady]);

  // The next six hours of whatever is still ahead of now. Twelve are held, so
  // the window stays six hours long between refreshes; after a night without
  // one, the part of the sequence that is already over is skipped.
  const frames = useMemo(() => grid && nowMs ? displayFrames(grid, nowMs) : [], [grid, nowMs]);
  const wet = useMemo(() => hasPrecipitation(frames), [frames]);
  const ticks = useMemo(() => timelineTicks(frames), [frames]);
  // What the provider actually said, and how the field moves between one
  // saying and the next. The fifteen-minute frames repeat each hour's field
  // four times over, so these are the twelve states behind the forty-eight
  // (lib/precipitation-flow.ts).
  //
  // Both are taken from the whole grid rather than from the displayed window,
  // and so are computed once per model run. The window is recomputed every
  // minute as the clock moves, and searching for the displacements is the only
  // step here that costs anything; hanging them off the window would have run
  // that search every minute instead of every three hours.
  const states = useMemo(() => grid ? distinctStates(grid.frames) : [], [grid]);
  const flows = useMemo(() => grid ? steadyFlows(estimateFlows(states, grid.columns, grid.rows, grid.spacingKm)) : [],
    [grid, states]);
  // The span the sequence plays over. Scalars rather than the array, so the
  // loop below is rebuilt when the window really shifts and not every minute.
  const spanStart = frames.length ? frames[0].timestamp : 0;
  const spanEnd = frames.length ? frames[frames.length - 1].timestamp : 0;
  const moment = spanStart ? momentAt(spanStart, spanEnd, progress) : 0;
  const playhead = progress;
  const clock = moment ? frameTime.format(new Date(moment)) : null;
  // Screen readers get the sentence the timeline replaces, since a playhead
  // position means nothing without sight of it.
  const spoken = useMemo(() => {
    if (!moment) return 'Loading';
    const minutes = Math.max(0, Math.round((moment - nowMs) / 60000));
    return 'Forecast for ' + frameTime.format(new Date(moment))
      + (minutes < 60 ? ', in ' + minutes + ' minutes' : ', in ' + Math.round(minutes / 60) + ' hours');
  }, [moment, nowMs]);

  // The map never pans or zooms, so the overlay is a plain canvas sized to the
  // map container and addressed in container pixels. Each moment is written as
  // a tiny image, one pixel per grid cell, and drawn scaled over the grid's
  // bounds with the browser's own smoothing. That turns the 3 km cells into a
  // continuous field instead of a mosaic without asking the model for detail
  // it does not have, and costs one drawImage.
  //
  // The loop runs on animation frames and paints at most every MIN_DRAW_MS,
  // and it reads its position from the clock rather than counting ticks. An
  // interval that also had to drive a React render bunched up whenever the
  // page was busy; here a late frame lands where it belongs instead of behind.
  // React hears about the position only every PLAYHEAD_MS, which is all the
  // playhead and its label need.
  //
  // A continuous loop, no moment held. A static image of now tells you nothing
  // a number could not; the movement is the whole point of drawing this on a
  // map.
  useEffect(() => {
    const surface = overlay.current;
    const nextMap = map.current;
    if (!surface || !nextMap || !mapReady || !grid || !states.length) return;
    const context = surface.getContext('2d');
    if (!context) return;
    const { columns, rows, bounds } = grid;
    const source = image.current ?? (image.current = document.createElement('canvas'));
    if (source.width !== columns || source.height !== rows) {
      source.width = columns;
      source.height = rows;
    }
    const pixels = source.getContext('2d');
    if (!pixels) return;
    const paint = (at: number) => {
      // The bitmap must match the element's own CSS box, not Leaflet's idea of
      // the map size. The two diverge whenever the scene changes the layout, and
      // a mismatched bitmap is silently scaled to fit, which moves every cell
      // away from the coastline it belongs to. Reading it here means each paint
      // corrects itself without a resize listener to leak.
      const width = surface.clientWidth;
      const height = surface.clientHeight;
      if (!width || !height) return;
      if (surface.width !== width || surface.height !== height) {
        surface.width = width;
        surface.height = height;
      }
      context.clearRect(0, 0, width, height);
      const data = pixels.createImageData(columns, rows);
      // Cells run row-major from the south-west; image rows run from the top.
      advectedCells(states, flows, columns, rows, at).forEach((millimetres, index) => {
        const row = rows - 1 - Math.floor(index / columns);
        data.data.set(precipitationColour(millimetres), (row * columns + index % columns) * 4);
      });
      pixels.putImageData(data, 0, 0);
      const topLeft = nextMap.latLngToContainerPoint([bounds.north, bounds.west]);
      const bottomRight = nextMap.latLngToContainerPoint([bounds.south, bounds.east]);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(source, topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
    };
    // Off screen, or with nothing to travel over, one still picture is all
    // there is to draw and there is no reason to keep a loop running for it.
    // Leaving the scene arms the restart, so the next appearance begins at the
    // first forecast moment however far this one got.
    if (!active || !(spanEnd > spanStart)) {
      wasActive.current = false;
      played.current = 0;
      paint(spanStart || states[0].timestamp);
      return;
    }
    // The scene has just come round rather than the loop being rebuilt under
    // it: play from the beginning. The playhead follows on the loop's first
    // paint, one animation frame from here, rather than being set from the
    // effect body, which would cost a cascading render on every appearance.
    if (!wasActive.current) played.current = 0;
    wasActive.current = true;
    const began = performance.now() - played.current;
    let painted = -Infinity;
    let told = -Infinity;
    let frame = 0;
    const tick = (now: number) => {
      if (now - painted >= MIN_DRAW_MS) {
        painted = now;
        played.current = now - began;
        const { progress: at, done } = sequencePosition(played.current, MAP_MS, SEQUENCE_LOOPS);
        paint(momentAt(spanStart, spanEnd, at));
        // Both passes are played: hold the last moment rather than setting off
        // again. Nothing schedules another frame from here.
        if (done) {
          setProgress(at);
          return;
        }
        if (now - told >= PLAYHEAD_MS) {
          told = now;
          setProgress(at);
        }
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [active, mapReady, grid, states, flows, spanStart, spanEnd]);

  // The scene is laid out differently while it is hidden (the mini transit
  // strip only appears once it is on screen), so the map is measured and
  // fitted again each time it appears. The first appearance starts the
  // scheduler; after that, the grid is refetched only if the view now reaches
  // past it, and otherwise nothing is requested.
  //
  // Measured again when the map becomes ready, not only when the scene
  // appears: a scene that is on screen before Leaflet has loaded (the pinned
  // debug view, or a slow first cycle) would otherwise never be measured, the
  // scheduler would find no view to request for, and the map would say
  // "Loading forecast" until the scene next came round.
  useEffect(() => {
    if (!active || !mapReady) return;
    const resize = window.requestAnimationFrame(() => {
      const nextMap = map.current;
      if (!nextMap) return;
      nextMap.invalidateSize({ animate: false });
      nextMap.fitBounds([[MAP_BOUNDS.south, MAP_BOUNDS.west], [MAP_BOUNDS.north, MAP_BOUNDS.east]], FIT_OPTIONS);
      view.current = viewBounds() ?? view.current ?? MAP_BOUNDS;
      // `?weather=demo` never asks a provider anything; it draws the synthetic
      // run instead, built for the view that was just measured so it fills the
      // frame exactly as a real grid would.
      if (debugFlags(window.location.search).weather === 'demo') {
        if (held.current) return;
        const demo = demoGrid(gridForView(view.current), Date.now());
        held.current = demo;
        setGrid(demo);
        setNowMs(Date.now());
        setStatus('ready');
        return;
      }
      // The first measurement arms the scheduler whatever is in hand, and
      // after that only a view that has outgrown the grid asks for anything.
      //
      // Nothing else can arm it. The scheduler's own opening pass runs before
      // this frame, finds no view yet, and returns without booking a timer, so
      // leaving the arming to the test below meant a page that restored a grid
      // from storage never scheduled anything at all. That restore is a
      // timeout against this animation frame and usually wins: measured over
      // eight reloads, seven left the map with no pending timer, replaying the
      // stored run until its last frame passed and then sitting on "forecast
      // expired" for good, while the card and the week strip kept refreshing
      // on their own intervals. Arming costs a kilobyte of CDN-cached
      // metadata; the grid is still only fetched when that names a new run.
      if (!started.current || !held.current || !coversView(held.current.bounds, view.current)) {
        started.current = true;
        refresh.current();
      }
    });
    return () => window.cancelAnimationFrame(resize);
  }, [active, mapReady]);

  const expired = status === 'ready' && !!grid && !frames.length;
  return <section className={'panel-scene forecast-map-scene' + (active ? ' is-active' : '')} aria-hidden={!active}
    aria-label={'Forecast precipitation for the next ' + GRID_HOURS + ' hours around Home, Copenhagen and Hillerød'}>
    <div className="forecast-map-frame">
      <div className="forecast-map-canvas" ref={canvas} role="img" aria-label={'Forecast precipitation map. ' + spoken} />
      <canvas className="forecast-map-overlay" ref={overlay} aria-hidden="true" />
      {!!moment && !!ticks.length && <div className="forecast-map-timeline" aria-hidden="true">
        <div className="timeline-track">
          {ticks.map(tick => <i key={tick.timestamp} style={{ left: (tick.position * 100).toFixed(2) + '%' }} />)}
          <span className="timeline-played" style={{ width: (playhead * 100).toFixed(2) + '%' }} />
          <time className="timeline-playhead" style={{ left: (playhead * 100).toFixed(2) + '%' }}
            dateTime={new Date(moment).toISOString()}>{clock}</time>
        </div>
        <div className="timeline-hours">
          {ticks.map(tick => <span key={tick.timestamp} style={{ left: (tick.position * 100).toFixed(2) + '%' }}>{tick.label}</span>)}
        </div>
      </div>}
      {(status === 'loading' || status === 'error') && <p className="forecast-map-message">
        {status === 'loading' ? 'Loading forecast…' : 'Forecast map temporarily unavailable'}
      </p>}
      {status === 'ready' && !!frames.length && !wet && <p className="forecast-map-message">No precipitation forecast in the next {GRID_HOURS} hours</p>}
      {expired && <p className="forecast-map-stale" role="status">Forecast expired · waiting for the next model run</p>}
      <div className="forecast-map-legend" aria-label="Precipitation intensity from light to heavy">
        <span>Light</span><i /><span>Heavy</span>
      </div>
      <footer className="forecast-map-credit">
        <a href="https://open-meteo.com/en/docs/dmi-api" target="_blank" rel="noreferrer" tabIndex={active ? 0 : -1}>Forecast DMI via Open-Meteo</a><span>·</span>
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" tabIndex={active ? 0 : -1}>© OpenStreetMap</a>
      </footer>
    </div>
  </section>;
}
