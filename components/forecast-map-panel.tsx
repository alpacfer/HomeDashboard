'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Map } from 'leaflet';
import {
  cellAt, cellBand, frameInterval, futureFrames, GRID_HOURS, hasPrecipitation, isQuietHours, MAP_BOUNDS,
  parsePrecipitationGrid, playheadPosition, precipitationGridUrl, SEQUENCE_LOOPS, timelineTicks,
  type GridFrame, type PrecipitationGrid,
} from '@/lib/precipitation-grid';
import { MAP_MS } from '@/lib/panel-rotation';

// The grid is model output that updates hourly at best, so refetching faster
// buys nothing, and one request carries 270 coordinates. Hourly keeps this far
// inside Open-Meteo's fair use even if every coordinate counts as a call.
const REFRESH_MS = 60 * 60 * 1000;
const HOME: [number, number] = [55.73825, 12.53836];
const PLACES: Array<{ label: string; coordinates: [number, number]; home?: boolean }> = [
  { label: 'Home', coordinates: HOME, home: true },
  { label: 'Copenhagen', coordinates: [55.6761, 12.5683] },
  { label: 'Hillerød', coordinates: [55.9279, 12.3008] },
];
// The same intensity bands as the pinned forecast ribbon, so a colour means the
// same thing on the map as it does in the panel. Alpha keeps the coastline
// readable underneath.
const BAND_FILL: Record<string, string> = {
  trace: 'rgba(63,107,133,.62)',
  light: 'rgba(79,147,184,.72)',
  moderate: 'rgba(116,202,255,.78)',
  heavy: 'rgba(184,228,255,.85)',
};
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
  const map = useRef<Map | null>(null);
  const leaflet = useRef<typeof import('leaflet') | null>(null);
  const hasGrid = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [grid, setGrid] = useState<PrecipitationGrid | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [status, setStatus] = useState<MapStatus>('loading');
  const [nowMs, setNowMs] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void import('leaflet').then(L => {
      if (cancelled || !canvas.current) return;
      leaflet.current = L;
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
      nextMap.fitBounds([[MAP_BOUNDS.south, MAP_BOUNDS.west], [MAP_BOUNDS.north, MAP_BOUNDS.east]], { animate: false, maxZoom: 12, padding: [18, 18] });
      map.current = nextMap;
      setMapReady(true);
    }).catch(() => {
      if (!cancelled) setStatus('error');
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      leaflet.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let pending = false;
    let inFlight: AbortController | null = null;
    const load = async () => {
      if (pending || document.hidden) return;
      setNowMs(Date.now());
      // Nobody is watching between midnight and 03:00, so the request is not
      // spent. Whatever is already loaded keeps playing.
      if (isQuietHours(Date.now()) && hasGrid.current) return;
      pending = true;
      // One controller per request: a shared signal stays aborted once its
      // timeout fires, which would silently kill every later refresh on a
      // display that is never reloaded.
      const controller = new AbortController();
      inFlight = controller;
      const timeout = window.setTimeout(() => controller.abort(), 15_000);
      try {
        const response = await fetch(precipitationGridUrl(), { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error('Forecast map unavailable');
        const parsed = parsePrecipitationGrid(await response.json());
        if (!parsed) throw new Error('Invalid forecast grid');
        if (!cancelled) {
          hasGrid.current = true;
          setGrid(parsed);
          setNowMs(Date.now());
          setStatus('ready');
        }
      } catch {
        // A failed refresh keeps the previous forecast on screen. It is still
        // a forecast, and its own frame times say how much of it is left.
        if (!cancelled && !hasGrid.current) setStatus('error');
      } finally {
        window.clearTimeout(timeout);
        if (inFlight === controller) inFlight = null;
        pending = false;
      }
    };
    void load();
    const refresh = window.setInterval(load, REFRESH_MS);
    const clock = window.setInterval(() => setNowMs(Date.now()), 60_000);
    const resume = () => { if (!document.hidden) void load(); };
    window.addEventListener('online', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      cancelled = true;
      inFlight?.abort();
      window.clearInterval(refresh);
      window.clearInterval(clock);
      window.removeEventListener('online', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, []);

  // Only frames still ahead of now are animated: after a night without a
  // refresh the start of the sequence describes hours that are already over.
  const frames = useMemo(() => grid && nowMs ? futureFrames(grid, nowMs) : [], [grid, nowMs]);
  const wet = useMemo(() => !!grid && hasPrecipitation(grid), [grid]);
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
  // map container and addressed in container pixels. That avoids Leaflet's pane
  // transforms entirely, needs no move listeners, and costs one fillRect per
  // wet cell: far cheaper than the raster tiles this panel used to draw.
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
    if (!frame) return;
    frame.cells.forEach((millimetres, index) => {
      const fill = BAND_FILL[cellBand(millimetres)];
      if (!fill) return;
      const cell = cellAt(index);
      const topLeft = nextMap.latLngToContainerPoint([cell.north, cell.west]);
      const bottomRight = nextMap.latLngToContainerPoint([cell.south, cell.east]);
      context.fillStyle = fill;
      // Rounding leaves hairline seams between neighbours, so each cell is
      // drawn a pixel wider and taller than its own box.
      context.fillRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x + 1, bottomRight.y - topLeft.y + 1);
    });
  }, [mapReady, frame, nowMs]);

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
    const resize = window.requestAnimationFrame(() => map.current?.invalidateSize({ animate: false }));
    return () => {
      window.clearInterval(timer);
      window.cancelAnimationFrame(resize);
    };
  }, [active, frames]);

  const expired = status === 'ready' && !frames.length;
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
      {status === 'ready' && !wet && <p className="forecast-map-message">No precipitation forecast in the next {GRID_HOURS} hours</p>}
      {expired && wet && <p className="forecast-map-stale" role="status">Forecast expired · waiting for the next model run</p>}
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
