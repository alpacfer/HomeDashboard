'use client';

import { useEffect, useRef } from 'react';
import { FORECAST_LATITUDE, FORECAST_LONGITUDE } from '@/lib/weather';
import { retryDelay } from '@/lib/forecast-refresh';
import { penaltyUntil, readySources } from '@/lib/source-penalty';
import { describeLockout } from '@/lib/open-meteo-quota';
import { debugFlags } from '@/lib/debug-flags';
import { openMeteoLockout, recordOpenMeteoRefusal } from './open-meteo-lockout';
import { onRefreshTriggers } from './refresh-triggers';

// Ask a list of forecast providers in preference order until one answers with
// a body that parses, on a timer, with backoff, for weeks without a reload.
//
// The weather card and the week strip each had this loop written out in full,
// character for character apart from the constants and what they did with the
// answer, and the two had already drifted: only one skipped a provider that
// had just refused. The loop is subtle enough that one copy is the right
// number. What differs is passed in; what is the same lives here:
//
//   - one AbortController per request with its own deadline, never a shared
//     signal, because a signal stays aborted once it fires;
//   - `pending` so overlapping refreshes never run, cleared in finally so a
//     request that threw cannot end all refreshing;
//   - Open-Meteo is not asked while its shared quota lockout binds, and a 429
//     from it is recorded for the other panels (components/open-meteo-lockout.ts);
//   - a provider that refused is skipped for `penaltyMs`, if given, and a
//     refusal that named its own limit is honoured (lib/source-penalty.ts);
//   - on total failure, one `[tag] every provider failed: ...` line naming
//     each provider and its reason, then retry with jittered backoff
//     (lib/forecast-refresh.ts);
//   - refresh again when the page becomes visible, the network returns, or a
//     listed key is pressed (components/refresh-triggers.ts).
//
// Nothing runs unless `?weather=` is live: every debug mode makes no request,
// and the component draws its placeholder instead (lib/debug-flags.ts).

export type ChainSource = {
  name: string;
  url: (latitude: number, longitude: number) => string;
  cache: RequestCache;
};

export type ProviderChainOptions<S extends ChainSource, A> = {
  // The bracketed word the failure line starts with: '[weather]', '[week]'.
  tag: string;
  sources: readonly S[];
  refreshMs: number;
  timeoutMs: number;
  retryBaseMs: number;
  retryMaxMs: number;
  // Skip a provider that failed for this long. Omit to ask every provider
  // every time, as the hourly week strip does.
  penaltyMs?: number;
  // Keys on the remote that ask for a refresh now.
  retryKeys?: readonly string[];
  // The parsed answer, or null for a body that is not usable. Called with the
  // provider that produced it, since each provider has its own parser.
  parse: (body: unknown, entry: S) => A | null;
  onAnswer: (answer: A, entry: S) => void;
  // Every provider failed this refresh. The last good answer stays on screen;
  // this is the moment to show the dot.
  onFailure?: () => void;
};

type Attempt<A> = { answer: A } | { reason: string; until?: number };

export function useProviderChain<S extends ChainSource, A>(options: ProviderChainOptions<S, A>) {
  // The callbacks are read through a ref so a re-render never rebuilds the
  // loop: an effect keyed on them would restart the interval and the backoff
  // on every parent tick. The constants are read once, when the loop starts.
  const latest = useRef(options);
  useEffect(() => { latest.current = options; });

  useEffect(() => {
    if (debugFlags(window.location.search).weather !== 'live') return;
    const { tag, sources, refreshMs, timeoutMs, retryBaseMs, retryMaxMs, penaltyMs, retryKeys = [] } = latest.current;
    let active = true;
    let pending = false;
    let failures = 0;
    let retry = 0;
    let inFlight: AbortController | null = null;
    const penalised = new Map<string, number>();

    const attempt = async (entry: S): Promise<Attempt<A>> => {
      if (entry.name === 'Open-Meteo') {
        const lockout = openMeteoLockout();
        if (lockout) return { reason: describeLockout(lockout), until: lockout.until };
      }
      const controller = new AbortController();
      inFlight = controller;
      const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(entry.url(FORECAST_LATITUDE, FORECAST_LONGITUDE), { cache: entry.cache, signal: controller.signal });
        if (!response.ok) {
          const lockout = entry.name === 'Open-Meteo' ? recordOpenMeteoRefusal(response.status, await response.text()) : null;
          return { reason: 'HTTP ' + response.status + (lockout ? ', ' + describeLockout(lockout) : ''), until: lockout?.until };
        }
        const answer = latest.current.parse(await response.json(), entry);
        return answer === null ? { reason: 'unusable payload' } : { answer };
      } catch (error) {
        return { reason: controller.signal.aborted ? 'timeout' : error instanceof Error ? error.message : 'network error' };
      } finally {
        window.clearTimeout(timeout);
        if (inFlight === controller) inFlight = null;
      }
    };

    const load = async () => {
      if (pending || document.hidden) return;
      pending = true;
      window.clearTimeout(retry);
      try {
        const reasons: string[] = [];
        const asked = penaltyMs === undefined ? sources : readySources(sources, penalised, Date.now());
        for (const entry of asked) {
          const result = await attempt(entry);
          if (!active) return;
          if ('reason' in result) {
            reasons.push(entry.name + ': ' + result.reason);
            if (penaltyMs !== undefined) penalised.set(entry.name, penaltyUntil(Date.now(), penaltyMs, result.until));
            continue;
          }
          penalised.delete(entry.name);
          failures = 0;
          latest.current.onAnswer(result.answer, entry);
          return;
        }
        if (!active) return;
        // The one line that explains a muted card when the display is
        // inspected over remote debugging or by scripts/screenshot.mjs --console.
        console.warn(tag + ' every provider failed: ' + reasons.join('; '));
        latest.current.onFailure?.();
        failures += 1;
        retry = window.setTimeout(() => void load(), retryDelay(failures, retryBaseMs, retryMaxMs));
      } finally {
        pending = false;
      }
    };

    void load();
    const timer = window.setInterval(() => void load(), refreshMs);
    const off = onRefreshTriggers(() => void load(), { keys: retryKeys });
    return () => {
      active = false;
      inFlight?.abort();
      window.clearTimeout(retry);
      window.clearInterval(timer);
      off();
    };
  }, []);
}
