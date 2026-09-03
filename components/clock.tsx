'use client';

// The clock, its wardrobe, its set pieces and its Tenant.
//
// Three layers sit on the plain clock, and all three are driven from pure
// modules in lib/ so this file only owns timers, measurement and markup:
//
//   outfits     lib/clock-wardrobe.ts   which typeface, colours and date format
//   set pieces  lib/clock-events.ts     choreographed moments, and when they fit
//   the Tenant  lib/clock-tenant.ts     the character beside the minutes
//
// Nothing here may change abruptly. An outfit change keeps the old outfit on
// screen as a fading ghost while the new one fades in, and only starts once the
// new fonts are loaded. A set piece only starts in a quiet part of the minute,
// never over the roll, and every keyframe set begins and ends at rest. The
// Tenant's targets are measured from the digits' real ink, not their cells, so
// it stands on the top of a "1" and shoves the edge of a "7".

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { changedDigits, clockFrame } from '@/lib/clock-motion';
import {
  DEFAULT_OUTFIT, DRESS_MS, nextOutfitDelay, outfitById, outfitDate, pickOutfit, wardrobeContext,
  type Conditions, type OutfitId,
} from '@/lib/clock-wardrobe';
import {
  HOUR_PIECE_DELAY_MS, delayToQuiet, flapSequence, nextEventDelay, pickSetPiece, setPieceById, type SetPieceId,
} from '@/lib/clock-events';
import { inkBox, nextChangingDigit, shouldApproach, tenantMood, tenantTargets, type Targets } from '@/lib/clock-tenant';
import Tenant from './tenant';

// Per-digit variation for the zero-gravity piece, so no two digits drift alike.
const ROTATIONS = ['6deg', '-5deg', '7deg', '-8deg'];
const FLAP_STEP_MS = 230;
// The Tenant is 0.42 of the clock's font size tall and rests 0.08 of it right
// of the last cell.
const TENANT_SIZE_EM = 0.42;
const TENANT_GAP_EM = 0.08;
// The roll takes 680 ms plus stagger; measure the new ink after it has landed.
const ROLL_MS = 900;

type Ghost = { outfit: OutfitId; digits: string; date: string; key: number };
type Piece = { id: SetPieceId; key: number };
type Flap = { text: string; previous: string };

export default function Clock({ now, conditions = null }: { now: Date | null; conditions?: Conditions | null }) {
  const [frame, setFrame] = useState(() => clockFrame(now));
  const next = clockFrame(now, frame);
  if (next !== frame) setFrame(next);
  const digits = changedDigits(next);

  const [outfit, setOutfit] = useState<OutfitId>(DEFAULT_OUTFIT);
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [piece, setPiece] = useState<Piece | null>(null);
  const [flap, setFlap] = useState<Flap | null>(null);
  const [targets, setTargets] = useState<Targets | null>(null);
  const [reduced, setReduced] = useState(false);

  // The timers read live values through refs so they never have to be rebuilt.
  const blockRef = useRef<HTMLDivElement>(null);
  const nowRef = useRef(now);
  const frameRef = useRef(next);
  const conditionsRef = useRef(conditions);
  const outfitRef = useRef(outfit);
  const busyRef = useRef(false);
  const reducedRef = useRef(false);
  useEffect(() => {
    nowRef.current = now;
    frameRef.current = next;
    conditionsRef.current = conditions;
    outfitRef.current = outfit;
    busyRef.current = ghost !== null || piece !== null;
    reducedRef.current = reduced;
  });
  const lastPiece = useRef<SetPieceId | null>(null);
  const hourPiece = useRef<(() => void) | null>(null);
  const canvas = useRef<CanvasRenderingContext2D | null>(null);
  const timers = useRef(new Set<number>());

  const later = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(() => { timers.current.delete(id); fn(); }, ms);
    timers.current.add(id);
    return id;
  }, []);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReduced(query.matches);
    apply();
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, []);

  // Where the ink of each digit is, in the block's own coordinates, from the
  // cells' boxes and canvas text metrics for the face they are drawn in. Runs
  // after the fonts are ready, after every roll and outfit change, and on
  // resize. Four measureText calls, so it is cheap enough to run each minute.
  const measure = useCallback(() => {
    const block = blockRef.current;
    const clock = block?.querySelector<HTMLElement>(':scope > .clock');
    if (!block || !clock) return;
    const cells = Array.from(clock.querySelectorAll<HTMLElement>('.clock-digit'));
    const text = frameRef.current.text.replace(':', '');
    if (cells.length !== 4 || !/^\d{4}$/.test(text)) { setTargets(null); return; }
    canvas.current ??= document.createElement('canvas').getContext('2d');
    const context = canvas.current;
    if (!context) return;
    const origin = block.getBoundingClientRect();
    const relative = (rect: DOMRect) => ({ left: rect.left - origin.left, top: rect.top - origin.top, right: rect.right - origin.left, bottom: rect.bottom - origin.top });
    const ink = cells.map((cell, index) => {
      const face = cell.querySelector<HTMLElement>('.digit-face:not(.digit-out)') ?? cell;
      const style = getComputedStyle(face);
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const box = relative(cell.getBoundingClientRect());
      return inkBox(box, context.measureText(text[index]), parseFloat(style.lineHeight) || box.bottom - box.top);
    });
    const em = parseFloat(getComputedStyle(clock).fontSize);
    setTargets(tenantTargets(ink, relative(cells[3].getBoundingClientRect()), TENANT_SIZE_EM * em, TENANT_GAP_EM * em));
  }, []);

  // The roll itself: measure the new ink once it has landed and, after an
  // hour roll, schedule the hour set piece. `next` is a new object only when
  // the minute changes.
  const rolled = next.previous !== null;
  useEffect(() => {
    if (!rolled) return;
    later(measure, ROLL_MS);
    if (frameRef.current.text.endsWith(':00')) hourPiece.current?.();
  }, [next, rolled, later, measure]);

  // Signals for the Tenant, derived rather than stored: each is the minute
  // stamp of the moment it describes, so it changes exactly once per minute.
  // One one-second tick per minute lands in the approach window.
  const rollKey = rolled ? next.minute : null;
  const hourKey = rolled && next.text.endsWith(':00') ? next.minute : null;
  const approachKey = now && shouldApproach(now) ? Math.floor(now.getTime() / 60000) : null;

  // Wardrobe and set-piece scheduling. One effect, one set of timers, all
  // cleared on unmount: this display runs for weeks without a reload.
  useEffect(() => {
    let alive = true;

    const scheduleOutfit = (ms: number) => later(changeOutfit, ms);
    const changeOutfit = () => {
      const at = nowRef.current ?? new Date();
      if (busyRef.current || document.hidden) { scheduleOutfit(4000); return; }
      const wait = delayToQuiet(at, DRESS_MS + 400);
      if (wait) { scheduleOutfit(wait); return; }
      const from = outfitRef.current;
      const to = pickOutfit(wardrobeContext(at, conditionsRef.current), Math.random(), from);
      if (to === from) { scheduleOutfit(nextOutfitDelay(Math.random())); return; }
      // Load the new faces first. A font that swaps in halfway through the
      // crossfade is exactly the abrupt change the crossfade exists to avoid.
      Promise.all(outfitById(to).fonts.map(family => document.fonts.load(`700 100px "${family}"`).catch(() => [])))
        .then(() => {
          if (!alive) return;
          const then = nowRef.current ?? new Date();
          const again = delayToQuiet(then, DRESS_MS + 400);
          if (busyRef.current || again) { scheduleOutfit(again || 4000); return; }
          if (!reducedRef.current) {
            setGhost({ outfit: from, digits: frameRef.current.text.replace(':', ''), date: outfitDate(from, then).label, key: Date.now() });
            later(() => setGhost(null), DRESS_MS + 60);
          }
          outfitRef.current = to;
          setOutfit(to);
          later(measure, DRESS_MS + 150);
          scheduleOutfit(nextOutfitDelay(Math.random()));
        });
    };

    const start = (id: SetPieceId) => {
      lastPiece.current = id;
      setPiece({ id, key: Date.now() });
      if (id === 'flap') {
        const frames = flapSequence(frameRef.current.text);
        let previous = frameRef.current.text.replace(':', '');
        frames.forEach((text, index) => {
          const from = previous;
          later(() => setFlap({ text, previous: from }), 300 + index * FLAP_STEP_MS);
          previous = text;
        });
        later(() => setFlap(null), 300 + frames.length * FLAP_STEP_MS + FLAP_STEP_MS);
      }
      later(() => setPiece(current => current?.id === id ? null : current), setPieceById(id).duration + 80);
    };
    const scheduleEvent = (ms: number) => later(() => runEvent(false), ms);
    const runEvent = (atHour: boolean) => {
      if (reducedRef.current) return;
      const at = nowRef.current ?? new Date();
      if (busyRef.current || document.hidden) { if (!atHour) scheduleEvent(4000); return; }
      const choice = pickSetPiece(outfitById(outfitRef.current).morph, atHour, Math.random(), lastPiece.current);
      if (!choice) { if (!atHour) scheduleEvent(nextEventDelay(Math.random())); return; }
      const wait = delayToQuiet(at, choice.duration);
      if (wait) { later(() => runEvent(atHour), wait); return; }
      start(choice.id);
      if (!atHour) scheduleEvent(nextEventDelay(Math.random()));
    };
    hourPiece.current = () => later(() => runEvent(true), HOUR_PIECE_DELAY_MS);

    document.fonts.ready.then(() => {
      if (!alive) return;
      measure();
      scheduleOutfit(nextOutfitDelay(Math.random()));
      scheduleEvent(nextEventDelay(Math.random()));
    });
    later(measure, 2000);
    window.addEventListener('resize', measure);
    const pending = timers.current;
    return () => {
      alive = false;
      hourPiece.current = null;
      window.removeEventListener('resize', measure);
      for (const id of pending) window.clearTimeout(id);
      pending.clear();
    };
  }, [later, measure]);

  const date = outfitDate(outfit, now);
  const context = now ? wardrobeContext(now, conditions) : null;
  const mood = context ? tenantMood(context) : 'awake';
  const nextDigit = now ? nextChangingDigit(now) : 3;

  const className = ['clock-block', 'o-' + outfit,
    piece ? 'sp-' + piece.id : '',
    ghost ? 'is-dressing' : '',
    mood === 'asleep' ? 'is-asleep' : ''].filter(Boolean).join(' ');

  return <div className={className} ref={blockRef}>
    <h1 className={'clock' + (now ? ' is-live' : '')} aria-label={now ? next.text : 'Loading time'}>
      {digits.map(({ digit, previous }, index) => {
        const shown = flap ? flap.text[index] : digit;
        const style = {
          '--roll-delay': (3 - index) * 35 + 'ms', '--d': index * 90 + 'ms', '--rd': (3 - index) * 140 + 'ms',
          '--r': ROTATIONS[index], '--kd': (3 - index) * 70 + 'ms', '--kx': -(3 - index) * 2 + '%',
        } as CSSProperties;
        return <span className={'clock-digit digit-' + index} key={index} aria-hidden="true" style={style}>
          {flap && flap.previous[index] !== shown && <span className="digit-face digit-flap-out" key={'flap-out-' + flap.previous} data-d={flap.previous[index]}>{flap.previous[index]}</span>}
          {!flap && previous !== null && <span className="digit-face digit-out" key={'out-' + next.minute} data-d={previous}>{previous}</span>}
          <span className={'digit-face' + (!flap && previous !== null ? ' digit-in' : '') + (flap && flap.previous[index] !== shown ? ' digit-flap' : '')}
            key={flap ? 'flap-' + flap.text : 'in-' + next.minute} data-d={shown}>{shown}</span>
        </span>;
      })}
      <span className="separator" aria-hidden="true"><span /><span /></span>
    </h1>
    <time className="clock-date" dateTime={date.dateTime} aria-label={now ? 'Date: ' + date.label : 'Loading date'}>{date.label}</time>

    {ghost && <div className={'clock-ghost o-' + ghost.outfit} aria-hidden="true" key={ghost.key}>
      <div className="clock">
        {[...ghost.digits].map((digit, index) => <span className={'clock-digit digit-' + index} key={index} style={{ '--d': index * 90 + 'ms' } as CSSProperties}>
          <span className="digit-face" data-d={digit}>{digit}</span>
        </span>)}
        <span className="separator"><span /><span /></span>
      </div>
      <span className="clock-date">{ghost.date}</span>
    </div>}

    {targets && !reduced && <Tenant mood={mood} targets={targets} approachKey={approachKey} rollKey={rollKey} hourKey={hourKey}
      nextDigit={nextDigit} busy={ghost !== null || piece !== null} />}
  </div>;
}
