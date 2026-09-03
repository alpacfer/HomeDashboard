'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Map } from 'leaflet';
import {
  cellBand, coversView, displayFrames, frameInterval, GRID_HOURS, gridForView, hasPrecipitation, isQuietHours, MAP_BOUNDS,
  parsePrecipitationGrid, playheadPosition, precipitationGridUrl, quietHoursEnd, SEQUENCE_LOOPS, timelineTicks,
  validPrecipitationGrid, type GridFrame, type MapBounds, type PrecipitationGrid,
} from '@/lib/precipitation-grid';
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
// The same intensity bands as the pinned forecast ribbon, so a colour means the
// same thing on the map as it does in the panel. Alpha keeps the coastline
// readable underneath. Stored as bytes because they are written into an
// ImageData rather than used as fill styles.
const BAND_RGBA: Record<string, [number, number, number, number]> = {
  trace: [63, 107, 133, 158],
  light: [79, 147, 184, 184],
  moderate: [116, 202, 255, 199],
  heavy: [184, 228, 255, 217],
};
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
  const [mapReady, setMapReady] = useState(false);
  const [grid, setGrid] = useState<PrecipitationGrid | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);
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
    if (debugFlags(window.location.search).weather === 'off') return;
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
  const frame: GridFrame | null = frames.length ? frames[Math.min(frameIndex, frames.length - 1)] ?? null : null;
  const ticks = useMemo(() => timelineTicks(frames), [frames]);
  const playhead = playheadPosition(frames, frameIndex);
  const clock = frame ? frameTime.format(new Date(frame.timestamp)) : null;
  // Screen readers get the sentence the timeline replaces, since a playhead
  // position means nothing without sight of it.
  const spoken = useMemo(() => {
    if (!frame) return 'Loading';
    const minutes = Math.max(0, Math.round((frame.timestamp - nowMs) / 60000));
    return 'Forecast for ' + frameTime.format(new Date(frame.timestamp))
      + (minutes < 60 ? ', in ' + minutes + ' minutes' : ', in ' + Math.round(minutes / 60) + ' hours');
  }, [frame, nowMs]);

  // The map never pans or zooms, so the overlay is a plain canvas sized to the
  // map container and addressed in container pixels. Each frame is written as
  // a tiny image, one pixel per grid cell, and drawn scaled over the grid's
  // bounds with the browser's own smoothing. That turns the 2 km cells into a
  // continuous field instead of a mosaic without asking the model for detail
  // it does not have, and costs one drawImage per frame.
  useEffect(() => {
    const surface = overlay.current;
    const nextMap = map.current;
    if (!surface || !nextMap || !mapReady) return;
    const context = surface.getContext('2d');
    if (!context) return;
    // The bitmap must match the element's own CSS box, not Leaflet's idea of
    // the map size. The two diverge whenever the scene changes the layout, and
    // a mismatched bitmap is silently scaled to fit, which moves every cell
    // away from the coastline it belongs to. Reading it here means each frame
    // corrects itself without a resize listener to leak.
    const width = surface.clientWidth;
    const height = surface.clientHeight;
    if (!width || !height) return;
    if (surface.width !== width || surface.height !== height) {
      surface.width = width;
      surface.height = height;
    }
    context.clearRect(0, 0, width, height);
    if (!frame || !grid) return;
    const { columns, rows, bounds } = grid;
    const source = image.current ?? (image.current = document.createElement('canvas'));
    if (source.width !== columns || source.height !== rows) {
      source.width = columns;
      source.height = rows;
    }
    const pixels = source.getContext('2d');
    if (!pixels) return;
    const data = pixels.createImageData(columns, rows);
    // Cells run row-major from the south-west; image rows run from the top.
    frame.cells.forEach((millimetres, index) => {
      const rgba = BAND_RGBA[cellBand(millimetres)];
      if (!rgba) return;
      const row = rows - 1 - Math.floor(index / columns);
      data.data.set(rgba, (row * columns + index % columns) * 4);
    });
    pixels.putImageData(data, 0, 0);
    const topLeft = nextMap.latLngToContainerPoint([bounds.north, bounds.west]);
    const bottomRight = nextMap.latLngToContainerPoint([bounds.south, bounds.east]);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
  }, [mapReady, grid, frame, nowMs]);

  // A continuous loop, every frame the same length, no frame held. A static
  // image of now tells you nothing a number could not; the movement is the
  // whole point of drawing this on a map.
  useEffect(() => {
    if (!active || frames.length < 2) return;
    // Two passes of the sequence per scene, paced to whatever is left of it.
    const interval = frameInterval(frames.length, MAP_MS, SEQUENCE_LOOPS);
    if (interval <= 0) return;
    let index = 0;
    const advance = () => {
      setFrameIndex(index);
      index = (index + 1) % frames.length;
    };
    advance();
    const timer = window.setInterval(advance, interval);
    return () => window.clearInterval(timer);
  }, [active, frames]);

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
      if (!held.current || !coversView(held.current.bounds, view.current)) refresh.current();
    });
    return () => window.cancelAnimationFrame(resize);
  }, [active, mapReady]);

  const expired = status === 'ready' && !!grid && !frames.length;
  return <section className={'panel-scene forecast-map-scene' + (active ? ' is-active' : '')} aria-hidden={!active}
    aria-label={'Forecast precipitation for the next ' + GRID_HOURS + ' hours around Home, Copenhagen and Hillerød'}>
    <div className="forecast-map-frame">
      <div className="forecast-map-canvas" ref={canvas} role="img" aria-label={'Forecast precipitation map. ' + spoken} />
      <canvas className="forecast-map-overlay" ref={overlay} aria-hidden="true" />
      {frame && !!ticks.length && <div className="forecast-map-timeline" aria-hidden="true">
        <div className="timeline-track">
          {ticks.map(tick => <i key={tick.timestamp} style={{ left: (tick.position * 100).toFixed(2) + '%' }} />)}
          <span className="timeline-played" style={{ width: (playhead * 100).toFixed(2) + '%' }} />
          <time className="timeline-playhead" style={{ left: (playhead * 100).toFixed(2) + '%' }}
            dateTime={new Date(frame.timestamp).toISOString()}>{clock}</time>
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
