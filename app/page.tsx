'use client';

import { useEffect, useState } from 'react';
import RotatingPanel from '@/components/rotating-panel';
import WeatherPanel from '@/components/weather-panel';
import WeekStrip from '@/components/week-strip';
import Clock from '@/components/clock';
import KeepAwake from '@/components/keep-awake';
import { onRefreshTriggers } from '@/components/refresh-triggers';
import type { Conditions } from '@/lib/clock-conditions';
import { debugFlags, pinnedNow } from '@/lib/debug-flags';
import type { Rotation } from '@/lib/panel-rotation';
import type { WorldSpotId } from '@/lib/clock-tenant';
import { useSceneSky } from '@/components/use-scene-sky';

export default function Home() {
  const [now, setNow] = useState<Date | null>(null);
  // The current hour's temperature and wetness, reported by the weather panel
  // so the clock's Tenant can react to the sky without a second fetch.
  const [conditions, setConditions] = useState<Conditions | null>(null);
  const [activeScene, setActiveScene] = useState<Rotation['phase']>('transport');
  const mapSky = useSceneSky(now, null, null);
  const [petPreview] = useState<WorldSpotId | null>(() => typeof window === 'undefined' ? null : debugFlags(window.location.search).pet);
  const [petTravel] = useState<WorldSpotId | null>(() => typeof window === 'undefined' ? null : debugFlags(window.location.search).petTravel);

  useEffect(() => {
    // Debug: `?time=HH:MM` pins the clock to a Copenhagen time. See lib/debug-flags.ts.
    const flags = debugFlags(window.location.search);
    const pinned = flags.time;
    const tick = () => setNow(pinnedNow(pinned, new Date()));
    const start = window.setTimeout(tick, 0);
    const clock = window.setInterval(tick, 1000);
    // A tab that was hidden or offline has a clock that may have stopped
    // ticking; catch it up the moment either comes back.
    const off = onRefreshTriggers(tick);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(clock);
      off();
    };
  }, []);

  return (
    <main className="dashboard">
      <KeepAwake />
      <aside className="display-shell" aria-label="Clock and weather">
        <Clock now={now} conditions={conditions} activeScene={activeScene} petPreview={petPreview} petTravel={petTravel} />
        <WeatherPanel now={now} onConditions={setConditions} />
        <WeekStrip now={now} />
      </aside>
      <RotatingPanel now={now} onSceneChange={setActiveScene} mapLight={mapSky?.light ?? null} />
    </main>
  );
}
