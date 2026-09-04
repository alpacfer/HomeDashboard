// The Tenant's small "mind". It does not animate anything; it keeps slow
// drives, remembers what just happened and scores the next activity. The
// component only asks for a decision when the Tenant is free, so this costs no
// per-frame work and remains deterministic in tests.

import type { Mood, WorldSpotId } from './clock-tenant';
import type { Rotation } from './panel-rotation';

export type PetActivityKey = 'idle' | 'pause' | 'perch' | `roam:${WorldSpotId}`;
export type PetStimulus = 'minute' | 'hour' | 'weather';

export type PetMind = {
  energy: number;
  curiosity: number;
  adventure: number;
  sceneInterest: number;
  focus: Rotation['phase'];
  recent: PetActivityKey[];
};

export type PetDecision =
  | { kind: 'idle' }
  | { kind: 'pause' }
  | { kind: 'perch' }
  | { kind: 'roam'; spot: WorldSpotId };

export type PetDecisionContext = {
  mood: Mood;
  scene: Rotation['phase'];
  spots: readonly WorldSpotId[];
  canAdventure: boolean;
};

export function initialPetMind(scene: Rotation['phase'] = 'transport'): PetMind {
  return { energy: 0.72, curiosity: 0.35, adventure: 0.2, sceneInterest: 0.25, focus: scene, recent: [] };
}

// A new screen is a stimulus, not an immediate command to run across the UI.
// Interest stays high until a later decision, while adventure builds slowly;
// together they make the Tenant visit some screen changes rather than all of
// them like clockwork.
export function noticePetScene(mind: PetMind, scene: Rotation['phase']): PetMind {
  if (mind.focus === scene) return mind;
  return { ...mind, focus: scene, sceneInterest: Math.max(0.72, mind.sceneInterest) };
}

// Clock and weather changes alter drives, never prescribe an animation. The
// next ordinary decision may answer them with any available activity, or may
// simply pause; this keeps external events as context rather than a script.
export function noticePetStimulus(mind: PetMind, stimulus: PetStimulus): PetMind {
  if (stimulus === 'hour') return {
    ...mind,
    curiosity: clamp01(mind.curiosity + 0.2),
    adventure: clamp01(mind.adventure + 0.12),
    sceneInterest: clamp01(mind.sceneInterest + 0.08),
  };
  if (stimulus === 'weather') return {
    ...mind,
    curiosity: clamp01(mind.curiosity + 0.16),
    sceneInterest: clamp01(mind.sceneInterest + 0.1),
  };
  return { ...mind, curiosity: clamp01(mind.curiosity + 0.08) };
}

export function advancePetMind(mind: PetMind, elapsedMs: number, mood: Mood): PetMind {
  const elapsed = Math.max(0, Math.min(elapsedMs, 60_000));
  const weatherComfort = mood === 'awake' ? 1 : mood === 'asleep' ? 0 : 0.55;
  return {
    ...mind,
    energy: clamp01(mind.energy + elapsed / (mood === 'asleep' ? 180_000 : 900_000)),
    curiosity: clamp01(mind.curiosity + elapsed / 210_000),
    adventure: clamp01(mind.adventure + elapsed / (150_000 / weatherComfort || 1)),
    sceneInterest: clamp01(mind.sceneInterest + elapsed / 600_000),
  };
}

// A tiny utility selector. Recent activities are suppressed, low energy makes
// pausing attractive, and low drives make adventures unlikely without making
// them impossible. The current scene's landmark is preferred, but every
// measured destination remains available.
export function choosePetActivity(mind: PetMind, context: PetDecisionContext, random: number): PetDecision {
  const candidates: { decision: PetDecision; key: PetActivityKey; weight: number }[] = [
    { decision: { kind: 'idle' }, key: 'idle', weight: 48 + mind.energy * 18 + mind.curiosity * 8 },
    { decision: { kind: 'pause' }, key: 'pause', weight: 7 + (1 - mind.energy) * 34 },
  ];

  if (context.canAdventure) {
    candidates.push({
      decision: { kind: 'perch' }, key: 'perch',
      weight: 0.6 + mind.adventure ** 2 * 28 + mind.curiosity * 5,
    });
  }
  if (context.canAdventure && context.spots.length) {
    const preferred = sceneSpot(context.scene);
    const spot = pickSpot(context.spots, preferred, mind.sceneInterest, splitRandom(random));
    candidates.push({
      decision: { kind: 'roam', spot }, key: `roam:${spot}`,
      weight: 0.25 + mind.adventure ** 3 * 32 + mind.curiosity * mind.adventure * 8 + mind.sceneInterest * mind.adventure * 18,
    });
  }

  const weighted = candidates.map(candidate => ({
    ...candidate,
    weight: candidate.weight * (mind.recent.includes(candidate.key) ? 0.16 : 1),
  }));
  let cursor = clampRandom(random) * weighted.reduce((sum, candidate) => sum + candidate.weight, 0);
  for (const candidate of weighted) {
    cursor -= candidate.weight;
    if (cursor < 0) return candidate.decision;
  }
  return weighted[0].decision;
}

export function commitPetActivity(mind: PetMind, decision: PetDecision): PetMind {
  const key: PetActivityKey = decision.kind === 'roam' ? `roam:${decision.spot}` : decision.kind;
  const recent = [key, ...mind.recent.filter(item => item !== key)].slice(0, 4);
  if (decision.kind === 'roam') return {
    ...mind, energy: clamp01(mind.energy - 0.16), curiosity: clamp01(mind.curiosity - 0.5),
    adventure: 0, sceneInterest: 0, recent,
  };
  if (decision.kind === 'perch') return {
    ...mind, energy: clamp01(mind.energy - 0.09), curiosity: clamp01(mind.curiosity - 0.25),
    adventure: clamp01(mind.adventure - 0.48), recent,
  };
  if (decision.kind === 'pause') return { ...mind, energy: clamp01(mind.energy + 0.045), recent };
  return { ...mind, energy: clamp01(mind.energy - 0.012), recent };
}

export function petDecisionDelay(random: number, energy: number): number {
  const base = 2800 + clampRandom(random) * 4200;
  return Math.round(base + (1 - clamp01(energy)) * 1800);
}

function sceneSpot(scene: Rotation['phase']): WorldSpotId {
  return scene;
}

function pickSpot(spots: readonly WorldSpotId[], preferred: WorldSpotId, interest: number, random: number): WorldSpotId {
  const weights = spots.map(spot => 1 + (spot === preferred ? 1 + clamp01(interest) * 5 : 0));
  let cursor = clampRandom(random) * weights.reduce((sum, weight) => sum + weight, 0);
  for (let index = 0; index < spots.length; index += 1) {
    cursor -= weights[index];
    if (cursor < 0) return spots[index];
  }
  return spots[0];
}

// The activity and its destination are drawn from the same number, so the
// second draw must not inherit the first one's structure. An affine reshuffle
// keeps intervals intact, which left a landmark unreachable in exactly the
// range where roaming wins; mixing the bits makes the two draws independent.
function splitRandom(random: number): number {
  let hash = Math.imul(Math.floor(clampRandom(random) * 0x100000000) ^ 0x9e3779b9, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 0x100000000;
}

function clampRandom(value: number) {
  return Number.isFinite(value) ? Math.min(0.999999, Math.max(0, value % 1)) : 0;
}

function clamp01(value: number) {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}
