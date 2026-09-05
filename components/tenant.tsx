'use client';

// The Tenant: the small character beside the minutes. See lib/clock-tenant.ts
// for the rules; this file only owns its timers and its SVG.
//
// Intentional locomotion is always the same jump: charge on a measured pad,
// follow one parabolic arc, land, and either settle or charge the next hop.
// Geometry is pure logic in lib/clock-tenant.ts; spring and flight tracks are
// precomputed in lib/tenant-motion.ts and played by the Web Animations API.
// Flight stages advance on animation completion, never a competing timer.
// CSS gestures still get a short painted-frame grace after their nominal
// duration. Interruptions capture live transforms before replacing them.
//
// The SVG is layered so that animations compose instead of fighting:
//   .tenant    the positioned element: charge and locomotion keyframes
//   .t-figure  the whole figure: breathing and balance on a top
//   .t-gest    body gestures and perch actions: stretch, wiggle, teeter, slip
//   .t-pose    sticky body state with a transition: sitting
// Each layer animates only its own transform, so a slip on a round top runs
// over the sway underneath it and hands back to it without a jump.

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import {
  DOTS_SPOT, msToNextMinute, perchDuration, perchIdleDelay,
  pickIdle, pickPerch, pickPerchAction, tenantHopArc, tenantTravelRoute,
  type HopArc, type IdleAction, type Mood, type Perch, type PerchAction, type Targets, type TravelPoint, type WorldSpot,
} from '@/lib/clock-tenant';
import {
  advancePetMind, choosePetActivity, commitPetActivity, initialPetMind, noticePetScene, noticePetStimulus, petDecisionDelay,
} from '@/lib/pet-behavior';
import type { Rotation } from '@/lib/panel-rotation';
import { TENANT_SHAPES, TENANT_PATH_STYLES } from '@/lib/tenant-drawing';
import { balanceClip, postureClip, jumpChargeFrames, jumpFlightFrames, type MotionClip, type MotionFrame } from '@/lib/tenant-motion';
import { debugFlags } from '@/lib/debug-flags';

export type TenantProps = {
  mood: Mood;
  targets: Targets;
  activeScene: Rotation['phase'];
  // Debug-only visual pin. Normal behavior leaves this null.
  previewSpot?: WorldSpot['id'] | null;
  // Debug-only deterministic journey. It takes the real safe-spot route and
  // then holds the destination so sequences can capture the full movement.
  travelSpot?: WorldSpot['id'] | null;
  // The minute stamp of a roll that just happened, or null: a stimulus for
  // the mind, and a physical hazard only when its current perch rolls away.
  rollKey: number | null;
  // The leftmost digit that will change next, to aim the glance.
  nextDigit: number;
  // The leftmost digit that changed at the last roll.
  rolledDigit: number;
  // True while the outfit is crossfading or a set piece is running.
  busy: boolean;
  // Something the clock should draw for it: it landed on the colon, or left it.
  onPlay?: (id: 'land' | 'spring') => void;
  // Whether it is at rest beside the minutes, so the clock can hold a set
  // piece until it is.
  onHome?: (home: boolean) => void;
};

type Pose = 'rest' | 'perched' | 'falling' | 'sprawled' | 'charging' | 'jumping' | 'visiting';

type GestureAction = Exclude<IdleAction, 'hop'>;
type TimedGesture = { action: GestureAction; key: number; clip?: MotionClip };
type TimedPerchAction = { action: PerchAction; key: number; endsAt: number; clip?: MotionClip };
type InnerHandoff = { gest: string; pupils: string; face: string; tail: string; foot: string; footB: string };

const GESTURE_MS: Record<GestureAction, number> = {
  blink: 270, 'double-blink': 620, 'glance-digits': 1600, 'glance-up': 1600, 'look-around': 1900, smile: 1800,
  stretch: 1400, wiggle: 900, lean: 1900, yawn: 2300,
  scratch: 1700, sneeze: 900, wave: 1500, doze: 2600, listen: 1700,
};
const PERCH_ACTION_MS: Record<PerchAction, number> = { sit: 500, peer: 4100, teeter: 3400, slip: 1000 };
const INNER_HANDOFF_MS = 180;
// Keep a completed keyframe painted for a few frames before React removes its
// class. Nominally equal CSS and JS clocks otherwise race on slower browsers.
const MOTION_SETTLE_MS = 80;
// The digit rolls out from under it: the fall, then a dazed moment on the
// ground before it gets up and jumps home.
const FALL_MS = 1000;
const SPRAWL_MS = 800;

const FALLBACK_PERCH: Perch = { x: 0, y: 0, kind: 'flat', slide: 1 };
type TenantActions = {
  jumpTo: (to: TravelPoint, arrived: () => void, safe?: Targets['safe']) => void;
  jumpHome: () => void;
  roamHome: (stableOnly?: boolean) => void;
  perchOnDigit: () => void;
  roamTo: (id: WorldSpot['id']) => void;
  comeDown: () => void;
  fall: () => void;
  startGesture: (action: GestureAction) => boolean;
  startPerchAction: (action: PerchAction) => boolean;
};

type Hop = HopArc & { from: TravelPoint; to: TravelPoint };

export default function Tenant({ mood, targets, activeScene, previewSpot = null, travelSpot = null, rollKey, nextDigit, rolledDigit, busy, onPlay, onHome }: TenantProps) {
  const [motionPreview] = useState(() => typeof window === 'undefined' ? null : debugFlags(window.location.search).petMotion);
  const [pose, setPose] = useState<Pose>('rest');
  const [perchIndex, setPerchIndex] = useState(3);
  const [sitting, setSitting] = useState(false);
  const [gesture, setGesture] = useState<TimedGesture | null>(null);
  const [perchAction, setPerchAction] = useState<TimedPerchAction | null>(null);
  const [visitPosture, setVisitPosture] = useState<MotionClip | undefined>();
  const [watch, setWatch] = useState<-1 | 0 | 1>(0);
  const [worldTarget, setWorldTarget] = useState<WorldSpot | null>(null);
  const [hop, setHop] = useState<Hop | null>(null);
  const [innerHandoff, setInnerHandoff] = useState<InnerHandoff | null>(null);
  const [figureFrom, setFigureFrom] = useState('matrix(1, 0, 0, 1, 0, 0)');
  // Where a fall starts: the element's actual translation at that moment, so
  // a remeasured perch never makes it jump.
  const [from, setFrom] = useState({ x: 0, y: 0 });

  // Everything the effects need to read without re-subscribing.
  const elementRef = useRef<HTMLDivElement>(null);
  const rootAnimation = useRef<Animation | null>(null);
  const poseRef = useRef<Pose>('rest');
  const moodRef = useRef(mood);
  const busyRef = useRef(busy);
  const targetsRef = useRef(targets);
  const perchRef = useRef(perchIndex);
  const rolledRef = useRef(rolledDigit);
  const playRef = useRef(onPlay);
  const worldRef = useRef<WorldSpot | null>(null);
  const sceneRef = useRef(activeScene);
  const previewRef = useRef(previewSpot);
  const travelPreviewRef = useRef(travelSpot);
  const mindRef = useRef(initialPetMind(activeScene));
  const recentGestures = useRef<IdleAction[]>([]);
  const gestureRef = useRef<TimedGesture | null>(null);
  const gestureSequence = useRef(0);
  const perchActionRef = useRef<TimedPerchAction | null>(null);
  const perchActionSequence = useRef(0);
  const innerHandoffSequence = useRef(0);
  const lastDecisionAt = useRef(0);
  const previousMood = useRef(mood);
  const journey = useRef(0);
  const act = useRef<TenantActions>(null!);
  const timers = useRef(new Set<number>());
  useEffect(() => {
    poseRef.current = pose;
    moodRef.current = mood;
    busyRef.current = busy;
    targetsRef.current = targets;
    perchRef.current = perchIndex;
    rolledRef.current = rolledDigit;
    playRef.current = onPlay;
    worldRef.current = worldTarget;
    previewRef.current = previewSpot;
    travelPreviewRef.current = travelSpot;
    gestureRef.current = gesture;
    perchActionRef.current = perchAction;
  });

  const later = (fn: () => void, ms: number) => {
    const id = window.setTimeout(() => { timers.current.delete(id); fn(); }, ms);
    timers.current.add(id);
    return id;
  };
  const afterMotion = (fn: () => void, ms: number) => later(fn, ms + MOTION_SETTLE_MS);
  const move = (next: Pose) => { poseRef.current = next; setPose(next); };
  const currentPerch = () => targetsRef.current.perch[perchRef.current] ?? FALLBACK_PERCH;
  const tenantSize = () => elementRef.current?.getBoundingClientRect().width || 48;

  const computedTransform = (selector?: string) => {
    const target = selector ? elementRef.current?.querySelector<SVGGraphicsElement>(selector) : elementRef.current;
    if (!target) return 'matrix(1, 0, 0, 1, 0, 0)';
    const transform = getComputedStyle(target).transform;
    return transform && transform !== 'none' ? transform : 'matrix(1, 0, 0, 1, 0, 0)';
  };

  // A gesture occupies the resting body even though it does not change the
  // locomotion pose. Refuse a second one until its final frame has painted;
  // keyed cleanup also prevents an old timer from clearing a newer repeat.
  const startGesture = (action: GestureAction) => {
    if (gestureRef.current) return false;
    const clip = action === 'lean' ? postureClip('lean', Math.random()) : undefined;
    const next = { action, key: ++gestureSequence.current, clip };
    gestureRef.current = next;
    setGesture(next);
    afterMotion(() => {
      if (gestureRef.current?.key !== next.key) return;
      gestureRef.current = null;
      setGesture(current => current?.key === next.key ? null : current);
    }, clip?.duration ?? GESTURE_MS[action]);
    return true;
  };

  const startPerchAction = (action: PerchAction) => {
    if (perchActionRef.current) return false;
    const clip = action === 'peer' || action === 'teeter' ? postureClip(action, motionPreview ? 0.37 : Math.random(), currentPerch().slide * -1) : undefined;
    const duration = clip?.duration ?? PERCH_ACTION_MS[action];
    const next = { action, key: ++perchActionSequence.current, endsAt: Date.now() + duration + MOTION_SETTLE_MS, clip };
    perchActionRef.current = next;
    setPerchAction(next);
    afterMotion(() => {
      if (perchActionRef.current?.key !== next.key) return;
      perchActionRef.current = null;
      setPerchAction(current => current?.key === next.key ? null : current);
    }, duration);
    return true;
  };

  // Visit animations affect several nested SVG layers. When a panel rotates
  // away, capture all of them and ease each one back during the next charge so
  // returning home never cancels an eye, tail, or body keyframe in mid-pose.
  const smoothInnerHandoff = () => {
    const token = ++innerHandoffSequence.current;
    setInnerHandoff({
      gest: computedTransform('.t-gest'), pupils: computedTransform('.t-pupils'),
      face: computedTransform('.t-face'), tail: computedTransform('.t-tail'),
      foot: computedTransform('.t-foot:not(.t-foot-b)'), footB: computedTransform('.t-foot-b'),
    });
    afterMotion(() => {
      if (innerHandoffSequence.current === token) setInnerHandoff(null);
    }, INNER_HANDOFF_MS);
  };

  // The element's translation right now, in flight or not. The pose-specific
  // fallback is used only before the browser exposes a computed matrix.
  const whereNow = () => {
    const perch = currentPerch();
    const fallback = poseRef.current === 'rest'
      ? { x: 0, y: 0 }
      : worldRef.current && poseRef.current === 'visiting'
      ? { x: worldRef.current.x, y: worldRef.current.y }
      : hop && (poseRef.current === 'charging' || poseRef.current === 'jumping')
        ? hop.from
      : poseRef.current === 'perched'
        ? { x: perch.x, y: perch.y }
        : { x: 0, y: 0 };
    const element = elementRef.current;
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

  const travel = (to: TravelPoint, arrived: () => void, safe = targetsRef.current.safe) => {
    const token = ++journey.current;
    const start = whereNow();
    smoothInnerHandoff();
    gestureRef.current = null;
    perchActionRef.current = null;
    setGesture(null);
    setPerchAction(null);
    const route = tenantTravelRoute(start, to, safe, tenantSize());
    // Completion follows the browser's actual animation clock, not a timer
    // racing the next paint. A replacement begins at the live matrix before
    // cancelling the old animation, including scene-change interruptions.
    const play = (frames: MotionFrame[], duration: number, finished: () => void, easing = 'linear') => {
      const element = elementRef.current;
      if (!element) return;
      const previous = rootAnimation.current;
      const animation = element.animate(frames, { duration, easing, fill: 'both' });
      rootAnimation.current = animation;
      if (previous) { previous.onfinish = null; previous.cancel(); }
      animation.onfinish = () => {
        if (journey.current === token && rootAnimation.current === animation) finished();
      };
    };
    const take = (from: TravelPoint, index: number) => {
      if (journey.current !== token) return;
      const next = route[index];
      if (!next) { setHop(null); arrived(); return; }
      const element = elementRef.current;
      const restTop = (element?.offsetParent?.getBoundingClientRect().top ?? 0) + targetsRef.current.rest.top;
      const arc = tenantHopArc(from, next, tenantSize(), 12 - restTop, Math.random());
      setFrom(from);
      const current = computedTransform();
      setHop(arc);
      move('charging');
      play(jumpChargeFrames(arc, current), arc.chargeMs, () => {
        move('jumping');
        play(jumpFlightFrames(arc), arc.duration, () => {
          take(next, index + 1);
        });
      }, 'cubic-bezier(.3,0,.4,1)');
    };
    take(start, 0);
  };

  const jumpHome = () => {
    travel({ x: 0, y: 0 }, () => {
      worldRef.current = null;
      setWorldTarget(null);
      setWatch(0);
      move('rest');
    });
  };

  const roamHome = (stableOnly = false) => {
    if (!worldRef.current && poseRef.current !== 'charging' && poseRef.current !== 'jumping') { jumpHome(); return; }
    const safe = stableOnly
      ? targetsRef.current.safe.filter(spot => /^(weather|ribbon|week)-/.test(spot.key) || spot.key === 'destination-weather' || spot.key === 'destination-week')
      : targetsRef.current.safe;
    travel({ x: 0, y: 0 }, () => {
      worldRef.current = null;
      setWorldTarget(null);
      setWatch(0);
      move('rest');
    }, safe);
  };

  const perchOnDigit = (): void => {
    let index = pickPerch(Math.random());
    if (!targetsRef.current.perch[index]) index = 3;
    const perch = targetsRef.current.perch[index] ?? FALLBACK_PERCH;
    setPerchIndex(index);
    perchRef.current = index;
    travel({ x: perch.x, y: perch.y }, () => {
      move('perched');
      if (perch.kind === 'ball') playRef.current?.('land');
      later(() => act.current.comeDown(), perchDuration(Math.random(), perch.kind));
    });
  };

  const roamTo = (id: WorldSpot['id']) => {
    const target = targetsRef.current.world.find(spot => spot.id === id);
    if (!target) return;
    worldRef.current = target;
    setWorldTarget(target);
    setWatch(target.look);
    travel(target, () => {
      setVisitPosture(target.id === 'weather' || target.id === 'map' ? postureClip('peer', Math.random(), target.look) : undefined);
      move('visiting');
      // The longest landmark action is 5.4 s. Let it return to its neutral
      // keyframe and breathe before a voluntary departure can begin.
      if (!travelPreviewRef.current) afterMotion(() => { if (poseRef.current === 'visiting') act.current.roamHome(); }, 5800 + Math.random() * 1800);
    });
  };

  // Leaving a perch uses the same charge, parabola and planted landing as
  // every other intentional move.
  const comeDown = () => {
    if (poseRef.current !== 'perched') return;
    const active = perchActionRef.current;
    if (active) {
      later(() => { if (poseRef.current === 'perched') act.current.comeDown(); }, Math.max(16, active.endsAt - Date.now() + 16));
      return;
    }
    if (currentPerch().kind === 'ball') playRef.current?.('spring');
    setSitting(false);
    jumpHome();
  };

  // The digit it is standing on rolls away: stumble, fall to the baseline in
  // front of the digit, lie there a moment, get up and jump home.
  const fall = () => {
    if (poseRef.current !== 'perched') return;
    journey.current += 1;
    setFrom(whereNow());
    setFigureFrom(computedTransform('.t-figure'));
    setSitting(false);
    perchActionRef.current = null;
    setPerchAction(null);
    move('falling');
    afterMotion(() => {
      if (poseRef.current !== 'falling') return;
      move('sprawled');
      later(() => {
        if (poseRef.current !== 'sprawled') return;
        jumpHome();
      }, SPRAWL_MS);
    }, FALL_MS);
  };

  // The effects below call these through a ref, like everything else they
  // read, so none of them has to be rebuilt when a prop changes. Refreshed in
  // an effect, never during render, and always before any timer can fire.
  useEffect(() => {
    act.current = { jumpTo: travel, jumpHome, roamHome, perchOnDigit, roamTo, comeDown, fall, startGesture, startPerchAction };
  });

  useEffect(() => { onHome?.(pose === 'rest'); }, [pose, onHome]);

  // Retire the filled root animation only after React has painted the new
  // resting/perched location into the DOM. No one-frame flash back home.
  useLayoutEffect(() => {
    if (pose === 'charging' || pose === 'jumping') return;
    const animation = rootAnimation.current;
    if (animation) { animation.onfinish = null; animation.cancel(); rootAnimation.current = null; }
  }, [pose]);

  const onTop = pose === 'perched';
  const topKind = targets.perch[perchIndex]?.kind ?? 'flat';
  const balanceSnapshot = useRef<string[]>([]);
  useLayoutEffect(() => {
    const root = elementRef.current;
    const selectors = ['.t-balance', '.t-balance-head', '.t-balance-sprout'];
    const clip = onTop ? balanceClip(topKind, motionPreview ? 0.42 : Math.random()) : null;
    const tracks = clip ? [clip.body, clip.head, clip.sprout] : null;
    const animations = selectors.map((selector, i) => {
      const element = root?.querySelector(selector);
      if (!element) return null;
      const frames = tracks?.[i] ?? [
        { offset: 0, transform: balanceSnapshot.current[i] ?? 'none' },
        { offset: 1, transform: 'translate(0px,0px) rotate(0deg) scale(1,1)' },
      ];
      return element.animate(frames, { duration: clip?.duration ?? INNER_HANDOFF_MS, fill: 'both' });
    });
    return () => {
      balanceSnapshot.current = selectors.map(selector => {
        const element = root?.querySelector(selector);
        return element ? getComputedStyle(element).transform : 'none';
      });
      animations.forEach(animation => animation?.cancel());
    };
  }, [onTop, topKind, motionPreview]);

  const posture = gesture?.clip ?? perchAction?.clip ?? (pose === 'visiting' ? visitPosture : undefined);
  const postureSnapshot = useRef<string[]>([]);
  useLayoutEffect(() => {
    const root = elementRef.current;
    const selectors = ['.t-posture', '.t-posture-head', '.t-posture-sprout'];
    const tracks = posture ? [posture.body, posture.head, posture.sprout] : null;
    const animations = selectors.map((selector, i) => {
      const element = root?.querySelector(selector);
      if (!element) return null;
      const frames = tracks?.[i] ?? [
        { offset: 0, transform: postureSnapshot.current[i] ?? 'none' },
        { offset: 1, transform: 'translate(0px,0px) rotate(0deg) scale(1,1)' },
      ];
      return element.animate(frames, { duration: posture?.duration ?? INNER_HANDOFF_MS, fill: 'both' });
    });
    return () => {
      postureSnapshot.current = selectors.map(selector => {
        const element = root?.querySelector(selector);
        return element ? getComputedStyle(element).transform : 'none';
      });
      animations.forEach(animation => animation?.cancel());
    };
  }, [posture]);

  // One sparse decision loop owns all resting behavior. Slowly changing drives
  // make perching and roaming arise from accumulated curiosity rather than a
  // second metronome; recent actions are suppressed so special gestures stay
  // surprising. The browser owns every animation frame.
  useEffect(() => {
    if (motionPreview) return;
    let alive = true;
    const tick = () => {
      if (!alive) return;
      const now = Date.now();
      const elapsed = lastDecisionAt.current ? now - lastDecisionAt.current : 0;
      let mind = advancePetMind(mindRef.current, elapsed, moodRef.current);
      lastDecisionAt.current = now;
      if (!previewRef.current && !travelPreviewRef.current && !gestureRef.current && moodRef.current !== 'asleep' && poseRef.current === 'rest' && !busyRef.current) {
        const remaining = msToNextMinute(new Date(now));
        const canAdventure = remaining > 4000 && remaining < 58_000 && !document.hidden;
        const decision = choosePetActivity(mind, {
          mood: moodRef.current,
          scene: sceneRef.current,
          spots: targetsRef.current.world.map(spot => spot.id),
          canAdventure,
        }, Math.random());
        mind = commitPetActivity(mind, decision);
        if (decision.kind === 'idle') {
          const action = pickIdle(Math.random(), false, recentGestures.current, mind.energy);
          recentGestures.current = [action, ...recentGestures.current.filter(item => item !== action)].slice(0, 4);
          if (action === 'hop') act.current.jumpTo({ x: 0, y: 0 }, () => move('rest'), []);
          else act.current.startGesture(action);
        } else if (decision.kind === 'perch') {
          act.current.perchOnDigit();
        } else if (decision.kind === 'roam') {
          act.current.roamTo(decision.spot);
        }
      }
      mindRef.current = mind;
      later(tick, petDecisionDelay(Math.random(), mind.energy));
    };
    later(tick, petDecisionDelay(Math.random(), mindRef.current.energy));
    return () => { alive = false; };
  }, [motionPreview]);

  // Things it does while perched, chosen by the shape under its feet: sit,
  // peer over the edge, teeter on a stem, or slip and catch itself.
  useEffect(() => {
    if (pose !== 'perched' || motionPreview) return;
    let alive = true;
    const tick = () => {
      if (!alive || poseRef.current !== 'perched') return;
      if (moodRef.current !== 'asleep' && !perchActionRef.current) {
        const perch = currentPerch();
        const action = pickPerchAction(perch.kind, Math.random());
        // Do not start a flourish that the next digit roll can remove from
        // underneath it. The roll itself remains authoritative if already due.
        if (msToNextMinute(new Date()) > PERCH_ACTION_MS[action] + MOTION_SETTLE_MS + 250 && act.current.startPerchAction(action)) {
          if (action === 'sit') setSitting(current => !current);
        }
      }
      later(tick, perchIdleDelay(Math.random()));
    };
    later(tick, perchIdleDelay(Math.random()) * 0.6);
    return () => { alive = false; };
  }, [pose, motionPreview]);

  // Reproduce real spring tracks and the real jump pipeline for captures;
  // changing a CSS class cannot launch a browser-owned procedural animation.
  useEffect(() => {
    if (!motionPreview) return;
    const timer = window.setTimeout(() => {
      if (motionPreview === 'hop') {
        act.current.jumpTo({ x: 0, y: 0 }, () => move('rest'), []);
        return;
      }
      const index = Math.max(0, targets.perch.findIndex(perch => perch.kind === 'round'));
      setPerchIndex(index);
      perchRef.current = index;
      move('perched');
      if (motionPreview === 'peek') act.current.startPerchAction('peer');
    }, 600);
    return () => window.clearTimeout(timer);
  }, [motionPreview, targets]);

  // A visual-test URL may pin one landmark. It skips the trip so a screenshot
  // can inspect the destination pose deterministically; ordinary visits still
  // cross the dashboard using the full roaming choreography.
  useEffect(() => {
    if (!previewSpot || motionPreview) return;
    const target = targets.world.find(spot => spot.id === previewSpot);
    const current = worldRef.current;
    if (!target || (poseRef.current === 'visiting' && current?.id === target.id && current.x === target.x && current.y === target.y)) return;
    worldRef.current = target;
    setWorldTarget(target);
    setVisitPosture(target.id === 'weather' || target.id === 'map' ? postureClip('peer', 0.37, target.look) : undefined);
    journey.current += 1;
    setHop(null);
    move('visiting');
  }, [previewSpot, targets, motionPreview]);

  // Restarted whenever the landmark is remeasured rather than guarded by a ref
  // that outlives a remount: such a guard survived React's development remount
  // while the timers it had started did not, which stranded the debug journey
  // in its opening charge for good. `targets` only changes when the clock is
  // remeasured, so this re-aims during the initial settle and then holds.
  useEffect(() => {
    if (!travelSpot || motionPreview || !targets.world.some(spot => spot.id === travelSpot)) return;
    act.current.roamTo(travelSpot);
  }, [travelSpot, targets, motionPreview]);

  // A scene change raises interest in that side of the dashboard. If the old
  // scene disappears while the Tenant is visiting it, come home from the
  // actual current transform; a later decision may investigate the new one.
  // Merely seeing a new scene changes interest but never dictates a gesture.
  useEffect(() => {
    if (sceneRef.current === activeScene) return;
    sceneRef.current = activeScene;
    mindRef.current = noticePetScene(mindRef.current, activeScene);
    if (poseRef.current === 'visiting' || poseRef.current === 'charging' || poseRef.current === 'jumping') act.current.roamHome(true);
  }, [activeScene]);

  // A minute roll is a stimulus, not an appointment. It raises curiosity for
  // a later free decision. The sole immediate consequence is physical: if the
  // digit under a perch changes, the Tenant necessarily loses its footing.
  useEffect(() => {
    if (rollKey === null) return;
    const rolled = rolledRef.current;
    mindRef.current = noticePetStimulus(mindRef.current, rolled < 2 ? 'hour' : 'minute');
    if (poseRef.current === 'perched' && perchRef.current !== DOTS_SPOT && rolled <= perchRef.current) act.current.fall();
  }, [rollKey]);

  // Weather and sleep change the underlying drives and styling. They do not
  // choose a gesture; the next free decision still has the full action set.
  useEffect(() => {
    const before = previousMood.current;
    previousMood.current = mood;
    if (before === mood) return;
    mindRef.current = noticePetStimulus(mindRef.current, 'weather');
  }, [mood]);

  // A hidden tab freezes CSS animations while timers keep (slowly) firing, so
  // a pose reached while hidden may be drawn half-way. Coming back, jump home
  // from wherever the Tenant is through the shared jump pipeline.
  useEffect(() => {
    const resume = () => {
      if (document.hidden || poseRef.current === 'rest') return;
      setSitting(false);
      if (poseRef.current === 'charging' || poseRef.current === 'jumping' || poseRef.current === 'visiting') act.current.roamHome();
      else act.current.jumpHome();
    };
    document.addEventListener('visibilitychange', resume);
    const pending = timers.current;
    return () => {
      document.removeEventListener('visibilitychange', resume);
      if (rootAnimation.current) {
        rootAnimation.current.onfinish = null;
        rootAnimation.current.cancel();
        rootAnimation.current = null;
      }
      for (const id of pending) window.clearTimeout(id);
      pending.clear();
    };
  }, []);

  const perch = targets.perch[perchIndex] ?? targets.perch[3] ?? FALLBACK_PERCH;
  const style = {
    ...TENANT_PATH_STYLES,
    '--tenant-left': targets.rest.left + 'px',
    '--tenant-top': targets.rest.top + 'px',
    '--perch-x': perch.x + 'px',
    '--perch-y': perch.y + 'px',
    '--slide': perch.slide,
    '--peek-side': -perch.slide,
    '--from-x': from.x + 'px',
    '--from-y': from.y + 'px',
    '--world-x': (worldTarget?.x ?? 0) + 'px',
    '--world-y': (worldTarget?.y ?? 0) + 'px',
    '--hop-from-x': (hop?.from.x ?? 0) + 'px',
    '--hop-from-y': (hop?.from.y ?? 0) + 'px',
    '--hop-to-x': (hop?.to.x ?? 0) + 'px',
    '--hop-to-y': (hop?.to.y ?? 0) + 'px',
    '--hop-ms': (hop?.duration ?? 700) + 'ms',
    '--charge-ms': (hop?.chargeMs ?? 500) + 'ms',
    '--figure-from': figureFrom,
    '--inner-gest-from': innerHandoff?.gest ?? 'matrix(1, 0, 0, 1, 0, 0)',
    '--inner-pupils-from': innerHandoff?.pupils ?? 'matrix(1, 0, 0, 1, 0, 0)',
    '--inner-face-from': innerHandoff?.face ?? 'matrix(1, 0, 0, 1, 0, 0)',
    '--inner-tail-from': innerHandoff?.tail ?? 'matrix(1, 0, 0, 1, 0, 0)',
    '--inner-foot-from': innerHandoff?.foot ?? 'matrix(1, 0, 0, 1, 0, 0)',
    '--inner-foot-b-from': innerHandoff?.footB ?? 'matrix(1, 0, 0, 1, 0, 0)',
  } as CSSProperties;

  const className = ['tenant', 'mood-' + mood, 'pose-' + pose,
    onTop ? 'on-' + perch.kind : '',
    gesture ? 'g-' + gesture.action : '',
    gesture?.action === 'glance-digits' && nextDigit <= 1 ? 'g-far' : '',
    perchAction ? 'pa-' + perchAction.action : '',
    sitting && pose === 'perched' ? 'sitting' : '',
    worldTarget ? 'visit-' + worldTarget.id : '',
    innerHandoff ? 'inner-handoff' : '',
    watch ? (watch > 0 ? 'w-right' : 'w-left') : ''].filter(Boolean).join(' ');

  return <div className={className} style={style} aria-hidden="true" ref={elementRef}>
    <svg viewBox="0 0 100 100">
      <defs>
        <clipPath id="tenant-eye-mask"><ellipse cx="34" cy="54" rx="11" ry="13" /><ellipse cx="66" cy="54" rx="11" ry="13" /></clipPath>
      </defs>
      <g className="t-figure">
      <g className="t-balance"><g className="t-posture">
      <g className="t-rain-drops">
        <rect className="t-drop" x="10" y="0" width="3" height="10" rx="1.5" />
        <rect className="t-drop" x="50" y="0" width="3" height="10" rx="1.5" />
        <rect className="t-drop" x="88" y="0" width="3" height="10" rx="1.5" />
      </g>
      <text className="t-zz" x="80" y="26">z</text>
      <text className="t-zz" x="89" y="16">z</text>
      <g className="t-gest">
      {/* Feet sit behind the body and peek out below it, toes first, the way
          the reference draws them: the belly line runs over them. */}
      <path className="t-foot" d="M31 93 L30 99 M36 94 L36 100 M41 94 L42 99" />
      <path className="t-foot t-foot-b" d="M59 94 L58 99 M64 94 L64 100 M69 93 L70 99" />
      <g className="t-pose">
      {/* The sprout reuses the old tail's secondary-motion layer. It sits
          behind the head and follows a wave, a bounce or a delighted wiggle. */}
      <g className="t-balance-sprout"><g className="t-posture-sprout"><g className="t-tail t-sprout">
        <path className="t-sprout-stem" d="M50 32 Q48 18 46 5" />
        <path className="t-sprout-leaf" d="M46 7 C35 10 29 3 31 -1 C34 -6 44 -2 46 7 Z" />
        <path className="t-sprout-leaf t-sprout-leaf-b" d="M46 7 C45 -2 53 -9 59 -6 C65 -2 57 7 46 7 Z" />
      </g></g></g>
      <path className="t-body" d={TENANT_SHAPES.rest} />
      <path className="t-belly-wash" d="M22 66 C22 83 33 91 51 91 C64 91 74 88 79 83 C76 94 64 93 50 93 C30 94 18 92 20 77 Z" />
      <g className="t-balance-head"><g className="t-posture-head"><g className="t-face">
      {/* The eye rig is the original Tenant geometry scaled into round eyes,
          so every lid, pupil and glance offset in the CSS lands proportionally. */}
      <g transform="translate(4.5 6.5) scale(.91 .77)">
      <ellipse className="t-eye" cx="34" cy="54" rx="11" ry="13" />
      <ellipse className="t-eye" cx="66" cy="54" rx="11" ry="13" />
      <g className="t-pupils">
        <circle className="t-pupil" cx="35" cy="54" r="4.5" />
        <circle className="t-pupil" cx="67" cy="54" r="4.5" />
      </g>
      <g clipPath="url(#tenant-eye-mask)"><rect className="t-lid" x="22" y="40" width="24" height="28" rx="11" /><rect className="t-lid" x="54" y="40" width="24" height="28" rx="11" /></g>
      <ellipse className="t-eye-ring" cx="34" cy="54" rx="11" ry="13" />
      <ellipse className="t-eye-ring" cx="66" cy="54" rx="11" ry="13" />
      <path className="t-eye-happy" d="M27 56 Q34 44 41 56 M59 56 Q66 44 73 56" />
      <path className="t-eye-sleep" d="M27 53 Q34 60 41 53 M59 53 Q66 60 73 53" />
      <g className="t-shades"><rect x="21" y="46" width="26" height="14" rx="5" /><rect x="53" y="46" width="26" height="14" rx="5" /><rect x="47" y="51" width="6" height="3" /></g>
      </g>
      <g className="t-cheeks"><ellipse cx="24" cy="61" rx="4.5" ry="2" /><ellipse cx="76" cy="61" rx="4.5" ry="2" /></g>
      {/* The mouth rig is the original mouth, smaller and lower; the CSS
          d:path() shapes for every mood still apply. */}
      <g transform="translate(17 17) scale(.66)">
      <path className="t-mouth" d="M43 75 Q50 79 57 75" />
      </g>
      <ellipse className="t-sweat" cx="80" cy="38" rx="3" ry="4.5" />
      </g></g></g>
      <g className="t-scarf"><path d="M22 52 C36 62 64 62 78 52 C64 57 36 57 22 52 Z" /><path d="M66 56 L74 72 L62 68 Z" /></g>
      <g>
      <g className="t-leaf">
        <path className="t-leaf-blade" d="M10 18 C29 -6 66 -11 94 6 C75 25 39 30 10 18 Z" />
        <path className="t-leaf-vein" d="M88 7 Q52 10 12 18 M65 10 L73 1 M47 13 L57 22" />
        <path className="t-leaf-stem-outline" d="M12 18 C1 29 5 41 8 54" />
        <path className="t-leaf-stem" d="M12 18 C1 29 5 41 8 54" />
      </g>
      </g>
      <path className="t-grip" d="M6 53 Q9 55 12 54" />
      </g>
      </g>
      </g>
      </g></g>
    </svg>
  </div>;
}
