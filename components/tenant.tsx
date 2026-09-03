'use client';

// The Tenant: the small character beside the minutes. See lib/clock-tenant.ts
// for the rules; this file only owns its timers and its SVG.
//
// Locomotion is CSS transitions on transform, not keyframes, wherever a move
// can be interrupted: a transition always continues from wherever the Tenant
// is, so an approach cut short by a late roll never jumps. Keyframes are used
// only for self-contained gestures (the hour jump, the climb) whose keyframes
// begin and end at the pose the surrounding classes already describe.

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  APPROACH_TIMEOUT_MS, climbDelay, idleDelay, msToNextMinute, perchDuration, pickIdle, type IdleAction, type Mood, type Targets,
} from '@/lib/clock-tenant';

export type TenantProps = {
  mood: Mood;
  targets: Targets;
  // The minute stamp of the tick about 1.6 s before the roll, or null: walk
  // over and get ready. Changes once per minute.
  approachKey: number | null;
  // The minute stamp of a roll that just happened, or null: shove the digit,
  // or bounce if standing on it.
  rollKey: number | null;
  // The minute stamp of an hour roll, or null.
  hourKey: number | null;
  // The leftmost digit that will change next, to aim the glance.
  nextDigit: number;
  // True while the outfit is crossfading or a set piece is running.
  busy: boolean;
};

type Pose = 'rest' | 'approach' | 'shove' | 'climbing' | 'perched' | 'descending' | 'jump';

const GESTURE_MS: Record<IdleAction, number> = { blink: 200, 'double-blink': 560, 'glance-digits': 1600, 'glance-up': 1600, smile: 1800 };
const CLIMB_MS = 1700;
const DESCEND_MS = 1200;
const JUMP_MS = 1500;
const SHOVE_MS = 700;

export default function Tenant({ mood, targets, approachKey, rollKey, hourKey, nextDigit, busy }: TenantProps) {
  const [pose, setPose] = useState<Pose>('rest');
  const [perchIndex, setPerchIndex] = useState(3);
  const [gesture, setGesture] = useState<{ action: IdleAction; key: number } | null>(null);
  const [bounce, setBounce] = useState(false);

  // Everything the effects need to read without re-subscribing.
  const poseRef = useRef<Pose>('rest');
  const moodRef = useRef(mood);
  const busyRef = useRef(busy);
  const timers = useRef(new Set<number>());
  useEffect(() => {
    poseRef.current = pose;
    moodRef.current = mood;
    busyRef.current = busy;
  });

  const later = (fn: () => void, ms: number) => {
    const id = window.setTimeout(() => { timers.current.delete(id); fn(); }, ms);
    timers.current.add(id);
    return id;
  };
  const move = (next: Pose) => { poseRef.current = next; setPose(next); };

  // Idle life: blinks and glances while resting or perched, nothing while asleep.
  useEffect(() => {
    let alive = true;
    const tick = () => {
      if (!alive) return;
      const awake = moodRef.current !== 'asleep';
      const settled = poseRef.current === 'rest' || poseRef.current === 'perched';
      if (awake && settled) {
        const action = pickIdle(Math.random());
        setGesture({ action, key: Date.now() });
        later(() => setGesture(current => current?.action === action ? null : current), GESTURE_MS[action]);
      }
      later(tick, idleDelay(Math.random()));
    };
    later(tick, idleDelay(Math.random()));
    return () => { alive = false; };
  }, []);

  // Now and then, climb onto a digit, sit a while, come back down. Not in the
  // seconds around the minute boundary: the approach owns those.
  useEffect(() => {
    let alive = true;
    const tick = () => {
      if (!alive) return;
      const remaining = msToNextMinute(new Date());
      const clear = remaining > 4000 && remaining < 58000 && !document.hidden;
      if (clear && poseRef.current === 'rest' && moodRef.current !== 'asleep' && !busyRef.current) {
        setPerchIndex(Math.floor(Math.random() * 4));
        move('climbing');
        later(() => { if (poseRef.current === 'climbing') move('perched'); }, CLIMB_MS);
        later(() => {
          if (poseRef.current !== 'perched') return;
          move('descending');
          later(() => { if (poseRef.current === 'descending') move('rest'); }, DESCEND_MS);
        }, CLIMB_MS + perchDuration(Math.random()));
      }
      later(tick, climbDelay(Math.random()));
    };
    later(tick, climbDelay(Math.random()));
    return () => { alive = false; };
  }, []);

  // Walk over before the roll; if the roll never comes, walk back.
  useEffect(() => {
    if (approachKey === null || poseRef.current !== 'rest' || moodRef.current === 'asleep' || document.hidden) return;
    move('approach');
    later(() => { if (poseRef.current === 'approach') move('rest'); }, APPROACH_TIMEOUT_MS);
  }, [approachKey]);

  // The digit rolls: shove it if we are there, bounce if we are standing on it.
  useEffect(() => {
    if (rollKey === null) return;
    if (poseRef.current === 'approach') {
      move('shove');
      later(() => { if (poseRef.current === 'shove') move('rest'); }, SHOVE_MS);
    } else if (poseRef.current === 'perched') {
      setBounce(true);
      later(() => setBounce(false), 700);
    }
  }, [rollKey]);

  // The hour: a jump with a spin, from rest only.
  useEffect(() => {
    if (hourKey === null || poseRef.current !== 'rest' || moodRef.current === 'asleep' || document.hidden) return;
    move('jump');
    later(() => { if (poseRef.current === 'jump') move('rest'); }, JUMP_MS);
  }, [hourKey]);

  // Falling asleep brings it down from wherever it is.
  useEffect(() => {
    if (mood !== 'asleep' || poseRef.current === 'rest') return;
    if (poseRef.current === 'perched') {
      move('descending');
      later(() => { if (poseRef.current === 'descending') move('rest'); }, DESCEND_MS);
    } else if (poseRef.current === 'approach') {
      move('rest');
    }
  }, [mood]);

  // A hidden tab freezes CSS animations while timers keep (slowly) firing, so
  // a pose reached while hidden may be drawn half-way. Coming back, walk home
  // from wherever the Tenant is; the transition takes it from there.
  useEffect(() => {
    const resume = () => { if (!document.hidden && poseRef.current !== 'rest') move('rest'); };
    document.addEventListener('visibilitychange', resume);
    const pending = timers.current;
    return () => {
      document.removeEventListener('visibilitychange', resume);
      for (const id of pending) window.clearTimeout(id);
      pending.clear();
    };
  }, []);

  const perch = targets.perch[perchIndex] ?? targets.perch[targets.perch.length - 1];
  const style = {
    '--tenant-left': targets.rest.left + 'px',
    '--tenant-top': targets.rest.top + 'px',
    '--push-x': targets.pushX + 'px',
    '--perch-x': perch.x + 'px',
    '--perch-y': perch.y + 'px',
  } as CSSProperties;

  const className = ['tenant', 'mood-' + mood, 'pose-' + pose,
    gesture ? 'g-' + gesture.action : '',
    gesture?.action === 'glance-digits' && nextDigit <= 1 ? 'g-far' : '',
    bounce ? 'bouncing' : ''].filter(Boolean).join(' ');

  return <div className={className} style={style} aria-hidden="true">
    <svg viewBox="0 0 100 100">
      <g className="t-figure">
      <g className="t-rain-drops">
        <rect className="t-drop" x="10" y="0" width="3" height="10" rx="1.5" />
        <rect className="t-drop" x="50" y="0" width="3" height="10" rx="1.5" />
        <rect className="t-drop" x="88" y="0" width="3" height="10" rx="1.5" />
      </g>
      <text className="t-zz" x="70" y="30">z</text>
      <text className="t-zz" x="80" y="20">z</text>
      <ellipse className="t-foot" cx="38" cy="96" rx="9" ry="4" />
      <ellipse className="t-foot t-foot-b" cx="62" cy="96" rx="9" ry="4" />
      <path className="t-body" d="M50 22 C74 22 88 40 88 62 C88 84 72 96 50 96 C28 96 12 84 12 62 C12 40 26 22 50 22 Z" />
      <ellipse className="t-cheek" cx="27" cy="70" rx="6" ry="4" />
      <ellipse className="t-cheek" cx="73" cy="70" rx="6" ry="4" />
      <ellipse className="t-eye" cx="36" cy="54" rx="11" ry="13" />
      <ellipse className="t-eye" cx="64" cy="54" rx="11" ry="13" />
      <circle className="t-pupil" cx="37" cy="56" r="5.5" />
      <circle className="t-pupil" cx="65" cy="56" r="5.5" />
      <rect className="t-lid" x="24" y="40" width="24" height="28" rx="11" />
      <rect className="t-lid" x="52" y="40" width="24" height="28" rx="11" />
      <path className="t-mouth" d="M43 75 Q50 79 57 75" />
      <g className="t-shades"><rect x="23" y="46" width="26" height="14" rx="5" /><rect x="51" y="46" width="26" height="14" rx="5" /><rect x="47" y="51" width="6" height="3" /></g>
      <g className="t-scarf"><path d="M18 78 C30 90 70 90 82 78 C70 84 30 84 18 78 Z" /><path d="M72 82 L80 98 L70 96 Z" /></g>
      <g className="t-umbrella"><path className="t-canopy" d="M8 40 Q50 -4 92 40 Z" /><path className="t-canopy-rib" d="M8 40 Q29 30 50 40 Q71 30 92 40" /><rect className="t-handle" x="49" y="38" width="2.5" height="24" /></g>
      <ellipse className="t-sweat" cx="80" cy="44" rx="3" ry="4.5" />
      </g>
    </svg>
  </div>;
}
