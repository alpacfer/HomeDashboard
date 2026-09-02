'use client';

import { useEffect, useState } from 'react';
import RotatingPanel from '@/components/rotating-panel';
import WeatherPanel from '@/components/weather-panel';
import Clock from '@/components/clock';
import KeepAwake from '@/components/keep-awake';

export default function Home() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const start = window.setTimeout(() => setNow(new Date()), 0);
    const clock = window.setInterval(() => setNow(new Date()), 1000);
    const resume = () => setNow(new Date());
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
        <Clock now={now} />
        <WeatherPanel now={now} />
      </aside>
      <RotatingPanel />
    </main>
  );
}
