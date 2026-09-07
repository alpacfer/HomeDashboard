// The calendar by the numbers, read from the generated files.
//
// docs/DAILY_FACTS.md quotes how modern the calendar is, how the catch-all
// category fills the later slots, how many dates carry a clip and what shape
// those clips are. Every one of those figures went stale one regeneration
// later, because they were typed in by hand. This prints them from
// public/facts/daily/*.json so the doc can quote a run rather than a memory.
//
//   npm run facts:stats            the figures, as text
//   npm run facts:stats -- --json  the same as one JSON document
//
// Reads the committed output only; it never asks Wikimedia for anything.

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mediaShape } from '../lib/daily-facts.ts';
import { FACTS_PER_DAY, RECENT_YEARS } from './lib/fact-selection.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DAILY = path.join(ROOT, 'public', 'facts', 'daily');
const MODERN_FROM = 1900;

const files = (await readdir(DAILY)).filter(name => /^\d{2}-\d{2}\.json$/.test(name)).sort();
const days = await Promise.all(files.map(async name => JSON.parse(await readFile(path.join(DAILY, name), 'utf8'))));
const facts = days.flatMap(day => day.facts);

const latestYear = Math.max(...facts.map(fact => fact.year));
const modern = facts.filter(fact => fact.year >= MODERN_FROM).length;
const recent = facts.filter(fact => latestYear - fact.year >= 1 && latestYear - fact.year <= RECENT_YEARS).length;

// The catch-all category, by the slot a fact was chosen for.
const worldBySlot = Array.from({ length: FACTS_PER_DAY }, (unused, slot) =>
  days.filter(day => day.facts[slot]?.category === 'world').length / days.length);
const world = facts.filter(fact => fact.category === 'world').length / facts.length;
const categories = new Map();
for (const fact of facts) categories.set(fact.category, (categories.get(fact.category) ?? 0) + 1);
// How many kinds a day's five facts span.
const distinct = new Map();
for (const day of days) {
  const kinds = new Set(day.facts.map(fact => fact.category)).size;
  distinct.set(kinds, (distinct.get(kinds) ?? 0) + 1);
}

const clips = facts.filter(fact => fact.video);
const shapes = new Map();
for (const fact of clips) shapes.set(mediaShape(fact.video.width, fact.video.height), (shapes.get(mediaShape(fact.video.width, fact.video.height)) ?? 0) + 1);
const datesWithClip = days.filter(day => day.facts.some(fact => fact.video)).length;

const percent = value => Math.round(value * 100) + '%';
const stats = {
  dates: days.length,
  facts: facts.length,
  modern: { from: MODERN_FROM, count: modern, share: modern / facts.length },
  recent: { years: RECENT_YEARS, latestYear, count: recent, share: recent / facts.length },
  world: { share: world, bySlot: worldBySlot },
  categories: Object.fromEntries([...categories.entries()].sort((a, b) => b[1] - a[1])),
  distinctKindsPerDay: Object.fromEntries([...distinct.entries()].sort((a, b) => a[0] - b[0])),
  clips: { count: clips.length, datesWithClip, oneDateIn: datesWithClip ? Math.round(days.length / datesWithClip) : null, shapes: Object.fromEntries(shapes) },
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(stats, null, 2));
} else {
  console.log(`${stats.facts} facts across ${stats.dates} dates, ${FACTS_PER_DAY} a day.`);
  console.log(`${percent(stats.modern.share)} are from ${MODERN_FROM} or later (${modern} facts).`);
  console.log(`${recent} (${percent(stats.recent.share)}) are from the ${RECENT_YEARS} years before the newest entry, ${latestYear}.`);
  console.log(`'world', the catch-all category, holds ${percent(world)} of the calendar; by slot: ${worldBySlot.map(percent).join(', ')}.`);
  console.log('Categories: ' + Object.entries(stats.categories).map(([name, count]) => name + ' ' + count).join(', ') + '.');
  console.log('Distinct kinds among a day\'s facts: ' + Object.entries(stats.distinctKindsPerDay).map(([kinds, count]) => kinds + ' kinds on ' + count + ' dates').join(', ') + '.');
  console.log(`${clips.length} facts carry a clip, on ${datesWithClip} dates (about one date in ${stats.clips.oneDateIn}); shapes: `
    + (Object.entries(stats.clips.shapes).map(([shape, count]) => count + ' ' + shape).join(', ') || 'none') + '.');
}
