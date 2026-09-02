'use client';

import { useEffect } from 'react';

const RETRY_DELAY_MS = 15_000;
const HEALTH_CHECK_MS = 60_000;

export default function KeepAwake() {
  useEffect(() => {
    let mounted = true;
    let requestPending = false;
    let wakeLock: WakeLockSentinel | null = null;
    let retryTimer: number | null = null;

    const clearRetry = () => {
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }
    };
    const scheduleRetry = () => {
      clearRetry();
      if (mounted && document.visibilityState === 'visible') {
        retryTimer = window.setTimeout(() => void requestWakeLock(), RETRY_DELAY_MS);
      }
    };
    async function requestWakeLock() {
      clearRetry();
      if (
        !mounted ||
        requestPending ||
        document.visibilityState !== 'visible' ||
        !('wakeLock' in navigator) ||
        wakeLock?.released === false
      ) return;

      requestPending = true;
      try {
        const sentinel = await navigator.wakeLock.request('screen');
        if (!mounted) {
          await sentinel.release();
          return;
        }

        wakeLock = sentinel;
        sentinel.addEventListener('release', () => {
          if (wakeLock === sentinel) wakeLock = null;
          scheduleRetry();
        }, { once: true });
      } catch {
        scheduleRetry();
      } finally {
        requestPending = false;
      }
    }

    void requestWakeLock();

    const resume = () => {
      if (document.visibilityState === 'visible') void requestWakeLock();
    };
    const retryFromInteraction = () => void requestWakeLock();
    const healthCheck = window.setInterval(() => void requestWakeLock(), HEALTH_CHECK_MS);

    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', resume);
    window.addEventListener('pageshow', resume);
    window.addEventListener('keydown', retryFromInteraction);
    window.addEventListener('pointerdown', retryFromInteraction);

    return () => {
      mounted = false;
      clearRetry();
      window.clearInterval(healthCheck);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('focus', resume);
      window.removeEventListener('pageshow', resume);
      window.removeEventListener('keydown', retryFromInteraction);
      window.removeEventListener('pointerdown', retryFromInteraction);
      const sentinel = wakeLock;
      wakeLock = null;
      if (sentinel && !sentinel.released) void sentinel.release();
    };
  }, []);

  return null;
}
