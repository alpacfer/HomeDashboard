'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudMoon, CloudOff, CloudRain, CloudSnow, CloudSun, Droplet, Moon, Sun } from 'lucide-react';
import { buildForecasts, isRainCode, validWeather, type Weather } from './weather';
import RotatingPanel from './rotating-panel';
import Clock from './clock';
import KeepAwake from './keep-awake';

const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast?latitude=55.73825&longitude=12.53836&current=temperature_2m,weather_code,is_day&hourly=temperature_2m,weather_code,is_day,precipitation_probability&forecast_days=2&timeformat=unixtime&timezone=Europe%2FCopenhagen&models=dmi_seamless';
const WEATHER_REFRESH_MS = 15 * 60 * 1000;
const timeFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Copenhagen', hour: '2-digit', minute: '2-digit', hour12: false });

function condition(code: number, day: boolean) {
  if (code <= 1) return { label: day ? 'Clear' : 'Clear night', Icon: day ? Sun : Moon };
  if (code === 2) return { label: 'Partly cloudy', Icon: day ? CloudSun : CloudMoon };
  if (code === 3) return { label: 'Overcast', Icon: Cloud };
  if (code === 45 || code === 48) return { label: 'Fog', Icon: CloudFog };
  if (code >= 51 && code <= 57) return { label: 'Drizzle', Icon: CloudDrizzle };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { label: 'Snow', Icon: CloudSnow };
  if (code >= 95) return { label: 'Thunderstorms', Icon: CloudLightning };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { label: 'Rain', Icon: CloudRain };
  return { label: 'Weather unavailable', Icon: CloudOff };
}

export default function Home() {
  const [now, setNow] = useState<Date | null>(null);
  const [weather, setWeather] = useState<Weather | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [forecastIndex, setForecastIndex] = useState(0);
  const activeRequest = useRef(false);
  const lastRequestAt = useRef(0);
  const loadWeather = useCallback(async (force = false) => {
    if (activeRequest.current) return;
    if (!force && Date.now() - lastRequestAt.current < WEATHER_REFRESH_MS) return;
    activeRequest.current = true;
    lastRequestAt.current = Date.now();
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(WEATHER_URL, { signal: controller.signal });
      if (!response.ok) throw new Error('Weather unavailable');
      const data = await response.json();
      if (!validWeather(data)) throw new Error('Invalid weather');
      setWeather(data);
      setUpdatedAt(new Date());
      setStatus('ready');
    } catch {
      setStatus('error');
    } finally {
      window.clearTimeout(timeout);
      activeRequest.current = false;
    }
  }, []);

  useEffect(() => {
    const start = window.setTimeout(() => {
      setNow(new Date());
      void loadWeather();
    }, 0);
    const clock = window.setInterval(() => setNow(new Date()), 1000);
    const weatherRefresh = window.setInterval(loadWeather, WEATHER_REFRESH_MS);
    const resume = () => {
      setNow(new Date());
      if (!document.hidden) void loadWeather();
    };
    const key = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.closest?.('a')) return;
      if (event.key === 'Enter' || event.key === 'r' || event.key === 'R') void loadWeather(true);
    };
    window.addEventListener('online', resume);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('keydown', key);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(clock);
      window.clearInterval(weatherRefresh);
      window.removeEventListener('online', resume);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('keydown', key);
    };
  }, [loadWeather]);

  const minuteStamp = now ? Math.floor(now.getTime() / 60000) : null;
  const forecasts = useMemo(() => weather && minuteStamp !== null ? buildForecasts(weather, new Date(minuteStamp * 60000)) : [], [weather, minuteStamp]);
  const activeForecastIndex = Math.min(forecastIndex, Math.max(0, forecasts.length - 1));
  const forecast = forecasts[activeForecastIndex] ?? null;
  const current = weather ? condition(weather.current.weather_code, weather.current.is_day === 1) : { label: 'Weather unavailable', Icon: CloudOff };
  const Icon = current.Icon;
  const weatherDescription = weather ? Math.round(weather.current.temperature_2m) + ' degrees Celsius, ' + current.label : 'Weather unavailable';
  const staleDescription = status === 'error' ? (updatedAt ? 'Last updated at ' + timeFormat.format(updatedAt) + '. Press OK to retry.' : 'Press OK to retry.') : '';
  const fresh = status === 'ready' && now && updatedAt && now.getTime() - updatedAt.getTime() < 30 * 60000;
  const raining = !!(fresh && weather && isRainCode(weather.current.weather_code));

  useEffect(() => {
    if (forecasts.length < 2) return;
    const cycle = window.setInterval(() => setForecastIndex(index => (index + 1) % forecasts.length), 8_000);
    return () => window.clearInterval(cycle);
  }, [forecasts.length]);

  return (
    <main className="dashboard">
      <KeepAwake />
      <aside className="display-shell" aria-label="Clock and weather">
      <Clock now={now} />
      <section className={'weather-band' + (status === 'error' ? ' stale' : '')} aria-label={'Weather. ' + staleDescription}>
        <div className={'weather' + (raining ? ' raining-now' : '')} aria-label={weatherDescription}>
        <a className="weather-icon" href="https://open-meteo.com/en/docs/dmi-api" target="_blank" rel="noreferrer" aria-label={current.label + '. DMI forecast via Open-Meteo, CC BY 4.0.'} title={current.label + ' · DMI forecast via Open-Meteo'}>
          <Icon strokeWidth={2.3} aria-hidden="true" />
        </a>
        <p className="temperature" aria-hidden="true">{weather ? Math.round(weather.current.temperature_2m) : '—'}<span>°</span></p>
        {raining && <strong className="rain-now-label">{current.label === 'Drizzle' ? 'Drizzle now' : current.label === 'Thunderstorms' ? 'Storms now' : 'Raining now'}</strong>}
        {status === 'error' && <span className="offline-dot" role="status" aria-label={staleDescription} title={staleDescription} />}
        </div>
        <div className="forecast-summary">
          <h2>{forecast?.day === 'tomorrow' ? 'Tomorrow' : 'Today'}</h2>
        </div>
        {forecast && forecast.slots.length ? <div className="forecast-timeline">
          {forecast.slots.map(slot => {
            const detail = condition(slot.code, slot.day);
            const SlotIcon = detail.Icon;
            const wet = (slot.rain !== null && slot.rain > 0) || isRainCode(slot.code);
            const rainLabel = slot.rain === null ? 'Precipitation probability unavailable' : 'Highest hourly precipitation chance ' + slot.rain + '%';
            return <div className={'forecast-slot' + (wet ? ' wet' : '') + (isRainCode(slot.code) || (slot.rain ?? 0) >= 50 ? ' rain-likely' : '')} key={slot.timestamp} aria-label={slot.label + ', ' + Math.round(slot.temperature) + ' degrees, ' + detail.label + '. ' + rainLabel} title={rainLabel}>
              <time>{slot.label}</time>
              <SlotIcon className="forecast-icon" strokeWidth={2} aria-hidden="true" />
              <strong className="slot-temperature">{Math.round(slot.temperature)}°</strong>
              <div className="rain-detail" aria-hidden="true">
                <div className="rain-chance">{wet ? <><Droplet />{slot.rain === null ? 'Rain' : slot.rain + '%'}</> : slot.rain === null ? '?' : ''}</div>
                {wet && <div className="rain-track"><span style={{ width: slot.rain === null ? '100%' : Math.max(5, slot.rain) + '%' }} /></div>}
              </div>
            </div>;
          })}
        </div> : <div className="forecast-unavailable" role="status">{status === 'loading' ? '···' : 'Forecast unavailable'}</div>}
      </section>
      </aside>
      <RotatingPanel />
    </main>
  );
}
