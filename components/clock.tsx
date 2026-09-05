'use client';

// The clock widget: one enclosed card holding the time, the date and the
// Tenant's home.
//
// The card is a frame with its own background layer (.clock-surface) and, above
// it, the block the clock has always been. The block is still the Tenant's
// coordinate origin, so every perch, safe spot and world landmark it measures
// stays in the block's own pixels; the card does not clip, because the
// character leaves it to visit the rest of the dashboard.
//
// This file owns timers, measurement and markup. What the clock does not do
// any more is dress itself or play set pieces: the wardrobe and the eight
// choreographed moments are shelved in assets/clock-behavior/, along with the
// CSS they animated. The custom properties they set are still the ones these
// rules read, so restoring them is putting the two stylesheets back and
// scheduling them again. See docs/CLOCK.md.
//
// The Tenant's targets are measured from the digits' real ink, not their cells,
// so it stands on the top of a "1" and shoves the edge of a "7".

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { changedDigits, clockDate, clockFrame } from '@/lib/clock-motion';
import { moodContext, type Conditions } from '@/lib/clock-conditions';
import {
  inkBox, inkColumns, landingSpotTarget, nextChangingDigit, tenantMood, tenantTargets, topProfile, worldSpotTarget,
  type Box, type Targets, type WorldSpotId,
} from '@/lib/clock-tenant';
import type { Rotation } from '@/lib/panel-rotation';
import { DEFAULT_CLOCK_THEME, clockTheme, clockThemeClass, hasScenery } from '@/lib/clock-theme';
import { clockSky, parsePinnedSky } from '@/lib/clock-sky';
import Tenant from './tenant';

// The Tenant is 0.42 of the clock's font size tall and rests 0.08 of it right
// of the last cell.
const TENANT_SIZE_EM = 0.42;
const TENANT_GAP_EM = 0.08;
// The roll takes 680 ms plus stagger; measure the new ink after it has landed.
const ROLL_MS = 900;
// Each digit is also drawn at this size on a small canvas to read the shape of
// its top (a bar, a stem, an arch), which decides how the Tenant stands on it.
const PROFILE_PX = 96;
const PROFILE_W = 160;
const PROFILE_H = 150;
// How long the colon's dots squash after the Tenant lands on them.
const PLAY_MS = 900;

// The theme as an external store, read once per load. A theme is a name from
// the URL, so the snapshot is a string and stays equal to itself between
// renders; nothing ever changes it, so the subscription is a no-op unsubscribe
// rather than a listener that would have to be torn down.
const subscribeToNothing = () => () => undefined;
const urlTheme = () => clockTheme(window.location.search);
const serverTheme = () => DEFAULT_CLOCK_THEME;
// The `?sky=` pin travels as its raw string rather than as the parsed object,
// because a snapshot has to stay equal to itself between renders and a fresh
// object literal never is.
const urlSky = () => new URLSearchParams(window.location.search).get('sky') ?? '';
const serverSky = () => '';

type Play = { id: 'land' | 'spring'; key: number };

export default function Clock({ now, conditions = null, activeScene = 'transport', petPreview = null, petTravel = null }: {
  now: Date | null;
  conditions?: Conditions | null;
  activeScene?: Rotation['phase'];
  petPreview?: WorldSpotId | null;
  petTravel?: WorldSpotId | null;
}) {
  const [frame, setFrame] = useState(() => clockFrame(now));
  const next = clockFrame(now, frame);
  if (next !== frame) setFrame(next);
  const digits = changedDigits(next);

  // The theme is read from the URL after hydration rather than during render:
  // the server has no location, and a class that differed between the two
  // would be a hydration mismatch. Reading it through a store rather than
  // setting state from an effect is what keeps that from costing a second
  // render of the whole widget on every load. The URL never changes on the
  // wall, so there is nothing to subscribe to. The display loads once and then
  // runs for weeks, so the first frame it spends plain is never seen.
  const theme = useSyncExternalStore(subscribeToNothing, urlTheme, serverTheme);
  const skyPin = useSyncExternalStore(subscribeToNothing, urlSky, serverSky);

  const [targets, setTargets] = useState<Targets | null>(null);
  const [play, setPlay] = useState<Play | null>(null);
  const [reduced, setReduced] = useState(false);

  // The timers read live values through refs so they never have to be rebuilt.
  const blockRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef(next);
  const activeSceneRef = useRef(activeScene);
  useEffect(() => {
    frameRef.current = next;
    activeSceneRef.current = activeScene;
  });
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
  // cells' boxes and canvas text metrics for the face they are drawn in, and
  // what the top of each glyph looks like, from a small bitmap of it. Runs
  // after the fonts are ready, after every roll, and on resize. Four
  // measureText calls and four 160 x 150 bitmaps, so it is cheap enough to run
  // each minute.
  const measure = useCallback(() => {
    const block = blockRef.current;
    const clock = block?.querySelector<HTMLElement>(':scope > .clock');
    if (!block || !clock) return;
    const cells = Array.from(clock.querySelectorAll<HTMLElement>('.clock-digit'));
    const text = frameRef.current.text.replace(':', '');
    if (cells.length !== 4 || !/^\d{4}$/.test(text)) { setTargets(null); return; }
    if (!canvas.current) {
      const element = document.createElement('canvas');
      element.width = PROFILE_W;
      element.height = PROFILE_H;
      canvas.current = element.getContext('2d', { willReadFrequently: true });
    }
    const context = canvas.current;
    if (!context) return;
    const origin = block.getBoundingClientRect();
    const relative = (rect: DOMRect) => ({ left: rect.left - origin.left, top: rect.top - origin.top, right: rect.right - origin.left, bottom: rect.bottom - origin.top });
    const profiles = cells.map((cell, index) => {
      const face = cell.querySelector<HTMLElement>('.digit-face:not(.digit-out)') ?? cell;
      const style = getComputedStyle(face);
      context.font = `${style.fontWeight} ${PROFILE_PX}px ${style.fontFamily}`;
      context.clearRect(0, 0, PROFILE_W, PROFILE_H);
      context.fillText(text[index], PROFILE_PX * 0.3, PROFILE_PX * 1.15);
      const columns = inkColumns(context.getImageData(0, 0, PROFILE_W, PROFILE_H).data, PROFILE_W, PROFILE_H);
      return columns ? topProfile(columns, TENANT_SIZE_EM * PROFILE_PX) : null;
    });
    const ink = cells.map((cell, index) => {
      const face = cell.querySelector<HTMLElement>('.digit-face:not(.digit-out)') ?? cell;
      const style = getComputedStyle(face);
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const box = relative(cell.getBoundingClientRect());
      return inkBox(box, context.measureText(text[index]), parseFloat(style.lineHeight) || box.bottom - box.top);
    });
    const dot = clock.querySelector<HTMLElement>('.separator span');
    const em = parseFloat(getComputedStyle(clock).fontSize);
    const size = TENANT_SIZE_EM * em;
    const base = tenantTargets(ink, relative(cells[3].getBoundingClientRect()), size, TENANT_GAP_EM * em,
      profiles, dot ? relative(dot.getBoundingClientRect()) : null);
    const originBox: Box = { left: origin.left, top: origin.top, right: origin.right, bottom: origin.bottom };
    const world = [] as Targets['world'];
    const safe = [] as Targets['safe'];
    const boxOf = (element: HTMLElement): Box => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    };
    const addSafe = (key: string, selector: string, align: number, edge: 'top' | 'bottom' = 'top') => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) return;
      const surface = boxOf(element);
      if (surface.right - surface.left < size || surface.bottom <= surface.top) return;
      safe.push(landingSpotTarget(key, surface, originBox, base.rest, size, align, edge));
    };
    const addWorld = (id: WorldSpotId, selector: string, align: number, edge: 'top' | 'bottom' = 'top') => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) return;
      const surface = boxOf(element);
      if (surface.right - surface.left < size || surface.bottom <= surface.top) return;
      const target = worldSpotTarget(id, surface, originBox, base.rest, size, align, edge);
      world.push(target);
      safe.push({ key: 'destination-' + id, x: target.x, y: target.y });
    };

    // Stable edges across the whole layout. Several pads share a wide surface
    // because the character must visibly land before it can change direction;
    // no route point is an invented coordinate in the middle of the screen.
    addSafe('weather-left', '.weather', 0.08);
    addWorld('weather', '.weather', 0.76);
    addSafe('ribbon-left', '.ribbon-bars', 0.08, 'bottom');
    addSafe('ribbon-middle', '.ribbon-bars', 0.5, 'bottom');
    addSafe('ribbon-right', '.ribbon-bars', 0.92, 'bottom');
    addSafe('week-left', '.week-day:nth-child(2)', 0.5);
    addWorld('week', '.week-day:nth-child(5)', 0.5);
    addSafe('week-right', '.week-day:nth-child(7)', 0.5);
    if (activeSceneRef.current === 'transport') {
      document.querySelectorAll<HTMLElement>('.transit-scene.is-active .departure-board').forEach((board, index) => {
        const surface = boxOf(board);
        if (surface.right - surface.left < size || surface.bottom <= surface.top) return;
        safe.push(landingSpotTarget('transport-' + index + '-left', surface, originBox, base.rest, size, 0.08, 'bottom'));
        safe.push(landingSpotTarget('transport-' + index + '-middle', surface, originBox, base.rest, size, 0.5, 'bottom'));
      });
      addWorld('transport', '.transit-scene.is-active .departure-board', 0.82, 'bottom');
    }
    if (activeSceneRef.current === 'fact') {
      addSafe('fact-image-left', '.daily-fact-scene.is-active .fact-illustration img', 0.08);
      addWorld('fact', '.daily-fact-scene.is-active .fact-illustration img', 0.68);
      addSafe('fact-footer-left', '.daily-fact-scene.is-active .fact-footer', 0.12);
      addSafe('fact-footer-right', '.daily-fact-scene.is-active .fact-footer', 0.82);
      addSafe('fact-transport', '.transport-mini', 0.5, 'top');
    }
    if (activeSceneRef.current === 'map') {
      addSafe('map-top-left', '.forecast-map-scene.is-active .forecast-map-frame', 0.08);
      addSafe('map-top-right', '.forecast-map-scene.is-active .forecast-map-frame', 0.75);
      addSafe('map-bottom-left', '.forecast-map-scene.is-active .forecast-map-frame', 0.08, 'bottom');
      addWorld('map', '.forecast-map-scene.is-active .forecast-map-frame', 0.78, 'bottom');
      addSafe('map-transport', '.transport-mini', 0.5, 'top');
    }
    setTargets({ ...base, world, safe });
  }, []);

  // The active panel arrives over 450 ms. Measure once as it is mounted and
  // once after that transition has settled; no observer or frame loop is kept
  // alive for the otherwise static dashboard geometry.
  useEffect(() => {
    const mounted = window.setTimeout(measure, 40);
    const settled = window.setTimeout(measure, 540);
    return () => { window.clearTimeout(mounted); window.clearTimeout(settled); };
  }, [activeScene, measure]);

  // The Tenant landed on the colon or left it: squash or spring the dots.
  const onPlay = useCallback((id: Play['id']) => {
    setPlay({ id, key: Date.now() });
    later(() => setPlay(current => current?.id === id ? null : current), PLAY_MS);
  }, [later]);

  // The roll itself: measure the new ink once it has landed. `next` is a new
  // object only when the minute changes.
  const rolled = next.previous !== null;
  useEffect(() => {
    if (!rolled) return;
    later(measure, ROLL_MS);
  }, [next, rolled, later, measure]);

  // Signals for the Tenant, derived rather than stored: each is the minute
  // stamp of the moment it describes, so it changes exactly once per minute.
  const rollKey = rolled ? next.minute : null;
  const rolledIndex = digits.findIndex(({ previous }) => previous !== null);
  const rolledDigit = rolledIndex < 0 ? 3 : rolledIndex;

  // Measure once the faces are ready and once more after the dashboard has
  // settled, and again whenever the viewport changes. One set of timers, all
  // cleared on unmount: this display runs for weeks without a reload.
  useEffect(() => {
    let alive = true;
    document.fonts.ready.then(() => { if (alive) measure(); });
    later(measure, 2000);
    window.addEventListener('resize', measure);
    const pending = timers.current;
    return () => {
      alive = false;
      window.removeEventListener('resize', measure);
      for (const id of pending) window.clearTimeout(id);
      pending.clear();
    };
  }, [later, measure]);

  const date = clockDate(now);
  const mood = now ? tenantMood(moodContext(now, conditions)) : 'awake';
  const nextDigit = now ? nextChangingDigit(now) : 3;

  const className = ['clock-block',
    play ? 'tn-' + play.id : '',
    mood === 'asleep' ? 'is-asleep' : ''].filter(Boolean).join(' ');

  const scenery = hasScenery(theme);
  // What the theme paints, from the real sun and the reported hour. Null until
  // the first tick; the three attributes are then simply absent, which leaves
  // the stylesheet on its own defaults rather than on a sky invented for a
  // moment nobody sees.
  const sky = now
    ? clockSky(now.getTime(), conditions?.kind ?? null, conditions?.band ?? null, parsePinnedSky(skyPin))
    : null;

  return <section className={('clock-widget ' + clockThemeClass(theme)).trim()} aria-label="Time and date"
    data-light={sky?.light} data-weather={sky?.weather} data-fall={sky?.fall}>
    {/* The background of the widget, on its own layer so the frame itself can
        stay unclipped for the Tenant. Restyle it through --clock-surface.
        A theme paints its place into these layers, back to front: the disc and
        the stars, high cloud, the bank the weather moves, the far ridge, the
        near canopy, whatever is falling, and whatever is drifting. They are
        empty spans because a theme draws them in CSS alone, and they exist
        only when a theme is on, so the plain card keeps the DOM it always
        had. */}
    <div className="clock-surface" aria-hidden="true">
      {scenery && <>
        <span className="cs-sun" /><span className="cs-far" /><span className="cs-bank" /><span className="cs-mid" />
        <span className="cs-near" /><span className="cs-fall" /><span className="cs-air" />
      </>}
    </div>

    <div className={className} ref={blockRef}>
      <h1 className={'clock' + (now ? ' is-live' : '')} aria-label={now ? next.text : 'Loading time'}>
        {digits.map(({ digit, previous }, index) => {
          const style = { '--roll-delay': (3 - index) * 35 + 'ms' } as CSSProperties;
          return <span className={'clock-digit digit-' + index} key={index} aria-hidden="true" style={style}>
            {previous !== null && <span className="digit-face digit-out" key={'out-' + next.minute} data-d={previous}>{previous}</span>}
            <span className={'digit-face' + (previous !== null ? ' digit-in' : '')} key={'in-' + next.minute} data-d={digit}>{digit}</span>
          </span>;
        })}
        <span className="separator" aria-hidden="true"><span /><span /></span>
      </h1>
      <time className="clock-date" dateTime={date.dateTime} aria-label={now ? 'Date: ' + date.label : 'Loading date'}>{date.label}</time>

      {/* `busy` is what held the character still while the clock dressed or
          played a set piece. Nothing in the widget does either any more, so it
          is never busy; the prop stays as the seam those would plug back into. */}
      {targets && !reduced && <Tenant mood={mood} targets={targets} activeScene={activeScene} previewSpot={petPreview} travelSpot={petTravel} rollKey={rollKey}
        nextDigit={nextDigit} rolledDigit={rolledDigit} busy={false} onPlay={onPlay} />}
    </div>

    {/* The light of the place, falling on the digits and on the Tenant rather
        than behind them: it is what stops the scenery reading as a picture
        pasted behind a clock. It is the block's later sibling on purpose,
        because that is what puts it above without giving the block a stacking
        context the travelling character could not leave. It clips to the card,
        so a Tenant out visiting the dashboard is not lit by it. */}
    {scenery && <div className="clock-light" aria-hidden="true" />}

    {/* What grows on the clock. Outside the clipped surface, so a leaf can sit
        on the frame and overhang the edge; in front of the block, so it is
        plainly growing on the card rather than painted behind it. */}
    {scenery && <div className="cs-flora" aria-hidden="true" />}
  </section>;
}
