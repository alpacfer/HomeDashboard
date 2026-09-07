// Which providers to ask this refresh, given who refused recently.
//
// The weather card asks its providers in preference order and skips one that
// failed for a while, so a multi-day outage upstream does not cost a request
// every refresh. Two rules, both of which used to live inside the component's
// effect where nothing could test them: a penalty that has expired no longer
// counts, and if every provider is penalised they are all asked anyway,
// because a stale penalty must never outrank having no forecast at all.

export function readySources<S extends { name: string }>(sources: readonly S[], penalised: ReadonlyMap<string, number>, now: number): S[] {
  const ready = sources.filter(entry => (penalised.get(entry.name) ?? 0) <= now);
  return ready.length ? ready : [...sources];
}

// Until when a provider that just refused is left alone. A refusal that named
// its own limit (an Open-Meteo quota lockout) is honoured; otherwise the
// standard penalty applies.
export function penaltyUntil(now: number, penaltyMs: number, until?: number): number {
  return until ?? now + penaltyMs;
}
