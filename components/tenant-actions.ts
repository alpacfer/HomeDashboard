'use client';

// What the Tenant does: every intentional move, gesture and interruption, as
// one controller created once per mount.
//
// components/tenant.tsx used to rebuild these fifteen closures on every
// render and hand them to its effects through a ref, because they read state
// setters and refs. Both are stable for the life of the component, so the
// controller is built once and the effects call it directly. The rules of
// motion are unchanged: intentional locomotion is always the same jump
// (charge on a measured pad, one parabolic arc, land), geometry is pure logic
// in lib/clock-tenant.ts, and the spring and flight tracks come precomputed
// from lib/tenant-motion.ts and are played by the Web Animations API. Flight
// stages advance on animation completion, never on a competing timer, and an
// interruption captures the live transform before replacing it.

import type { Dispatch, RefObject, SetStateAction } from 'react';
import {
  perchDuration, pickPerch, tenantHopArc, tenantTravelRoute,
  type HopArc, type Perch, type PerchAction, type Targets, type TravelPoint, type WorldSpot,
} from '@/lib/clock-tenant';
import { GESTURE_MS, PERCH_ACTION_MS, peersAt, stableSpots, type GestureAction } from '@/lib/tenant-view';
import { postureClip, jumpChargeFrames, jumpFlightFrames, type MotionClip, type MotionFrame } from '@/lib/tenant-motion';
import { visitDwellMs } from '@/lib/pet-behavior';
import type { DebugFlags } from '@/lib/debug-flags';

export type Pose = 'rest' | 'perched' | 'falling' | 'sprawled' | 'charging' | 'jumping' | 'visiting';
export type TimedGesture = { action: GestureAction; key: number; clip?: MotionClip };
export type TimedPerchAction = { action: PerchAction; key: number; endsAt: number; clip?: MotionClip };
export type InnerHandoff = { gest: string; pupils: string; face: string; tail: string; foot: string; footB: string };
export type Hop = HopArc & { from: TravelPoint; to: TravelPoint };

export const INNER_HANDOFF_MS = 180;
// Keep a completed keyframe painted for a few frames before React removes its
// class. Nominally equal CSS and JS clocks otherwise race on slower browsers.
export const MOTION_SETTLE_MS = 80;
// The digit rolls out from under it: the fall, then a dazed moment on the
// ground before it gets up and jumps home.
const FALL_MS = 1000;
const SPRAWL_MS = 800;
// How close to the top of the viewport an arc may reach, in page pixels.
const VIEWPORT_CEILING_PX = 12;
const IDENTITY = 'matrix(1, 0, 0, 1, 0, 0)';

export const FALLBACK_PERCH: Perch = { x: 0, y: 0, kind: 'flat', slide: 1 };

// The live values the controller reads. Refs, because the component refreshes
// them in an effect and the controller must never hold a stale prop.
export type TenantRefs = {
  element: RefObject<HTMLDivElement | null>;
  pose: RefObject<Pose>;
  targets: RefObject<Targets>;
  perch: RefObject<number>;
  play: RefObject<((id: 'land' | 'spring') => void) | undefined>;
  world: RefObject<WorldSpot | null>;
  travelPreview: RefObject<WorldSpot['id'] | null>;
  gesture: RefObject<TimedGesture | null>;
  perchAction: RefObject<TimedPerchAction | null>;
  hop: RefObject<Hop | null>;
};

// The state the controller writes. React's setters are stable, so these are
// captured once.
export type TenantSetters = {
  pose: Dispatch<SetStateAction<Pose>>;
  perchIndex: Dispatch<SetStateAction<number>>;
  sitting: Dispatch<SetStateAction<boolean>>;
  gesture: Dispatch<SetStateAction<TimedGesture | null>>;
  perchAction: Dispatch<SetStateAction<TimedPerchAction | null>>;
  visitPosture: Dispatch<SetStateAction<MotionClip | undefined>>;
  watch: Dispatch<SetStateAction<-1 | 0 | 1>>;
  worldTarget: Dispatch<SetStateAction<WorldSpot | null>>;
  hop: Dispatch<SetStateAction<Hop | null>>;
  innerHandoff: Dispatch<SetStateAction<InnerHandoff | null>>;
  figureFrom: Dispatch<SetStateAction<string>>;
  from: Dispatch<SetStateAction<TravelPoint>>;
  balanceSeed: Dispatch<SetStateAction<number>>;
};

export class TenantController {
  private readonly timers = new Set<number>();
  private rootAnimation: Animation | null = null;
  private gestureSequence = 0;
  private perchActionSequence = 0;
  private innerHandoffSequence = 0;
  private journey = 0;

  constructor(
    private readonly refs: TenantRefs,
    private readonly set: TenantSetters,
    private readonly motionPreview: DebugFlags['petMotion'],
  ) {}

  // Timers, all of them owned here so dispose() can clear every one.
  readonly later = (fn: () => void, ms: number) => {
    const id = window.setTimeout(() => { this.timers.delete(id); fn(); }, ms);
    this.timers.add(id);
    return id;
  };
  readonly afterMotion = (fn: () => void, ms: number) => this.later(fn, ms + MOTION_SETTLE_MS);

  readonly move = (next: Pose) => { this.refs.pose.current = next; this.set.pose(next); };
  readonly currentPerch = () => this.refs.targets.current.perch[this.refs.perch.current] ?? FALLBACK_PERCH;
  private readonly tenantSize = () => this.refs.element.current?.getBoundingClientRect().width || 48;

  private readonly computedTransform = (selector?: string) => {
    const root = this.refs.element.current;
    const target = selector ? root?.querySelector<SVGGraphicsElement>(selector) : root;
    if (!target) return IDENTITY;
    const transform = getComputedStyle(target).transform;
    return transform && transform !== 'none' ? transform : IDENTITY;
  };

  // A gesture occupies the resting body even though it does not change the
  // locomotion pose. Refuse a second one until its final frame has painted;
  // keyed cleanup also prevents an old timer from clearing a newer repeat.
  readonly startGesture = (action: GestureAction) => {
    if (this.refs.gesture.current) return false;
    const clip = action === 'lean' ? postureClip('lean', Math.random()) : undefined;
    const next: TimedGesture = { action, key: ++this.gestureSequence, clip };
    this.refs.gesture.current = next;
    this.set.gesture(next);
    this.afterMotion(() => {
      if (this.refs.gesture.current?.key !== next.key) return;
      this.refs.gesture.current = null;
      this.set.gesture(current => current?.key === next.key ? null : current);
    }, clip?.duration ?? GESTURE_MS[action]);
    return true;
  };

  readonly startPerchAction = (action: PerchAction) => {
    if (this.refs.perchAction.current) return false;
    const clip = action === 'peer' || action === 'teeter'
      ? postureClip(action, this.motionPreview ? 0.37 : Math.random(), this.currentPerch().slide * -1)
      : undefined;
    const duration = clip?.duration ?? PERCH_ACTION_MS[action];
    const next: TimedPerchAction = { action, key: ++this.perchActionSequence, endsAt: Date.now() + duration + MOTION_SETTLE_MS, clip };
    this.refs.perchAction.current = next;
    this.set.perchAction(next);
    this.afterMotion(() => {
      if (this.refs.perchAction.current?.key !== next.key) return;
      this.refs.perchAction.current = null;
      this.set.perchAction(current => current?.key === next.key ? null : current);
    }, duration);
    return true;
  };

  // Visit animations affect several nested SVG layers. When a panel rotates
  // away, capture all of them and ease each one back during the next charge so
  // returning home never cancels an eye, tail, or body keyframe in mid-pose.
  private readonly smoothInnerHandoff = () => {
    const token = ++this.innerHandoffSequence;
    this.set.innerHandoff({
      gest: this.computedTransform('.t-gest'), pupils: this.computedTransform('.t-pupils'),
      face: this.computedTransform('.t-face'), tail: this.computedTransform('.t-tail'),
      foot: this.computedTransform('.t-foot:not(.t-foot-b)'), footB: this.computedTransform('.t-foot-b'),
    });
    this.afterMotion(() => {
      if (this.innerHandoffSequence === token) this.set.innerHandoff(null);
    }, INNER_HANDOFF_MS);
  };

  // The element's translation right now, in flight or not. The pose-specific
  // fallback is used only before the browser exposes a computed matrix.
  private readonly whereNow = (): TravelPoint => {
    const pose = this.refs.pose.current;
    const perch = this.currentPerch();
    const world = this.refs.world.current;
    const hop = this.refs.hop.current;
    const fallback = pose === 'rest'
      ? { x: 0, y: 0 }
      : world && pose === 'visiting'
      ? { x: world.x, y: world.y }
      : hop && (pose === 'charging' || pose === 'jumping')
        ? hop.from
      : pose === 'perched'
        ? { x: perch.x, y: perch.y }
        : { x: 0, y: 0 };
    const element = this.refs.element.current;
    if (!element) return fallback;
    try {
      const transform = getComputedStyle(element).transform;
      if (!transform || transform === 'none') return fallback;
      const matrix = new DOMMatrixReadOnly(transform);
      return Number.isFinite(matrix.e) && Number.isFinite(matrix.f) ? { x: Math.round(matrix.e * 10) / 10, y: Math.round(matrix.f * 10) / 10 } : fallback;
    } catch {
      return fallback;
    }
  };

  readonly jumpTo = (to: TravelPoint, arrived: () => void, safe = this.refs.targets.current.safe) => {
    const token = ++this.journey;
    const start = this.whereNow();
    this.smoothInnerHandoff();
    this.refs.gesture.current = null;
    this.refs.perchAction.current = null;
    this.set.gesture(null);
    this.set.perchAction(null);
    const route = tenantTravelRoute(start, to, safe, this.tenantSize());
    // Completion follows the browser's actual animation clock, not a timer
    // racing the next paint. A replacement begins at the live matrix before
    // cancelling the old animation, including scene-change interruptions.
    const play = (frames: MotionFrame[], duration: number, finished: () => void, easing = 'linear') => {
      const element = this.refs.element.current;
      if (!element) return;
      const previous = this.rootAnimation;
      const animation = element.animate(frames, { duration, easing, fill: 'both' });
      this.rootAnimation = animation;
      if (previous) { previous.onfinish = null; previous.cancel(); }
      animation.onfinish = () => {
        if (this.journey === token && this.rootAnimation === animation) finished();
      };
    };
    const take = (from: TravelPoint, index: number) => {
      if (this.journey !== token) return;
      const next = route[index];
      if (!next) { this.set.hop(null); arrived(); return; }
      const element = this.refs.element.current;
      const restTop = (element?.offsetParent?.getBoundingClientRect().top ?? 0) + this.refs.targets.current.rest.top;
      const arc = tenantHopArc(from, next, this.tenantSize(), VIEWPORT_CEILING_PX - restTop, Math.random());
      this.set.from(from);
      const current = this.computedTransform();
      const hop: Hop = { ...arc, from, to: next };
      this.refs.hop.current = hop;
      this.set.hop(hop);
      this.move('charging');
      play(jumpChargeFrames(arc, current), arc.chargeMs, () => {
        this.move('jumping');
        play(jumpFlightFrames(arc), arc.duration, () => {
          take(next, index + 1);
        });
      }, 'cubic-bezier(.3,0,.4,1)');
    };
    take(start, 0);
  };

  private readonly settleHome = () => {
    this.refs.world.current = null;
    this.set.worldTarget(null);
    this.set.watch(0);
    this.move('rest');
  };

  readonly jumpHome = () => { this.jumpTo({ x: 0, y: 0 }, this.settleHome); };

  readonly roamHome = (stableOnly = false) => {
    const pose = this.refs.pose.current;
    if (!this.refs.world.current && pose !== 'charging' && pose !== 'jumping') { this.jumpHome(); return; }
    const safe = stableOnly ? stableSpots(this.refs.targets.current.safe) : this.refs.targets.current.safe;
    this.jumpTo({ x: 0, y: 0 }, this.settleHome, safe);
  };

  readonly perchOnDigit = () => {
    let index = pickPerch(Math.random());
    if (!this.refs.targets.current.perch[index]) index = 3;
    const perch = this.refs.targets.current.perch[index] ?? FALLBACK_PERCH;
    this.set.perchIndex(index);
    this.refs.perch.current = index;
    // The balance the figure keeps on this top is drawn now, in this event,
    // not in render, so the balance clip stays a pure function of its inputs.
    this.set.balanceSeed(Math.random());
    this.jumpTo({ x: perch.x, y: perch.y }, () => {
      this.move('perched');
      if (perch.kind === 'ball') this.refs.play.current?.('land');
      this.later(() => this.comeDown(), perchDuration(Math.random(), perch.kind));
    });
  };

  readonly roamTo = (id: WorldSpot['id']) => {
    const target = this.refs.targets.current.world.find(spot => spot.id === id);
    if (!target) return;
    this.refs.world.current = target;
    this.set.worldTarget(target);
    this.set.watch(target.look);
    this.jumpTo(target, () => {
      this.set.visitPosture(peersAt(target.id) ? postureClip('peer', Math.random(), target.look) : undefined);
      this.move('visiting');
      if (!this.refs.travelPreview.current) {
        this.afterMotion(() => { if (this.refs.pose.current === 'visiting') this.roamHome(); }, visitDwellMs(Math.random()));
      }
    });
  };

  // Leaving a perch uses the same charge, parabola and planted landing as
  // every other intentional move.
  readonly comeDown = () => {
    if (this.refs.pose.current !== 'perched') return;
    const active = this.refs.perchAction.current;
    if (active) {
      this.later(() => { if (this.refs.pose.current === 'perched') this.comeDown(); }, Math.max(16, active.endsAt - Date.now() + 16));
      return;
    }
    if (this.currentPerch().kind === 'ball') this.refs.play.current?.('spring');
    this.set.sitting(false);
    this.jumpHome();
  };

  // The digit it is standing on rolls away: stumble, fall to the baseline in
  // front of the digit, lie there a moment, get up and jump home.
  readonly fall = () => {
    if (this.refs.pose.current !== 'perched') return;
    this.journey += 1;
    this.set.from(this.whereNow());
    this.set.figureFrom(this.computedTransform('.t-figure'));
    this.set.sitting(false);
    this.refs.perchAction.current = null;
    this.set.perchAction(null);
    this.move('falling');
    this.afterMotion(() => {
      if (this.refs.pose.current !== 'falling') return;
      this.move('sprawled');
      this.later(() => {
        if (this.refs.pose.current !== 'sprawled') return;
        this.jumpHome();
      }, SPRAWL_MS);
    }, FALL_MS);
  };

  // A debug pin skips the trip: abandon any journey in flight, then hold.
  readonly holdAt = (target: WorldSpot, posture: MotionClip | undefined) => {
    this.refs.world.current = target;
    this.set.worldTarget(target);
    this.set.visitPosture(posture);
    this.journey += 1;
    this.refs.hop.current = null;
    this.set.hop(null);
    this.move('visiting');
  };

  // Retire the filled root animation once React has painted the new resting
  // or perched location into the DOM, so there is no one-frame flash home.
  readonly retireRootAnimation = () => {
    const animation = this.rootAnimation;
    if (animation) { animation.onfinish = null; animation.cancel(); this.rootAnimation = null; }
  };

  readonly dispose = () => {
    this.retireRootAnimation();
    for (const id of this.timers) window.clearTimeout(id);
    this.timers.clear();
  };
}
