'use client';

import { useEffect, useState } from 'react';
import RotatingPanel from '@/components/rotating-panel';
import WeatherPanel from '@/components/weather-panel';
import WeekStrip from '@/components/week-strip';
import Clock from '@/components/clock';
import KeepAwake from '@/components/keep-awake';
import type { Conditions } from '@/lib/clock-wardrobe';
import { debugFlags, pinnedNow } from '@/lib/debug-flags';

export default function Home() {
  const [now, setNow] = useState<Date | null>(null);
  // The current hour's temperature and wetness, reported by the weather panel
  // so the clock's wardrobe and its Tenant can react to the sky without a
  // second fetch.
  const [conditions, setConditions] = useState<Conditions | null>(null);

  useEffect(() => {
    // Debug: `?time=HH:MM` pins the clock to a Copenhagen time. See lib/debug-flags.ts.
    const pinned = debugFlags(window.location.search).time;
    const tick = () => setNow(pinnedNow(pinned, new Date()));
    const start = window.setTimeout(tick, 0);
    const clock = window.setInterval(tick, 1000);
    const resume = tick;
    window.addEventListener('online', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(clock);
      window.removeEventListener('online', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, []);

  return (
    <main className="dashboard">
      <KeepAwake />
      <aside className="display-shell" aria-label="Clock and weather">
        <Clock now={now} conditions={conditions} />
        <WeatherPanel now={now} onConditions={setConditions} />
        <WeekStrip now={now} />
      </aside>
      <RotatingPanel />
    </main>
  );
}
