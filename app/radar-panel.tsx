'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { LayerGroup, Map } from 'leaflet';
import { isRadarTimelineStale, parseRadarTimeline, radarApiUrl, radarFrameAgeMinutes, radarTileUrl, type RadarTimeline } from './radar';

const MAP_REFRESH_MS = 5 * 60 * 1000;
const FRAME_MS = 650;
const FINAL_FRAME_MS = 8_000;
const HOME: [number, number] = [55.73825, 12.53836];
const PLACES: Array<{ label: string; coordinates: [number, number]; home?: boolean }> = [
  { label: 'Home', coordinates: HOME, home: true },
  { label: 'Copenhagen', coordinates: [55.6761, 12.5683] },
  { label: 'Hillerød', coordinates: [55.9279, 12.3008] },
];
const frameTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Copenhagen',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

type RadarStatus = 'loading' | 'ready' | 'stale' | 'error';

export default function RadarPanel({ active }: { active: boolean }) {
  const canvas = useRef<HTMLDivElement>(null);
  const map = useRef<Map | null>(null);
  const precipitationLayer = useRef<LayerGroup | null>(null);
  const leaflet = useRef<typeof import('leaflet') | null>(null);
  const hasTimeline = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [timeline, setTimeline] = useState<RadarTimeline | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [status, setStatus] = useState<RadarStatus>('loading');
  const [nowSeconds, setNowSeconds] = useState(0);

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
      const precipitationPane = nextMap.createPane('precipitationPane');
      precipitationPane.style.zIndex = '350';
      precipitationPane.style.pointerEvents = 'none';
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        className: 'radar-basemap',
        maxZoom: 19,
        updateWhenIdle: true,
      }).addTo(nextMap);
      for (const place of PLACES) {
        L.circleMarker(place.coordinates, {
          className: 'radar-place-dot',
          color: '#f3f2ee',
          fillColor: place.home ? '#ff623b' : '#74caff',
          fillOpacity: 1,
          opacity: 1,
          radius: place.home ? 5 : 4,
          weight: 2,
        }).addTo(nextMap).bindTooltip(place.label, {
          className: 'radar-place-label',
          direction: 'right',
          offset: [7, 0],
          permanent: true,
        });
      }
      nextMap.fitBounds([[55.64, 12.18], [55.965, 12.67]], { animate: false, maxZoom: 12, padding: [18, 18] });
      map.current = nextMap;
      setMapReady(true);
    }).catch(() => {
      if (!cancelled) setStatus('error');
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      precipitationLayer.current = null;
      leaflet.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let pending = false;
    const load = async () => {
      if (pending || document.hidden) return;
      setNowSeconds(Date.now() / 1000);
      pending = true;
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetch(radarApiUrl(), { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error('Precipitation map unavailable');
        const parsed = parseRadarTimeline(await response.json(), Date.now() / 1000);
        if (!parsed) throw new Error('Invalid precipitation map');
        if (!cancelled) {
          hasTimeline.current = true;
          setTimeline(parsed);
          setFrameIndex(parsed.frames.length - 1);
          setNowSeconds(Date.now() / 1000);
          setStatus('ready');
        }
      } catch {
        if (!cancelled) setStatus(hasTimeline.current ? 'stale' : 'error');
      } finally {
        window.clearTimeout(timeout);
        pending = false;
      }
    };
    void load();
    const refresh = window.setInterval(load, MAP_REFRESH_MS);
    const ageCheck = window.setInterval(() => setNowSeconds(Date.now() / 1000), 60_000);
    const resume = () => { if (!document.hidden) void load(); };
    window.addEventListener('online', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      cancelled = true;
      window.clearInterval(refresh);
      window.clearInterval(ageCheck);
      window.removeEventListener('online', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, []);

  const visibleFrame = timeline?.frames[Math.min(frameIndex, (timeline.frames.length || 1) - 1)] ?? null;
  const timestamp = useMemo(() => visibleFrame ? frameTime.format(new Date(visibleFrame.time * 1000)) : '—:—', [visibleFrame]);
  const latestFrame = timeline?.frames.at(-1);
  const isLatest = visibleFrame === latestFrame;
  const ageMinutes = visibleFrame ? radarFrameAgeMinutes(visibleFrame, nowSeconds) : 0;
  const staleByAge = timeline ? isRadarTimelineStale(timeline, nowSeconds) : false;
  const frameLabel = `${isLatest ? 'Latest radar' : 'Radar replay'} · ${timestamp} · ${ageMinutes} min ago`;

  useEffect(() => {
    const L = leaflet.current;
    const nextMap = map.current;
    if (!L || !nextMap || !mapReady) return;
    if (!visibleFrame || !timeline) {
      precipitationLayer.current?.removeFrom(nextMap);
      precipitationLayer.current = null;
      return;
    }
    precipitationLayer.current?.removeFrom(nextMap);
    const layer = L.layerGroup();
    L.tileLayer(radarTileUrl(timeline.host, visibleFrame), {
      className: 'radar-precipitation',
      maxNativeZoom: 7,
      maxZoom: 12,
      opacity: 0.84,
      pane: 'precipitationPane',
      tileSize: 256,
    }).addTo(layer);
    layer.addTo(nextMap);
    precipitationLayer.current = layer;
  }, [mapReady, timeline, visibleFrame]);

  useEffect(() => {
    if (!active || !timeline?.frames.length) return;
    // Lead with the newest frame whenever the panel appears, then replay the
    // history chronologically. Hold the newest image longer than the replay.
    let index = timeline.frames.length - 1;
    let timer: number;
    const advance = () => {
      setFrameIndex(index);
      timer = window.setTimeout(advance, index === timeline.frames.length - 1 ? FINAL_FRAME_MS : FRAME_MS);
      index = (index + 1) % timeline.frames.length;
    };
    timer = window.setTimeout(advance, 0);
    const resize = window.requestAnimationFrame(() => map.current?.invalidateSize({ animate: false }));
    return () => {
      window.clearTimeout(timer);
      window.cancelAnimationFrame(resize);
    };
  }, [active, timeline]);

  return <section className={'panel-scene radar-scene' + (active ? ' is-active' : '')} aria-hidden={!active} aria-label="Animated precipitation radar for Copenhagen and North Zealand">
    <div className="radar-map-frame">
      <div className="radar-map-canvas" ref={canvas} role="img" aria-label={'Precipitation radar around Home, Copenhagen and Hillerød. ' + frameLabel} />
      {visibleFrame && <time className="radar-timestamp" dateTime={new Date(visibleFrame.time * 1000).toISOString()}>
        <span />{frameLabel}
      </time>}
      {(status === 'loading' || status === 'error') && <p className="radar-message">{status === 'loading' ? 'Loading precipitation…' : 'Precipitation map temporarily unavailable'}</p>}
      {(status === 'stale' || staleByAge) && <p className="radar-stale" role="status">{staleByAge && latestFrame ? `Radar delayed · newest frame ${radarFrameAgeMinutes(latestFrame, nowSeconds)} min ago` : 'Radar update failed · showing saved frames'}</p>}
      <div className="radar-legend" aria-label="Precipitation intensity from light to heavy">
        <span>Light</span><i /><span>Heavy</span>
      </div>
      <footer className="radar-credit">
        <a href="https://www.rainviewer.com/" target="_blank" rel="noreferrer" tabIndex={active ? 0 : -1}>Weather data by RainViewer</a><span>·</span>
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" tabIndex={active ? 0 : -1}>© OpenStreetMap</a>
      </footer>
    </div>
  </section>;
}
