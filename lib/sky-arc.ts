// Where the sun is, and where the moon is, as a place on a painted card.
//
// The weather card's sky used to hold the disc still: four positions, one per
// light phase, so the sun stood at 22% of the card's height from breakfast to
// tea and then jumped. This turns the real sky into the two numbers the
// stylesheet needs, and app/horizon.css — traced off the artwork by
// `npm run horizon` — turns those into a point on the picture.
//
//   cross   0 where the body rises, 1 where it sets, and moving evenly in
//           between. It is the hour angle over the hour angle at rising, not
//           the clock: a December day is seven hours long and a June one is
//           seventeen, and the disc has to cross the same card in both.
//
//   climb   The elevation over the highest this body ever reaches here. Fixed
//           per latitude rather than per day, which is the whole point: a
//           winter noon reads about 0.19 and skims the ridge, a midsummer noon
//           reads 1 and stands at the top of the sky. Normalising per day
//           would put every noon of the year in the same place and throw the
//           season away.
//
// Below the horizon `climb` goes negative, and the stylesheet's --arc-low is
// far enough under the traced seam that the disc and its bloom are both behind
// the land. That is the whole of the "hide it at night" logic: there is no
// separate switch, a set sun is simply a sun at a negative elevation. It also
// gives the thing worth having for free — through civil twilight the disc is
// just under the ridge and only its glow shows over it.
//
// The astronomy is low-precision NOAA for the sun and the standard abridged
// series for the moon: good to a fraction of a degree and to about a degree
// respectively. The card is 350 pixels wide. lib/weather.ts's solarElevation()
// is the same code — it calls in here rather than keeping a second copy, which
// is how the two cannot drift.

const RADIANS = Math.PI / 180;
// Earth's axial tilt. The sun's declination swings this far either side of the
// equator over a year, and the moon's a little further because its orbit is
// tilted about 5 degrees again on top.
const TILT = 23.44;
const LUNAR_TILT = 28.6;
// How far under the horizon the disc is still allowed to be reported. Any
// further makes no difference: it is behind the land either way, and stopping
// keeps the value bounded for anything downstream that interpolates it.
const BELOW = -0.18;

export type SkyBody = 'sun' | 'moon';
export type SkyArc = { cross: number; climb: number };

/** Days since J2000.0, which is noon UTC on 2000-01-01. */
const epochDays = (timestamp: number) => timestamp / 86400000 - 10957.5;

const obliquity = (days: number) => (23.439 - 4e-7 * days) * RADIANS;

// Greenwich mean sidereal time, turned into the local one by adding the
// longitude. This is what makes the hour angle below a local quantity.
const siderealTime = (days: number, longitude: number) =>
  ((18.697374558 + 24.06570982441908 * days) % 24 * 15 + longitude) * RADIANS;

type Equatorial = { rightAscension: number; declination: number };

/** The sun, by the low-precision NOAA formulae. */
function sunAt(days: number): Equatorial {
  const meanLongitude = (280.46 + 0.9856474 * days) * RADIANS;
  const meanAnomaly = (357.528 + 0.9856003 * days) * RADIANS;
  const ecliptic = meanLongitude + (1.915 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly)) * RADIANS;
  const tilt = obliquity(days);
  return {
    declination: Math.asin(Math.sin(tilt) * Math.sin(ecliptic)),
    rightAscension: Math.atan2(Math.cos(tilt) * Math.sin(ecliptic), Math.cos(ecliptic)),
  };
}

/**
 * The moon, by the abridged series: mean longitude, mean anomaly and argument
 * of latitude, with the one big term of each of the two corrections. Good to
 * about a degree, which on this card is a pixel and a half.
 */
function moonAt(days: number): Equatorial {
  const meanLongitude = (218.316 + 13.176396 * days) * RADIANS;
  const meanAnomaly = (134.963 + 13.064993 * days) * RADIANS;
  const argumentOfLatitude = (93.272 + 13.229350 * days) * RADIANS;
  const longitude = meanLongitude + 6.289 * RADIANS * Math.sin(meanAnomaly);
  const latitude = 5.128 * RADIANS * Math.sin(argumentOfLatitude);
  const tilt = obliquity(days);
  return {
    declination: Math.asin(Math.sin(latitude) * Math.cos(tilt) + Math.cos(latitude) * Math.sin(tilt) * Math.sin(longitude)),
    rightAscension: Math.atan2(
      Math.sin(longitude) * Math.cos(tilt) - Math.tan(latitude) * Math.sin(tilt),
      Math.cos(longitude),
    ),
  };
}

/** An angle in radians, brought into the half-open turn either side of zero. */
function wrap(angle: number) {
  const turn = Math.PI * 2;
  return angle - turn * Math.floor((angle + Math.PI) / turn);
}

const positionOf = (body: SkyBody, days: number) => body === 'moon' ? moonAt(days) : sunAt(days);

/**
 * Where the body is against the stars, in degrees: right ascension and
 * declination. Nothing on the card reads this — it is what `bodyElevation` and
 * `skyArc` are built out of, and the only place either series can be checked
 * against something a person can look up. Both are otherwise observable only
 * through an elevation, which folds in the observer's own rotation and so
 * cannot tell a wrong moon from a right one at the wrong hour.
 */
export function bodyEquatorial(body: SkyBody, timestamp: number) {
  const { rightAscension, declination } = positionOf(body, epochDays(timestamp));
  return { rightAscension: wrap(rightAscension) / RADIANS, declination: declination / RADIANS };
}

/** How high above the horizon the body is, in degrees. */
export function bodyElevation(body: SkyBody, timestamp: number, latitude: number, longitude: number) {
  const days = epochDays(timestamp);
  const { rightAscension, declination } = positionOf(body, days);
  const latitudeRadians = latitude * RADIANS;
  return Math.asin(Math.sin(latitudeRadians) * Math.sin(declination)
    + Math.cos(latitudeRadians) * Math.cos(declination) * Math.cos(siderealTime(days, longitude) - rightAscension)) / RADIANS;
}

/**
 * The highest this body ever gets at this latitude, in degrees. The reference
 * `climb` is measured against, so the seasons stay in the answer.
 */
export function peakElevation(body: SkyBody, latitude: number) {
  return Math.min(90, 90 - Math.abs(latitude) + (body === 'moon' ? LUNAR_TILT : TILT));
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

export function skyArc(timestamp: number, body: SkyBody, latitude: number, longitude: number): SkyArc {
  const days = epochDays(timestamp);
  const { rightAscension, declination } = positionOf(body, days);
  const hourAngle = wrap(siderealTime(days, longitude) - rightAscension);
  // The hour angle at which this body rises and sets today. It is what makes a
  // short winter day and a long summer one the same journey across the card.
  // The cosine goes outside its own range inside the polar circles, where the
  // body does not rise or does not set; clamping leaves the arithmetic sound,
  // and `climb` — which is a real elevation — is what actually decides whether
  // anything is visible in that case.
  const rising = Math.acos(clamp(-Math.tan(latitude * RADIANS) * Math.tan(declination), -1, 1));
  const cross = rising < 1e-6 ? 0.5 : clamp(0.5 + 0.5 * (hourAngle / rising), 0, 1);
  const climb = clamp(
    bodyElevation(body, timestamp, latitude, longitude) / peakElevation(body, latitude),
    BELOW,
    1,
  );
  return { cross, climb };
}
