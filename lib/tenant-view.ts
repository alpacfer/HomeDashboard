// What the Tenant looks like, as a function of what it is doing.
//
// components/tenant.tsx owns the browser: thirteen pieces of state, twenty-one
// refs and fifteen effects, all of it there because the character moves. None
// of that is needed to answer "given this pose and this perch, what classes
// does the figure carry" -- and that question encodes real rules. `g-far` aims
// a glance across the colon when the digit about to change is an hour rather
// than a minute. `on-<kind>` is what tells the stylesheet whether it is
// standing on a flat digit or a round one. Both were written inline in a
// 710-line component, and neither had a test.
//
// The perch geometry, the landing spots and the timing all live in
// lib/clock-tenant.ts. This is the last pure layer above them: state in,
// class list and custom properties out.

import type { Mood, Perch, PerchAction, WorldSpot } from './clock-tenant';

/** A spot the Tenant can stand on while it waits, as minted by clock.tsx. */
export type SafeSpot = { key: string };

export type FigureState = {
  mood: Mood;
  pose: string;
  perch: Perch;
  onTop: boolean;
  gesture?: { action: string } | null;
  perchAction?: { action: PerchAction } | null;
  sitting: boolean;
  worldTarget?: { id: string } | null;
  innerHandoff: boolean;
  /** Which digit changes next: 0 and 1 are the hour, 2 and 3 the minute. */
  nextDigit: number;
  /** Positive looks right, negative left, zero not at all. */
  watch: number;
};

/**
 * Every class the figure carries, in the order the stylesheet expects.
 *
 * Falsy entries are dropped rather than emitted empty, because a stray double
 * space in a class list is the kind of thing that reads fine and matches
 * nothing.
 */
export function tenantClassName(state: FigureState): string {
  const { mood, pose, perch, onTop, gesture, perchAction, sitting, worldTarget, innerHandoff, nextDigit, watch } = state;
  return ['tenant', 'mood-' + mood, 'pose-' + pose,
    onTop ? 'on-' + perch.kind : '',
    gesture ? 'g-' + gesture.action : '',
    // A glance at the digits is aimed across the colon when the one about to
    // roll is an hour: it is further away, and the eyes have to travel.
    gesture?.action === 'glance-digits' && nextDigit <= 1 ? 'g-far' : '',
    perchAction ? 'pa-' + perchAction.action : '',
    sitting && pose === 'perched' ? 'sitting' : '',
    worldTarget ? 'visit-' + worldTarget.id : '',
    innerHandoff ? 'inner-handoff' : '',
    watch ? (watch > 0 ? 'w-right' : 'w-left') : ''].filter(Boolean).join(' ');
}

// The scenes the Tenant leans in to look at rather than simply standing on.
// The weather card and the forecast map are pictures; the departure boards and
// the daily fact are text, and it reads those head-on.
const PEERED_AT: readonly string[] = ['weather', 'map'];

/** Whether arriving at this scene is a thing to peer at. */
export function peersAt(sceneId: string): boolean {
  return PEERED_AT.includes(sceneId);
}

// Where the Tenant is willing to wait: the weather card, the ribbon, the week
// strip, and the two landing pads in front of them. Deliberately not the
// rotating panel, whose contents change under it every thirty seconds.
const STABLE_SPOT = /^(weather|ribbon|week)-/;
const STABLE_DESTINATIONS: readonly string[] = ['destination-weather', 'destination-week'];

/**
 * The spots that are still there a minute from now.
 *
 * The keys are minted in components/clock.tsx and matched here, which is a
 * contract between two files that TypeScript cannot see: rename a landing spot
 * there and this quietly stops matching, and the Tenant quietly stops roaming.
 * A test over the real key list is the only thing that notices.
 */
export function stableSpots<T extends SafeSpot>(safe: readonly T[]): T[] {
  return safe.filter(spot => STABLE_SPOT.test(spot.key) || STABLE_DESTINATIONS.includes(spot.key));
}

/** The world spots a Tenant may travel to, by id. */
export function worldSpotIds(world: readonly WorldSpot[]): string[] {
  return world.map(spot => spot.id);
}
