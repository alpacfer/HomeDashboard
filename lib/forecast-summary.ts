// The pinned forecast is a fixed window, a one-line headline, and one bar per
// hour. All three are derived from the same slice of hours, which is what keeps
// them from disagreeing.
//
// The window is deliberately rolling rather than a clock window. The previous
// 06:00-18:00 window shrank from seven rows to one over the course of a day,
// hid everything after 18:00, and then had to flip between a "today" and a
// "tomorrow" panel on a timer. A fixed count of hours from now has no end hour
// to argue about and no day to switch.

import { describeHour, precipitationBand, RIBBON_CEILING_MM, WET_MM, type Band, type ConditionKind, type WeatherHour } from './weather';

export const RIBBON_HOURS = 18;
// A delayed model run leaves fewer hours ahead of now than the full window.
// Showing twelve hours beats showing nothing, so the ribbon shortens instead of
// refusing to draw; below this it is too little to read as a forecast.
export const MIN_RIBBON_HOURS = 6;

export type RibbonHour = {
  timestamp: number;
  hour: number;
  label: string | null;
  temperature: number;
  millimetres: number;
  height: number;
  band: Band;
  kind: ConditionKind;
  midnight: boolean;
};

const hourFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Copenhagen', hour: '2-digit', hourCycle: 'h23' });
const dateFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit' });

export function copenhagenHour(timestamp: number) {
  return Number(hourFormat.format(new Date(timestamp)).slice(0, 2));
}

function copenhagenDate(timestamp: number) {
  return dateFormat.format(new Date(timestamp));
}

export function buildRibbon(hours: WeatherHour[], now: Date, span = RIBBON_HOURS): RibbonHour[] {
  const currentHour = Math.floor(now.getTime() / 3600000) * 3600000;
  const start = hours.findIndex(hour => hour.timestamp >= currentHour);
  if (start < 0) return [];
  // Stop at the first hole rather than drawing across it, which would compress
  // the time axis and silently mislabel every bar after the gap.
  let end = start;
  while (end + 1 < hours.length && end + 1 < start + span && hours[end + 1].timestamp - hours[end].timestamp === 3600000) end += 1;
  const window = hours.slice(start, end + 1);
  if (window.length < MIN_RIBBON_HOURS) return [];

  return window.map(hour => {
    const clock = copenhagenHour(hour.timestamp);
    const condition = describeHour(hour);
    return {
      timestamp: hour.timestamp,
      hour: clock,
      label: clock % 3 === 0 ? String(clock).padStart(2, '0') : null,
      temperature: hour.temperature,
      millimetres: hour.precipitation,
      // Clamped against a fixed ceiling so a drizzle never draws like a
      // downpour, and so bar heights mean the same thing every day.
      height: Math.min(1, hour.precipitation / RIBBON_CEILING_MM),
      band: condition.band,
      kind: condition.kind,
      midnight: clock === 0,
    };
  });
}

// Temperature is drawn as one polyline over the same axis as the bars, in a
// 0-100 box that the SVG stretches to fit. Returning the extremes lets the
// panel label the line without recomputing them.
export function temperatureTrack(ribbon: RibbonHour[]) {
  if (!ribbon.length) return null;
  const temperatures = ribbon.map(entry => entry.temperature);
  const low = Math.min(...temperatures);
  const high = Math.max(...temperatures);
  const span = high - low;
  const points = ribbon.map((entry, index) => {
    const x = (index + 0.5) / ribbon.length * 100;
    const y = span < 0.5 ? 50 : 90 - (entry.temperature - low) / span * 80;
    return x.toFixed(2) + ',' + y.toFixed(2);
  }).join(' ');
  return { points, low, high };
}

const WORDS: Record<ConditionKind, string> = {
  clear: 'clear', partly: 'cloud', cloudy: 'cloud', overcast: 'cloud', fog: 'fog',
  drizzle: 'drizzle', rain: 'rain', 'heavy-rain': 'heavy rain', sleet: 'sleet', snow: 'snow',
};

function partOfDay(hour: number) {
  if (hour < 6) return 'night';
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

// "tonight", "tomorrow morning". Reads better on a wall than a bare hour for
// something that is hours away, and the window's far end is never precise
// enough to deserve a clock time.
function phrase(timestamp: number, now: Date) {
  const part = partOfDay(copenhagenHour(timestamp));
  if (part === 'night') return 'tonight';
  return copenhagenDate(timestamp) === copenhagenDate(now.getTime()) ? 'this ' + part : 'tomorrow ' + part;
}

function clock(entry: RibbonHour) {
  return String(entry.hour).padStart(2, '0') + ':00';
}

function capitalise(word: string) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function rainHeadline(ribbon: RibbonHour[], now: Date): { text: string; wet: boolean } | null {
  if (!ribbon.length) return null;
  const wetAt = ribbon.map(entry => entry.millimetres >= WET_MM);
  const first = wetAt.indexOf(true);
  const last = ribbon[ribbon.length - 1];
  // "through", not "until": nothing wet is in view, and "until" would imply
  // that something arrives once the window ends.
  if (first < 0) return { text: 'Dry through ' + phrase(last.timestamp, now), wet: false };

  let end = first;
  while (end + 1 < ribbon.length && wetAt[end + 1]) end += 1;
  const run = ribbon.slice(first, end + 1);
  const peak = run.reduce((wettest, entry) => entry.millimetres > wettest.millimetres ? entry : wettest, run[0]);
  const word = WORDS[peak.kind];

  if (first > 0) {
    const text = 'Dry until ' + clock(ribbon[first]) + ', then ' + word;
    return { text, wet: false };
  }
  // Already wet. Naming when it stops is the useful part; a run that outlasts
  // the window gets a day-part phrase because its real end is not in view.
  const stops = end + 1 < ribbon.length
    ? capitalise(word) + ' until ' + clock(ribbon[end + 1])
    : capitalise(word) + ' into ' + phrase(last.timestamp, now);
  const heaviest = precipitationBand(peak.millimetres) === 'moderate' || precipitationBand(peak.millimetres) === 'heavy';
  return { text: heaviest && run.length >= 3 && peak !== run[0] ? stops + ', heaviest ' + clock(peak) : stops, wet: true };
}
