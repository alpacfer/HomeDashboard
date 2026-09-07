'use client';

// The Tenant: the small character beside the minutes. See lib/clock-tenant.ts
// for the rules. This file owns the state and the timing of its life; what it
// does is components/tenant-actions.ts, what it looks like is
// components/tenant-figure.tsx, and how its nested layers are animated is
// components/use-track-animation.ts.
//
// Intentional locomotion is always the same jump: charge on a measured pad,
// follow one parabolic arc, land, and either settle or charge the next hop.
// Geometry is pure logic in lib/clock-tenant.ts; spring and flight tracks are
// precomputed in lib/tenant-motion.ts and played by the Web Animations API.
// Flight stages advance on animation completion, never a competing timer.
// CSS gestures still get a short painted-frame grace after their nominal
// duration. Interruptions capture live transforms before replacing them.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  DOTS_SPOT, msToNextMinute, perchIdleDelay, pickIdle, pickPerchAction,
  type IdleAction, type Mood, type Targets, type TravelPoint, type WorldSpot,
} from '@/lib/clock-tenant';
import {
  advancePetMind, canAdventureAt, choosePetActivity, commitPetActivity, fitsBeforeRoll, initialPetMind, noticePetScene,
  noticePetStimulus, petDecisionDelay, rememberRecent,
} from '@/lib/pet-behavior';
import type { Rotation } from '@/lib/panel-rotation';
import { TENANT_PATH_STYLES } from '@/lib/tenant-drawing';
import { PERCH_ACTION_MS, peersAt, tenantClassName } from '@/lib/tenant-view';
import { balanceClip, postureClip, type MotionClip } from '@/lib/tenant-motion';
import { debugFlags } from '@/lib/debug-flags';
import {
  FALLBACK_PERCH, INNER_HANDOFF_MS, MOTION_SETTLE_MS, TenantController,
  type Hop, type InnerHandoff, type Pose, type TimedGesture, type TimedPerchAction,
} from './tenant-actions';
import { TenantFigure } from './tenant-figure';
import { useTrackAnimation } from './use-track-animation';

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
};

// The nested layers each motion track drives, body, head and sprout. Module
// constants, because they are dependencies of the effect that animates them.
const BALANCE_LAYERS = ['.t-balance', '.t-balance-head', '.t-balance-sprout'];
const POSTURE_LAYERS = ['.t-posture', '.t-posture-head', '.t-posture-sprout'];
const IDENTITY = 'matrix(1, 0, 0, 1, 0, 0)';

export default function Tenant({ mood, targets, activeScene, previewSpot = null, travelSpot = null, rollKey, nextDigit, rolledDigit, busy, onPlay }: TenantProps) {
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
  const [figureFrom, setFigureFrom] = useState(IDENTITY);
  // Where a fall starts: the element's actual translation at that moment, so
  // a remeasured perch never makes it jump.
  const [from, setFrom] = useState<TravelPoint>({ x: 0, y: 0 });
  // Which balance the figure keeps on its current top. Drawn when the perch is
  // chosen (an event), so the clip below is a pure function of its inputs.
  const [balanceSeed, setBalanceSeed] = useState(0.5);

  // Everything the controller and the effects read without re-subscribing.
  const elementRef = useRef<HTMLDivElement>(null);
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
  const gestureRef = useRef<TimedGesture | null>(null);
  const perchActionRef = useRef<TimedPerchAction | null>(null);
  const hopRef = useRef<Hop | null>(null);
  const mindRef = useRef(initialPetMind(activeScene));
  const recentGestures = useRef<IdleAction[]>([]);
  const lastDecisionAt = useRef(0);
  const previousMood = useRef(mood);
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
    hopRef.current = hop;
  });

  // Built once: the refs and the setters it closes over never change.
  const [ctl] = useState(() => new TenantController(
    {
      element: elementRef, pose: poseRef, targets: targetsRef, perch: perchRef, play: playRef, world: worldRef,
      travelPreview: travelPreviewRef, gesture: gestureRef, perchAction: perchActionRef, hop: hopRef,
    },
    {
      pose: setPose, perchIndex: setPerchIndex, sitting: setSitting, gesture: setGesture, perchAction: setPerchAction,
      visitPosture: setVisitPosture, watch: setWatch, worldTarget: setWorldTarget, hop: setHop, innerHandoff: setInnerHandoff,
      figureFrom: setFigureFrom, from: setFrom, balanceSeed: setBalanceSeed,
    },
    motionPreview,
  ));

  // Retire the filled root animation only after React has painted the new
  // resting/perched location into the DOM. No one-frame flash back home.
  useLayoutEffect(() => {
    if (pose === 'charging' || pose === 'jumping') return;
    ctl.retireRootAnimation();
  }, [pose, ctl]);

  // Balance on a top, and posture during a gesture or a visit: two motion
  // tracks on two sets of nested layers, played the same way.
  const onTop = pose === 'perched';
  const topKind = targets.perch[perchIndex]?.kind ?? 'flat';
  const balance = useMemo(() => onTop ? balanceClip(topKind, motionPreview ? 0.42 : balanceSeed) : null, [onTop, topKind, motionPreview, balanceSeed]);
  useTrackAnimation(elementRef, BALANCE_LAYERS, balance, INNER_HANDOFF_MS);
  const posture = gesture?.clip ?? perchAction?.clip ?? (pose === 'visiting' ? visitPosture : undefined);
  useTrackAnimation(elementRef, POSTURE_LAYERS, posture, INNER_HANDOFF_MS);

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
        // A hidden page runs no animation frames, so a journey started there
        // would arrive nowhere (docs/DEBUGGING.md, "Three traps").
        const canAdventure = canAdventureAt(msToNextMinute(new Date(now))) && !document.hidden;
        const decision = choosePetActivity(mind, {
          mood: moodRef.current,
          scene: sceneRef.current,
          spots: targetsRef.current.world.map(spot => spot.id),
          canAdventure,
        }, Math.random());
        mind = commitPetActivity(mind, decision);
        if (decision.kind === 'idle') {
          const action = pickIdle(Math.random(), false, recentGestures.current, mind.energy);
          recentGestures.current = rememberRecent(recentGestures.current, action);
          if (action === 'hop') ctl.jumpTo({ x: 0, y: 0 }, () => ctl.move('rest'), []);
          else ctl.startGesture(action);
        } else if (decision.kind === 'perch') {
          ctl.perchOnDigit();
        } else if (decision.kind === 'roam') {
          ctl.roamTo(decision.spot);
        }
      }
      mindRef.current = mind;
      ctl.later(tick, petDecisionDelay(Math.random(), mind.energy));
    };
    ctl.later(tick, petDecisionDelay(Math.random(), mindRef.current.energy));
    return () => { alive = false; };
  }, [motionPreview, ctl]);

  // Things it does while perched, chosen by the shape under its feet: sit,
  // peer over the edge, teeter on a stem, or slip and catch itself.
  useEffect(() => {
    if (pose !== 'perched' || motionPreview) return;
    let alive = true;
    const tick = () => {
      if (!alive || poseRef.current !== 'perched') return;
      if (moodRef.current !== 'asleep' && !perchActionRef.current) {
        const action = pickPerchAction(ctl.currentPerch().kind, Math.random());
        // Do not start a flourish that the next digit roll can remove from
        // underneath it. The roll itself remains authoritative if already due.
        if (fitsBeforeRoll(msToNextMinute(new Date()), PERCH_ACTION_MS[action], MOTION_SETTLE_MS) && ctl.startPerchAction(action)) {
          if (action === 'sit') setSitting(current => !current);
        }
      }
      ctl.later(tick, perchIdleDelay(Math.random()));
    };
    ctl.later(tick, perchIdleDelay(Math.random()) * 0.6);
    return () => { alive = false; };
  }, [pose, motionPreview, ctl]);

  // Reproduce real spring tracks and the real jump pipeline for captures;
  // changing a CSS class cannot launch a browser-owned procedural animation.
  useEffect(() => {
    if (!motionPreview) return;
    const timer = window.setTimeout(() => {
      if (motionPreview === 'hop') {
        ctl.jumpTo({ x: 0, y: 0 }, () => ctl.move('rest'), []);
        return;
      }
      const index = Math.max(0, targets.perch.findIndex(perch => perch.kind === 'round'));
      setPerchIndex(index);
      perchRef.current = index;
      ctl.move('perched');
      if (motionPreview === 'peek') ctl.startPerchAction('peer');
    }, 600);
    return () => window.clearTimeout(timer);
  }, [motionPreview, targets, ctl]);

  // A visual-test URL may pin one landmark. It skips the trip so a screenshot
  // can inspect the destination pose deterministically; ordinary visits still
  // cross the dashboard using the full roaming choreography.
  useEffect(() => {
    if (!previewSpot || motionPreview) return;
    const target = targets.world.find(spot => spot.id === previewSpot);
    const current = worldRef.current;
    if (!target || (poseRef.current === 'visiting' && current?.id === target.id && current.x === target.x && current.y === target.y)) return;
    ctl.holdAt(target, peersAt(target.id) ? postureClip('peer', 0.37, target.look) : undefined);
  }, [previewSpot, targets, motionPreview, ctl]);

  // Restarted whenever the landmark is remeasured rather than guarded by a ref
  // that outlives a remount: such a guard survived React's development remount
  // while the timers it had started did not, which stranded the debug journey
  // in its opening charge for good. `targets` only changes when the clock is
  // remeasured, so this re-aims during the initial settle and then holds.
  useEffect(() => {
    if (!travelSpot || motionPreview || !targets.world.some(spot => spot.id === travelSpot)) return;
    ctl.roamTo(travelSpot);
  }, [travelSpot, targets, motionPreview, ctl]);

  // A scene change raises interest in that side of the dashboard. If the old
  // scene disappears while the Tenant is visiting it, come home from the
  // actual current transform; a later decision may investigate the new one.
  // Merely seeing a new scene changes interest but never dictates a gesture.
  useEffect(() => {
    if (sceneRef.current === activeScene) return;
    sceneRef.current = activeScene;
    mindRef.current = noticePetScene(mindRef.current, activeScene);
    if (poseRef.current === 'visiting' || poseRef.current === 'charging' || poseRef.current === 'jumping') ctl.roamHome(true);
  }, [activeScene, ctl]);

  // A minute roll is a stimulus, not an appointment. It raises curiosity for
  // a later free decision. The sole immediate consequence is physical: if the
  // digit under a perch changes, the Tenant necessarily loses its footing.
  useEffect(() => {
    if (rollKey === null) return;
    const rolled = rolledRef.current;
    mindRef.current = noticePetStimulus(mindRef.current, rolled < 2 ? 'hour' : 'minute');
    if (poseRef.current === 'perched' && perchRef.current !== DOTS_SPOT && rolled <= perchRef.current) ctl.fall();
  }, [rollKey, ctl]);

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
  // from wherever the Tenant is through the shared jump pipeline. On unmount
  // the controller cancels its animation and clears every timer it started.
  useEffect(() => {
    const resume = () => {
      if (document.hidden || poseRef.current === 'rest') return;
      setSitting(false);
      if (poseRef.current === 'charging' || poseRef.current === 'jumping' || poseRef.current === 'visiting') ctl.roamHome();
      else ctl.jumpHome();
    };
    document.addEventListener('visibilitychange', resume);
    return () => {
      document.removeEventListener('visibilitychange', resume);
      ctl.dispose();
    };
  }, [ctl]);

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
    '--figure-from': figureFrom,
    '--inner-gest-from': innerHandoff?.gest ?? IDENTITY,
    '--inner-pupils-from': innerHandoff?.pupils ?? IDENTITY,
    '--inner-face-from': innerHandoff?.face ?? IDENTITY,
    '--inner-tail-from': innerHandoff?.tail ?? IDENTITY,
    '--inner-foot-from': innerHandoff?.foot ?? IDENTITY,
    '--inner-foot-b-from': innerHandoff?.footB ?? IDENTITY,
  } as CSSProperties;

  const className = tenantClassName({
    mood, pose, perch, onTop, gesture, perchAction, sitting, worldTarget,
    innerHandoff: !!innerHandoff, nextDigit, watch,
  });

  return <div className={className} style={style} aria-hidden="true" ref={elementRef}>
    <TenantFigure />
  </div>;
}
