'use client';

import { useEffect, useState } from 'react';
import { forecastMapUrl } from './radar';

const FORECAST_MAP_URL = forecastMapUrl();

export default function RadarPanel({ active }: { active: boolean }) {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!active || loaded) return;
    const start = window.setTimeout(() => setLoaded(true), 0);
    return () => window.clearTimeout(start);
  }, [active, loaded]);

  return <section className={'panel-scene radar-scene' + (active ? ' is-active' : '')} aria-hidden={!active} aria-label="Animated future rain forecast for Copenhagen and North Zealand">
    <div className="radar-map-frame windy-map-frame">
      {loaded
        ? <iframe
            className="windy-map"
            src={FORECAST_MAP_URL}
            title="Future rain forecast for Copenhagen and North Zealand"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        : <p className="radar-message">Loading forecast map…</p>}
      <div className="forecast-map-label" aria-hidden="true"><span />Future rain</div>
    </div>
  </section>;
}
