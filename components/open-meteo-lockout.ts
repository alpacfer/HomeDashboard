// The Open-Meteo lockout, shared by everything that asks Open-Meteo.
//
// The quota is counted per address, so a "daily limit exceeded" answer to the
// week strip means the card and the map would get the same answer. Each
// component checks here before it asks and records here when it is refused,
// through device storage so a reload within the same day does not ask again
// either. Storage may be disabled on the TV browser, so the last refusal is
// also kept in memory; the two are reconciled by taking whichever lasts
// longer. See lib/open-meteo-quota.ts for what a refusal means.

import { activeLockout, refusalLockout, validLockout, type Lockout } from '@/lib/open-meteo-quota';
import { readStored, writeStored } from './device-storage';

const STORAGE_KEY = 'home-dashboard:open-meteo-lockout:v1';

let remembered: Lockout | null = null;

// The lockout that binds right now, or null when Open-Meteo may be asked.
export function openMeteoLockout(now = Date.now()): Lockout | null {
  const stored = activeLockout(readStored(STORAGE_KEY, validLockout), now);
  const kept = activeLockout(remembered, now);
  if (!stored) return kept;
  if (!kept) return stored;
  return stored.until >= kept.until ? stored : kept;
}

// Called with every non-OK answer from Open-Meteo. Only a 429 becomes a
// lockout; anything else returns null and changes nothing.
export function recordOpenMeteoRefusal(status: number, body: string, now = Date.now()): Lockout | null {
  const lockout = refusalLockout(status, body, now);
  if (!lockout) return null;
  const current = openMeteoLockout(now);
  if (current && current.until >= lockout.until) return current;
  remembered = lockout;
  writeStored(STORAGE_KEY, lockout);
  return lockout;
}
