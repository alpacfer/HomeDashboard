'use client';

// The Tenant: the small character beside the minutes. See lib/clock-tenant.ts
// for the rules; this file only owns its timers and its SVG.
//
// Voluntary locomotion is always a jump: charge on a measured landing pad,
// follow one parabolic arc, land, and either settle or charge the next hop.
// The route itself is pure logic in lib/clock-tenant.ts; this component only
// advances its timers. Falls and slides remain separate involuntary motions.
//
// The SVG is layered so that animations compose instead of fighting:
//   .tenant    the positioned element: poses (transitions and locomotion keyframes)
//   .t-figure  the whole figure: breathing, the walk bob, the balance on a top
//   .t-gest    body gestures and perch actions: stretch, wiggle, teeter, slip
//   .t-pose    sticky body state with a transition: sitting
// Each layer animates only its own transform, so a slip on a round top runs
// over the sway underneath it and hands back to it without a jump.

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  APPROACH_TIMEOUT_MS, DOTS_SPOT, msToNextMinute, perchDuration, perchIdleDelay, pickDescent,
  pickHourAction, pickIdle, pickPerch, pickPerchAction, pickStrike, tenantHopArc, tenantTravelRoute,
  type Descent, type HopArc, type HourAction, type IdleAction, type Mood, type Perch, type PerchAction, type Strike, type Targets, type TravelPoint, type WorldSpot,
} from '@/lib/clock-tenant';
import {
  advancePetMind, choosePetActivity, commitPetActivity, initialPetMind, noticePetScene, petDecisionDelay,
} from '@/lib/pet-behavior';
import type { Rotation } from '@/lib/panel-rotation';

export type TenantProps = {
  mood: Mood;
  targets: Targets;
  activeScene: Rotation['phase'];
  // Debug-only visual pin. Normal behavior leaves this null.
  previewSpot?: WorldSpot['id'] | null;
  // Debug-only deterministic journey. It takes the real safe-spot route and
  // then holds the destination so sequences can capture the full movement.
  travelSpot?: WorldSpot['id'] | null;
  // The minute stamp of the tick about 1.6 s before the roll, or null: walk
  // over and get ready. Changes once per minute.
  approachKey: number | null;
  // The minute stamp of a roll that just happened, or null: strike the digit,
  // or react from wherever it is standing.
  rollKey: number | null;
  // The minute stamp of an hour roll, or null.
  hourKey: number | null;
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

type Pose = 'rest' | 'approach' | 'strike' | 'walk-home' | 'climbing' | 'perched' | 'descending' | 'falling' | 'sprawled'
  | 'jump' | 'hops' | 'charging' | 'jumping' | 'visiting';

const GESTURE_MS: Record<IdleAction, number> = {
  blink: 270, 'double-blink': 620, 'glance-digits': 1600, 'glance-up': 1600, 'look-around': 1900, smile: 1800,
  stretch: 1400, wiggle: 900, lean: 1900, yawn: 2300, hop: 650,
  scratch: 1700, sneeze: 900, wave: 1500, doze: 2600, listen: 1700,
};
const PERCH_ACTION_MS: Record<PerchAction, number> = { pace: 950, sit: 500, peer: 1700, teeter: 1700, slip: 1000 };
const DESCENT_MS: Record<Descent, number> = { 'climb-down': 1200, 'hop-off': 1050, slide: 1300 };
const HOUR_MS: Record<HourAction, number> = { jump: 1500, hops: 1600 };
const CLIMB_MS = 1700;
const STRIKE_MS = 700;
const WALK_MS = 1100;
const CHARGE_MS = 220;
const WATCH_MS = 1400;
// The digit rolls out from under it: the fall, then a dazed moment on the
// ground before it gets up and walks home.
const FALL_MS = 1000;
const SPRAWL_MS = 800;

const FALLBACK_PERCH: Perch = { x: 0, y: 0, kind: 'flat', pace: 0, slide: 1 };
type TenantActions = {
  walkHome: () => void;
  roamHome: (stableOnly?: boolean) => void;
  startClimb: () => void;
  roamTo: (id: WorldSpot['id']) => void;
  comeDown: (how: Descent) => void;
  fall: () => void;
};

type Hop = HopArc & { from: TravelPoint; to: TravelPoint };

export default function Tenant({ mood, targets, activeScene, previewSpot = null, travelSpot = null, approachKey, rollKey, hourKey, nextDigit, rolledDigit, busy, onPlay, onHome }: TenantProps) {
  const [pose, setPose] = useState<Pose>('rest');
  const [perchIndex, setPerchIndex] = useState(3);
  const [shift, setShift] = useState(0);
  const [sitting, setSitting] = useState(false);
  const [strike, setStrike] = useState<Strike>('shove');
  const [descent, setDescent] = useState<Descent>('climb-down');
  const [gesture, setGesture] = useState<{ action: IdleAction; key: number } | null>(null);
  const [perchAction, setPerchAction] = useState<{ action: PerchAction; key: number } | null>(null);
  const [watch, setWatch] = useState<-1 | 0 | 1>(0);
  const [worldTarget, setWorldTarget] = useState<WorldSpot | null>(null);
  const [hop, setHop] = useState<Hop | null>(null);
  // Where a descent or a fall starts: the element's actual translation at that
  // moment, so a step still in flight or a perch remeasured mid-air never
  // makes it jump.
  const [from, setFrom] = useState({ x: 0, y: 0 });

  // Everything the effects need to read without re-subscribing.
  const elementRef = useRef<HTMLDivElement>(null);
  const poseRef = useRef<Pose>('rest');
  const moodRef = useRef(mood);
  const busyRef = useRef(busy);
  const targetsRef = useRef(targets);
  const perchRef = useRef(perchIndex);
  const shiftRef = useRef(0);
  const rolledRef = useRef(rolledDigit);
  const playRef = useRef(onPlay);
  const worldRef = useRef<WorldSpot | null>(null);
  const sceneRef = useRef(activeScene);
  const previewRef = useRef(previewSpot);
  const travelPreviewRef = useRef(travelSpot);
  const travelPreviewStarted = useRef<WorldSpot['id'] | null>(null);
  const mindRef = useRef(initialPetMind(activeScene));
  const recentGestures = useRef<IdleAction[]>([]);
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
    shiftRef.current = shift;
    rolledRef.current = rolledDigit;
    playRef.current = onPlay;
    worldRef.current = worldTarget;
    previewRef.current = previewSpot;
    travelPreviewRef.current = travelSpot;
  });

  const later = (fn: () => void, ms: number) => {
    const id = window.setTimeout(() => { timers.current.delete(id); fn(); }, ms);
    timers.current.add(id);
    return id;
  };
  const move = (next: Pose) => { poseRef.current = next; setPose(next); };
  const currentPerch = () => targetsRef.current.perch[perchRef.current] ?? FALLBACK_PERCH;
  const tenantSize = () => elementRef.current?.getBoundingClientRect().width || 48;

  // The element's translation right now, in flight or not. Falls back to the
  // perch it is meant to be on.
  const whereNow = () => {
    const perch = currentPerch();
    const fallback = worldRef.current && poseRef.current === 'visiting'
      ? { x: worldRef.current.x, y: worldRef.current.y }
      : hop && (poseRef.current === 'charging' || poseRef.current === 'jumping')
        ? hop.from
      : { x: perch.x + shiftRef.current, y: perch.y };
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

  // A short local return is still a jump. Reading the live transform lets it
  // take off cleanly after a strike or a fall without teleporting to a pose.
  const walkHome = () => {
    journey.current += 1;
    setFrom(whereNow());
    setHop(null);
    move('walk-home');
    later(() => { if (poseRef.current === 'walk-home') move('rest'); }, WALK_MS);
  };

  const travel = (to: TravelPoint, arrived: () => void, safe = targetsRef.current.safe) => {
    const token = ++journey.current;
    const start = whereNow();
    const route = tenantTravelRoute(start, to, safe, tenantSize());
    const take = (from: TravelPoint, index: number) => {
      if (journey.current !== token) return;
      const next = route[index];
      if (!next) { setHop(null); arrived(); return; }
      const arc = tenantHopArc(from, next, tenantSize());
      setHop({ from, to: next, ...arc });
      move('charging');
      later(() => {
        if (journey.current !== token || poseRef.current !== 'charging') return;
        move('jumping');
        later(() => {
          if (journey.current !== token || poseRef.current !== 'jumping') return;
          take(next, index + 1);
        }, arc.duration);
      }, CHARGE_MS);
    };
    take(start, 0);
  };

  const roamHome = (stableOnly = false) => {
    if (!worldRef.current && poseRef.current !== 'charging' && poseRef.current !== 'jumping') { walkHome(); return; }
    const safe = stableOnly
      ? targetsRef.current.safe.filter(spot => /^(weather|ribbon|week)-/.test(spot.key) || spot.key === 'destination-weather' || spot.key === 'destination-week')
      : targetsRef.current.safe;
    travel({ x: 0, y: 0 }, () => {
      worldRef.current = null;
      setWorldTarget(null);
      move('rest');
    }, safe);
  };

  const startClimb = (): void => {
    journey.current += 1;
    let index = pickPerch(Math.random());
    if (!targetsRef.current.perch[index]) index = 3;
    const perch = targetsRef.current.perch[index] ?? FALLBACK_PERCH;
    setPerchIndex(index);
    perchRef.current = index;
    setShift(0);
    move('climbing');
    later(() => {
      if (poseRef.current !== 'climbing') return;
      move('perched');
      if (perch.kind === 'ball') playRef.current?.('land');
    }, CLIMB_MS);
    later(() => act.current.comeDown(pickDescent(perch.kind, Math.random())), CLIMB_MS + perchDuration(Math.random(), perch.kind));
  };

  const roamTo = (id: WorldSpot['id']) => {
    const target = targetsRef.current.world.find(spot => spot.id === id);
    if (!target) return;
    worldRef.current = target;
    setWorldTarget(target);
    setGesture(null);
    setWatch(target.look);
    travel(target, () => {
      move('visiting');
      if (!travelPreviewRef.current) later(() => { if (poseRef.current === 'visiting') act.current.roamHome(); }, 4200 + Math.random() * 2600);
    });
  };

  // Come down from a perch by the given route. The keyframes start from
  // wherever it is at this moment.
  const comeDown = (how: Descent) => {
    if (poseRef.current !== 'perched') return;
    journey.current += 1;
    if (currentPerch().kind === 'ball') playRef.current?.('spring');
    setFrom(whereNow());
    setSitting(false);
    setPerchAction(null);
    setDescent(how);
    move('descending');
    later(() => {
      if (poseRef.current !== 'descending') return;
      setShift(0);
      move('rest');
    }, DESCENT_MS[how]);
  };

  // The digit it is standing on rolls away: stumble, fall to the baseline in
  // front of the digit, lie there a moment, get up and walk home.
  const fall = () => {
    if (poseRef.current !== 'perched') return;
    journey.current += 1;
    setFrom(whereNow());
    setSitting(false);
    setPerchAction(null);
    move('falling');
    later(() => {
      if (poseRef.current !== 'falling') return;
      move('sprawled');
      later(() => {
        if (poseRef.current !== 'sprawled') return;
        setShift(0);
        walkHome();
      }, SPRAWL_MS);
    }, FALL_MS);
  };

  // The effects below call these through a ref, like everything else they
  // read, so none of them has to be rebuilt when a prop changes. Refreshed in
  // an effect, never during render, and always before any timer can fire.
  useEffect(() => { act.current = { walkHome, roamHome, startClimb, roamTo, comeDown, fall }; });

  useEffect(() => { onHome?.(pose === 'rest'); }, [pose, onHome]);

  // One sparse decision loop owns all resting behavior. Slowly changing drives
  // make climbing and roaming arise from accumulated curiosity rather than a
  // second metronome; recent actions are suppressed so special gestures stay
  // surprising. CSS still owns every animation frame.
  useEffect(() => {
    let alive = true;
    const tick = () => {
      if (!alive) return;
      const now = Date.now();
      const elapsed = lastDecisionAt.current ? now - lastDecisionAt.current : 0;
      let mind = advancePetMind(mindRef.current, elapsed, moodRef.current);
      lastDecisionAt.current = now;
      if (!previewRef.current && !travelPreviewRef.current && moodRef.current !== 'asleep' && poseRef.current === 'rest' && !busyRef.current) {
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
          setGesture({ action, key: Date.now() });
          later(() => setGesture(current => current?.action === action ? null : current), GESTURE_MS[action]);
        } else if (decision.kind === 'climb') {
          act.current.startClimb();
        } else if (decision.kind === 'roam') {
          act.current.roamTo(decision.spot);
        }
      }
      mindRef.current = mind;
      later(tick, petDecisionDelay(Math.random(), mind.energy));
    };
    later(tick, petDecisionDelay(Math.random(), mindRef.current.energy));
    return () => { alive = false; };
  }, []);

  // Things it does while perched, chosen by the shape under its feet: pace
  // along a bar, sit down, peer over the edge, teeter on a stem, slip on an
  // arch and catch itself.
  useEffect(() => {
    if (pose !== 'perched') return;
    let alive = true;
    const tick = () => {
      if (!alive || poseRef.current !== 'perched') return;
      if (moodRef.current !== 'asleep') {
        const perch = currentPerch();
        let action = pickPerchAction(perch.kind, Math.random());
        if (action === 'pace' && perch.pace < 4) action = 'peer';
        if (action === 'pace') setShift(shiftRef.current !== 0 ? 0 : (Math.random() < 0.5 ? -1 : 1) * perch.pace);
        if (action === 'sit') setSitting(current => !current);
        setPerchAction({ action, key: Date.now() });
        later(() => setPerchAction(current => current?.action === action ? null : current), PERCH_ACTION_MS[action]);
      }
      later(tick, perchIdleDelay(Math.random()));
    };
    later(tick, perchIdleDelay(Math.random()) * 0.6);
    return () => { alive = false; };
  }, [pose]);

  // The digits were remeasured under it (a roll, an outfit change). The perch
  // transition carries it to the new top; a pacing shift that no longer fits
  // the new plateau is walked back.
  useEffect(() => {
    const perch = targets.perch[perchRef.current];
    if (perch && Math.abs(shiftRef.current) > perch.pace) setShift(0);
  }, [targets]);

  // A visual-test URL may pin one landmark. It skips the trip so a screenshot
  // can inspect the destination pose deterministically; ordinary visits still
  // cross the dashboard using the full roaming choreography.
  useEffect(() => {
    if (!previewSpot) return;
    const target = targets.world.find(spot => spot.id === previewSpot);
    const current = worldRef.current;
    if (!target || (poseRef.current === 'visiting' && current?.id === target.id && current.x === target.x && current.y === target.y)) return;
    worldRef.current = target;
    setWorldTarget(target);
    setGesture(null);
    journey.current += 1;
    setHop(null);
    move('visiting');
  }, [previewSpot, targets]);

  useEffect(() => {
    if (!travelSpot || travelPreviewStarted.current === travelSpot) return;
    const target = targets.world.find(spot => spot.id === travelSpot);
    if (!target) return;
    travelPreviewStarted.current = travelSpot;
    act.current.roamTo(travelSpot);
  }, [travelSpot, targets]);

  // A scene change raises interest in that side of the dashboard. If the old
  // scene disappears while the Tenant is visiting it, come home from the
  // actual current transform; a later decision may investigate the new one.
  useEffect(() => {
    if (sceneRef.current === activeScene) return;
    sceneRef.current = activeScene;
    mindRef.current = noticePetScene(mindRef.current, activeScene);
    if (poseRef.current === 'visiting' || poseRef.current === 'charging' || poseRef.current === 'jumping') act.current.roamHome(true);
    else if (poseRef.current === 'rest' && moodRef.current !== 'asleep') {
      const action: IdleAction = 'listen';
      setGesture({ action, key: Date.now() });
      later(() => setGesture(current => current?.action === action ? null : current), GESTURE_MS[action]);
    }
  }, [activeScene]);

  // Walk over before the roll; if the roll never comes, walk back.
  useEffect(() => {
    if (approachKey === null || poseRef.current !== 'rest' || moodRef.current === 'asleep' || document.hidden) return;
    setGesture(null);
    move('approach');
    later(() => { if (poseRef.current === 'approach') act.current.walkHome(); }, APPROACH_TIMEOUT_MS);
  }, [approachKey]);

  // The digit rolls. Strike it if we are there; fall if standing on it (every
  // digit right of the leftmost changed one changes too); otherwise turn and
  // look at whichever digit moved.
  useEffect(() => {
    if (rollKey === null) return;
    const rolled = rolledRef.current;
    if (poseRef.current === 'approach') {
      setStrike(pickStrike(Math.random()));
      move('strike');
      later(() => { if (poseRef.current === 'strike') act.current.walkHome(); }, STRIKE_MS);
    } else if (poseRef.current === 'perched') {
      const spot = perchRef.current === DOTS_SPOT ? 1.5 : perchRef.current;
      if (perchRef.current !== DOTS_SPOT && rolled <= perchRef.current) {
        act.current.fall();
      } else {
        setWatch(rolled > spot ? 1 : -1);
        later(() => setWatch(0), WATCH_MS);
      }
    } else if (poseRef.current === 'rest' && moodRef.current !== 'asleep') {
      setGesture({ action: 'glance-digits', key: Date.now() });
      later(() => setGesture(current => current?.action === 'glance-digits' ? null : current), GESTURE_MS['glance-digits']);
    } else if (poseRef.current === 'visiting' || poseRef.current === 'charging' || poseRef.current === 'jumping') {
      setWatch(-1);
      later(() => setWatch(worldRef.current?.look ?? 0), WATCH_MS);
    }
  }, [rollKey]);

  // The hour: a jump with a spin, or a pair of hops, from rest. When the roll
  // was struck first, celebrate after walking home.
  useEffect(() => {
    if (hourKey === null || moodRef.current === 'asleep' || document.hidden) return;
    const celebrate = () => {
      if (poseRef.current !== 'rest') return;
      const action: HourAction = pickHourAction(Math.random());
      move(action);
      later(() => { if (poseRef.current === action) move('rest'); }, HOUR_MS[action]);
    };
    if (poseRef.current === 'rest') celebrate();
    else if (poseRef.current === 'strike') later(celebrate, STRIKE_MS + WALK_MS + 150);
    else if (poseRef.current === 'falling') later(celebrate, FALL_MS + SPRAWL_MS + WALK_MS + 150);
    else if (poseRef.current === 'visiting' || poseRef.current === 'charging' || poseRef.current === 'jumping') {
      const action: IdleAction = 'wave';
      setGesture({ action, key: Date.now() });
      later(() => setGesture(current => current?.action === action ? null : current), GESTURE_MS[action]);
    }
  }, [hourKey]);

  // Weather and sleep are changes the Tenant notices, not merely costume
  // switches. The reaction is brief and the mood's persistent styling then
  // carries on underneath it.
  useEffect(() => {
    const before = previousMood.current;
    previousMood.current = mood;
    if (before === mood) return;
    if (mood === 'asleep') {
      if (poseRef.current === 'perched') act.current.comeDown('climb-down');
      else if (poseRef.current === 'approach') act.current.walkHome();
      else if (poseRef.current === 'visiting' || poseRef.current === 'charging' || poseRef.current === 'jumping') act.current.roamHome();
      return;
    }
    if (poseRef.current !== 'rest') return;
    const action: IdleAction = mood === 'cold' ? 'sneeze' : mood === 'hot' ? 'doze' : mood === 'rain' ? 'listen' : 'wiggle';
    setGesture({ action, key: Date.now() });
    later(() => setGesture(current => current?.action === action ? null : current), GESTURE_MS[action]);
  }, [mood]);

  // A hidden tab freezes CSS animations while timers keep (slowly) firing, so
  // a pose reached while hidden may be drawn half-way. Coming back, walk home
  // from wherever the Tenant is; the transition takes it from there.
  useEffect(() => {
    const resume = () => {
      if (document.hidden || poseRef.current === 'rest') return;
      setSitting(false);
      setShift(0);
      journey.current += 1;
      worldRef.current = null;
      setWorldTarget(null);
      setHop(null);
      move('rest');
    };
    document.addEventListener('visibilitychange', resume);
    const pending = timers.current;
    return () => {
      document.removeEventListener('visibilitychange', resume);
      for (const id of pending) window.clearTimeout(id);
      pending.clear();
    };
  }, []);

  const perch = targets.perch[perchIndex] ?? targets.perch[3] ?? FALLBACK_PERCH;
  const style = {
    '--tenant-left': targets.rest.left + 'px',
    '--tenant-top': targets.rest.top + 'px',
    '--push-x': targets.pushX + 'px',
    '--perch-x': perch.x + 'px',
    '--perch-y': perch.y + 'px',
    '--shift': shift + 'px',
    '--slide': perch.slide,
    '--from-x': from.x + 'px',
    '--from-y': from.y + 'px',
    '--world-x': (worldTarget?.x ?? 0) + 'px',
    '--world-y': (worldTarget?.y ?? 0) + 'px',
    '--hop-from-x': (hop?.from.x ?? 0) + 'px',
    '--hop-from-y': (hop?.from.y ?? 0) + 'px',
    '--hop-quarter-x': (hop?.quarter.x ?? 0) + 'px',
    '--hop-quarter-y': (hop?.quarter.y ?? 0) + 'px',
    '--hop-apex-x': (hop?.apex.x ?? 0) + 'px',
    '--hop-apex-y': (hop?.apex.y ?? 0) + 'px',
    '--hop-three-quarter-x': (hop?.threeQuarter.x ?? 0) + 'px',
    '--hop-three-quarter-y': (hop?.threeQuarter.y ?? 0) + 'px',
    '--hop-to-x': (hop?.to.x ?? 0) + 'px',
    '--hop-to-y': (hop?.to.y ?? 0) + 'px',
    '--hop-ms': (hop?.duration ?? 700) + 'ms',
  } as CSSProperties;

  const onTop = pose === 'perched' || pose === 'climbing' || pose === 'descending';
  const className = ['tenant', 'mood-' + mood, 'pose-' + pose,
    onTop ? 'on-' + perch.kind : '',
    pose === 'strike' ? 's-' + strike : '',
    pose === 'descending' ? 'd-' + descent : '',
    gesture ? 'g-' + gesture.action : '',
    gesture?.action === 'glance-digits' && nextDigit <= 1 ? 'g-far' : '',
    perchAction ? 'pa-' + perchAction.action : '',
    perchAction?.action === 'pace' ? 'pacing' : '',
    sitting && pose === 'perched' ? 'sitting' : '',
    worldTarget ? 'visit-' + worldTarget.id : '',
    watch ? (watch > 0 ? 'w-right' : 'w-left') : ''].filter(Boolean).join(' ');

  return <div className={className} style={style} aria-hidden="true" ref={elementRef}>
    <svg viewBox="0 0 100 100">
      <defs>
        <clipPath id="tenant-eye-mask"><ellipse cx="36" cy="54" rx="11" ry="13" /><ellipse cx="64" cy="54" rx="11" ry="13" /></clipPath>
      </defs>
      <g className="t-figure">
      <g className="t-rain-drops">
        <rect className="t-drop" x="10" y="0" width="3" height="10" rx="1.5" />
        <rect className="t-drop" x="50" y="0" width="3" height="10" rx="1.5" />
        <rect className="t-drop" x="88" y="0" width="3" height="10" rx="1.5" />
      </g>
      <text className="t-zz" x="70" y="30">z</text>
      <text className="t-zz" x="80" y="20">z</text>
      <g className="t-gest">
      <ellipse className="t-foot" cx="38" cy="96" rx="9" ry="4" />
      <ellipse className="t-foot t-foot-b" cx="62" cy="96" rx="9" ry="4" />
      <g className="t-pose">
      <path className="t-tail" d="M82 71 C102 66 101 51 91 49" />
      <g className="t-ears"><path d="M28 32 Q19 12 39 25 Z" /><path d="M61 25 Q81 12 72 32 Z" /></g>
      <path className="t-body" d="M50 22 C74 22 88 40 88 62 C88 84 72 96 50 96 C28 96 12 84 12 62 C12 40 26 22 50 22 Z" />
      <g className="t-face">
      <ellipse className="t-cheek" cx="27" cy="70" rx="6" ry="4" />
      <ellipse className="t-cheek" cx="73" cy="70" rx="6" ry="4" />
      <ellipse className="t-eye" cx="36" cy="54" rx="11" ry="13" />
      <ellipse className="t-eye" cx="64" cy="54" rx="11" ry="13" />
      <g className="t-pupils">
        <circle className="t-pupil" cx="37" cy="56" r="5.5" />
        <circle className="t-pupil" cx="65" cy="56" r="5.5" />
      </g>
      <g clipPath="url(#tenant-eye-mask)"><rect className="t-lid" x="24" y="40" width="24" height="28" rx="11" /><rect className="t-lid" x="52" y="40" width="24" height="28" rx="11" /></g>
      <path className="t-mouth" d="M43 75 Q50 79 57 75" />
      <g className="t-shades"><rect x="23" y="46" width="26" height="14" rx="5" /><rect x="51" y="46" width="26" height="14" rx="5" /><rect x="47" y="51" width="6" height="3" /></g>
      <ellipse className="t-sweat" cx="80" cy="44" rx="3" ry="4.5" />
      </g>
      <g className="t-scarf"><path d="M18 78 C30 90 70 90 82 78 C70 84 30 84 18 78 Z" /><path d="M72 82 L80 98 L70 96 Z" /></g>
      <g className="t-leaf">
        <path className="t-leaf-blade" d="M12 18 C32 -6 66 -14 97 4 C80 26 48 32 14 23 L20 19 L12 21 L18 15 Z" />
        <path className="t-leaf-vein" d="M92 5 C67 8 41 13 16 20 M68 9 L76 -1 M52 12 L59 24 M43 14 L34 4 M29 17 L23 25" />
        <path className="t-leaf-stem-outline" d="M15 18 C-4 22 -7 37 5 54 C15 68 14 86 8 101" />
        <path className="t-leaf-stem" d="M15 18 C-4 22 -7 37 5 54 C15 68 14 86 8 101" />
      </g>
      <g className="t-arm">
        <path className="t-arm-blob" d="M20 62 C12 59 4 64 4 71 C4 78 10 82 16 78 C20 75 21 69 20 62 Z" />
        <path className="t-grip" d="M8 68 L8.5 74 M11 67 L11.5 72" />
      </g>
      </g>
      </g>
      </g>
    </svg>
  </div>;
}
