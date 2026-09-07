// What the hillside's sky is doing, as the theme has to paint it.
//
// The clock already receives the current hour's conditions from the weather
// panel, because the Tenant reads them. This turns that same report into the
// three things the scenery needs and nothing more: how much light there is,
// what the sky is made of, and how hard it is coming down. They travel to the
// stylesheet as `data-light`, `data-weather` and `data-fall` on the widget, so
// every rule that paints weather is a plain attribute selector and no
// component has to know what a raincloud looks like.
//
// Nothing here asks anyone for a forecast. A display with no answer yet gets a
// plausible, quiet sky rather than an empty one, because the alternative is a
// card that flashes from blank to weather on first load.
//
// The rest of it is the two bodies. `sun` and `moon` are each where that body
// is — two fractions that app/horizon.css turns into a point on the painting —
// and `phase` is what the moon looks like tonight. Both bodies are reported at
// every hour, because both are up at some hours and the traced horizon mask is
// what hides whichever one is under the land. That is also why neither follows
// the light phase: a moon at four in the afternoon is a real moon in a real
// afternoon sky, and pinning `?sky=night` at noon must not move it.
//
//   ?sky=night,snow,heavy   Pins any of the four, in any order, for a look at
//                           a sky the real weather is not currently offering.
//                           Read here rather than in lib/debug-flags.ts for the
//                           same reason `?date=` is read in lib/daily-facts.ts:
//                           this is where the value is derived. Anything
//                           unrecognised is ignored, so a typo shows the real
//                           weather rather than a blank card.
//
//   ?sky=night,gibbous      The fourth is the moon's phase, and it is here for
//                           the same reason snow is: the real one takes a
//                           fortnight to go from a crescent to a gibbous, and
//                           those are the two sides of a branch in the
//                           stylesheet that draws them. Only the lit fraction
//                           is pinned. Which way the moon leans is a fact about
//                           the hour rather than the month, so it keeps
//                           following the real sky and `?time=` moves it.

import { moonPhase, skyArc, type MoonPhase, type SkyArc } from './sky-arc';
import { FORECAST_LATITUDE, FORECAST_LONGITUDE, solarElevation, type Band, type ConditionKind } from './weather';

export const SKY_LIGHTS = ['night', 'dawn', 'day', 'dusk'] as const;
const SKY_WEATHERS = ['clear', 'partly', 'cloudy', 'overcast', 'fog', 'rain', 'sleet', 'snow'] as const;
const SKY_FALLS = ['none', 'light', 'moderate', 'heavy'] as const;
// Five moons, by the fraction of the disc lit. Named rather than numeric
// because these are the shapes worth looking at, and a phase written 0.7734
// in a URL says nothing about what should be on the card.
export const SKY_MOONS: Readonly<Record<string, number>> = {
  new: 0, crescent: 0.18, half: 0.5, gibbous: 0.78, full: 1,
};

export type SkyLight = (typeof SKY_LIGHTS)[number];
export type SkyWeather = (typeof SKY_WEATHERS)[number];
export type SkyFall = (typeof SKY_FALLS)[number];
export type Sky = { light: SkyLight; weather: SkyWeather; fall: SkyFall; sun: SkyArc; moon: SkyArc; phase: MoonPhase };
/** What `?sky=` may hold. Not a Partial<Sky>: no pin places a body, and the
 *  moon's pin is half of its phase rather than the whole of it. */
export type PinnedSky = { light?: SkyLight; weather?: SkyWeather; fall?: SkyFall; lit?: number };

// Civil twilight, in degrees of solar elevation. Above DAY_ABOVE the light is
// plainly day and below NIGHT_BELOW it is plainly night; between them is the
// hour this theme is named after. Copenhagen's sunset swings from about 15:40
// in December to about 22:00 in June, which is why this is computed from the
// sun rather than read off the clock.
const DAY_ABOVE = 6;
const NIGHT_BELOW = -6;
// Ten minutes is long enough for the sun to have measurably moved at any time
// of year, and short enough that the answer is about now.
const LOOK_AHEAD_MS = 600_000;

/** Day, night, or which side of twilight we are on. */
export function skyLight(timestamp: number): SkyLight {
  const elevation = solarElevation(timestamp);
  if (elevation > DAY_ABOVE) return 'day';
  if (elevation < NIGHT_BELOW) return 'night';
  return solarElevation(timestamp + LOOK_AHEAD_MS) > elevation ? 'dawn' : 'dusk';
}

// The ten kinds the weather card knows collapse to eight the sky can paint:
// drizzle and heavy rain are rain falling at different rates, and the rate is
// carried separately by `fall`.
const WEATHER: Readonly<Record<ConditionKind, SkyWeather>> = {
  clear: 'clear', partly: 'partly', cloudy: 'cloudy', overcast: 'overcast', fog: 'fog',
  drizzle: 'rain', rain: 'rain', 'heavy-rain': 'rain', sleet: 'sleet', snow: 'snow',
};

const FALL: Readonly<Record<Band, SkyFall>> = {
  dry: 'none', trace: 'light', light: 'light', moderate: 'moderate', heavy: 'heavy',
};

/** What the sky is made of. No forecast yet reads as a quiet part-clouded sky. */
export function skyWeather(kind: ConditionKind | null): SkyWeather {
  return kind === null ? 'partly' : WEATHER[kind];
}

/**
 * How hard it is falling, and only for a sky that has something to drop. A
 * band is reported for every hour, including dry ones, so the kind is what
 * decides whether anything falls at all.
 */
export function skyFall(kind: ConditionKind | null, band: Band | null): SkyFall {
  if (kind === null || band === null) return 'none';
  const weather = WEATHER[kind];
  if (weather !== 'rain' && weather !== 'snow' && weather !== 'sleet') return 'none';
  return FALL[band];
}

/** The four pinned by `?sky=`, in any order. Unrecognised tokens are ignored. */
export function parsePinnedSky(value: string | null): PinnedSky {
  const pinned: PinnedSky = {};
  for (const token of (value ?? '').split(',').map(part => part.trim().toLowerCase())) {
    if (has(SKY_LIGHTS, token)) pinned.light = token;
    else if (has(SKY_WEATHERS, token)) pinned.weather = token;
    else if (has(SKY_FALLS, token)) pinned.fall = token;
    else if (token in SKY_MOONS) pinned.lit = SKY_MOONS[token];
  }
  return pinned;
}

export function clockSky(
  timestamp: number, kind: ConditionKind | null, band: Band | null, pinned: PinnedSky = {},
): Sky {
  const light = pinned.light ?? skyLight(timestamp);
  const phase = moonPhase(timestamp, FORECAST_LATITUDE, FORECAST_LONGITUDE);
  return {
    light,
    weather: pinned.weather ?? skyWeather(kind),
    fall: pinned.fall ?? skyFall(kind, band),
    // Both bodies, every hour, on their own arcs. The card used to draw ONE
    // disc and hand it to whichever body the light phase said was on duty,
    // which meant the sun stopped existing at dusk and the moon did not exist
    // before it -- and a moon in an afternoon sky, which is most afternoons,
    // could not be drawn at all. Nothing here decides what is visible: a body
    // below the horizon has a negative climb, which puts it under --arc-low,
    // which the traced mask cuts away.
    sun: skyArc(timestamp, 'sun', FORECAST_LATITUDE, FORECAST_LONGITUDE),
    moon: skyArc(timestamp, 'moon', FORECAST_LATITUDE, FORECAST_LONGITUDE),
    // A pinned phase changes the shape and nothing else: the moon still leans
    // the way the real one leans at this hour, because that is what makes a
    // pinned crescent worth photographing at three different times.
    phase: pinned.lit === undefined ? phase : { ...phase, illuminated: pinned.lit },
  };
}

function has<T extends string>(values: readonly T[], value: string): value is T {
  return (values as readonly string[]).includes(value);
}
