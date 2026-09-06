// Where the internet's birthdays come from.
//
// WHY THIS EXISTS
// The English Wikipedia calendar pages are the generator's only source, and
// they are a record of wars, treaties and election results. Asked how many of
// the 366 dates offer even one non-grim entry about computing or the internet,
// they answer 75, with 87 candidates in total. A wall that is supposed to show
// the day Rickrolling started cannot be built from that: 291 dates have
// nothing at all, and no amount of re-weighting conjures an entry that is not
// on the page.
//
// Wikidata does have them, structured. A website, a video game, a piece of
// software or an internet meme carries an inception (P571) or publication
// date (P577), and roughly a third of those dates are recorded to the day
// rather than to the year. Joined to an English Wikipedia article, that is a
// day-precise anniversary with a title, a subject and somewhere for the
// generator to find a picture and a summary. 868 of them cover 319 dates.
//
// This runs by hand, not in the build. Wikidata is slow, rate-limits a
// determined caller, and answers a broad query with a 504; the generator must
// not depend on any of that. The output is committed as
// data/digital-anniversaries.json and read from disk.
//
//   npm run facts:harvest              re-ask Wikidata and rewrite the file
//   npm run facts:harvest -- --dry     ask, report, write nothing
//
// KNOW YOUR MEME AND FRIENDS
// Deliberately not used. The dates would be fine -- a date is a fact and
// nobody owns it -- but the images are not freely licensed, and this display
// may only show media it has the right to show. Wikidata gives the same
// anniversary with a Commons picture attached, which is the hard half, so
// there is nothing to gain by scraping a site that has not offered.

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ENDPOINT = 'https://query.wikidata.org/sparql';
const AGENT = 'HomeDashboard/1.0 (daily facts calendar; https://github.com/)';
const OUT = new URL('../data/digital-anniversaries.json', import.meta.url);

// One query per class, because a single query covering all of them is exactly
// the shape Wikidata answers with a timeout. P577 for things that are
// published (games, software releases), P571 for things that are founded
// (websites, services, memes).
//
// P18 is required, and it is the whole reason this works. A game, a piece of
// software or a meme has a lead image on Wikipedia that is box art, a
// screenshot, or the meme itself -- held there under fair use, which this
// display may not reuse -- so prop=pageimages answers with nothing for
// Minecraft, for Dead Island and for Rickrolling alike. Wikidata's P18 is a
// Commons file and free by policy. Requiring it costs half the harvest, 868
// subjects over 319 dates rather than 1,722 over 362, and the half it costs
// is the half that could never have been shown.
const CLASSES = [
  { qid: 'Q35127', kind: 'website', date: 'P571', category: 'tech' },
  { qid: 'Q35127', kind: 'website', date: 'P577', category: 'tech' },
  { qid: 'Q7397', kind: 'software', date: 'P577', category: 'tech' },
  { qid: 'Q7397', kind: 'software', date: 'P571', category: 'tech' },
  { qid: 'Q7889', kind: 'vgame', date: 'P577', category: 'culture' },
  { qid: 'Q2927074', kind: 'meme', date: 'P571', category: 'curious' },
  { qid: 'Q620615', kind: 'mobileapp', date: 'P577', category: 'tech' },
  { qid: 'Q620615', kind: 'mobileapp', date: 'P571', category: 'tech' },
  { qid: 'Q166142', kind: 'appsw', date: 'P577', category: 'tech' },
  { qid: 'Q3220391', kind: 'socialnet', date: 'P571', category: 'tech' },
  { qid: 'Q4182287', kind: 'search', date: 'P571', category: 'tech' },
  { qid: 'Q9135', kind: 'os', date: 'P571', category: 'tech' },
  { qid: 'Q9143', kind: 'proglang', date: 'P571', category: 'tech' },
  { qid: 'Q1668024', kind: 'netservice', date: 'P571', category: 'tech' },
];

// timePrecision 11 is "day". Anything coarser is a year or a month, which is
// not an anniversary, and Wikidata stores plenty of both.
const query = ({ qid, date }) => `SELECT ?itemLabel ?date ?sitelink ?image WHERE {
  ?item wdt:P31 wd:${qid} .
  ?item p:${date}/psv:${date} [ wikibase:timeValue ?date ; wikibase:timePrecision ?prec ] .
  ?item wdt:P18 ?image .
  ?sitelink schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> .
  FILTER(?prec = 11) FILTER(YEAR(?date) >= 1969)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;

async function ask(spec) {
  const url = `${ENDPOINT}?query=${encodeURIComponent(query(spec))}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 240_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/sparql-results+json', 'User-Agent': AGENT },
    });
    if (!response.ok) throw new Error(`${spec.kind}/${spec.date}: HTTP ${response.status}`);
    const body = await response.json();
    return body.results.bindings.map(row => ({
      kind: spec.kind,
      category: spec.category,
      title: row.itemLabel.value,
      date: row.date.value.slice(0, 10),
      article: decodeURIComponent(row.sitelink.value.split('/wiki/')[1] ?? '').replace(/_/g, ' '),
      imageFile: decodeURIComponent(row.image.value.split('Special:FilePath/')[1] ?? ''),
    }));
  } finally {
    clearTimeout(timeout);
  }
}

const dry = process.argv.includes('--dry');
const rows = [];
for (const spec of CLASSES) {
  try {
    const found = await ask(spec);
    rows.push(...found);
    console.log(`  ${spec.kind}/${spec.date}: ${found.length}`);
  } catch (error) {
    // One class failing is a thinner calendar, not a broken one. Wikidata
    // answers a heavy query with a 504 often enough that giving up on the
    // whole harvest for it would mean never finishing.
    console.log(`  ${spec.kind}/${spec.date}: ${error.message}`);
  }
  await new Promise(resolve => setTimeout(resolve, 2_000));
}

// One row per subject. A thing with both an inception and a publication date
// would otherwise appear twice, on two dates, saying the same thing.
const seen = new Set();
const byDate = {};
for (const row of rows) {
  if (!row.article || seen.has(row.article)) continue;
  seen.add(row.article);
  const [year, month, day] = row.date.split('-');
  if (!row.imageFile) continue;
  (byDate[`${month}-${day}`] ??= []).push({
    year: Number(year), article: row.article, title: row.title,
    category: row.category, kind: row.kind, imageFile: row.imageFile,
  });
}
for (const list of Object.values(byDate)) list.sort((a, b) => a.year - b.year);

const dates = Object.keys(byDate).length;
console.log(`\n${seen.size} subjects across ${dates} of 366 dates.`);
if (dry) {
  console.log('--dry: nothing written.');
} else if (dates < 250) {
  // A harvest this thin means Wikidata was rate-limiting, not that the
  // internet stopped happening. Keeping the previous file is the right answer.
  throw new Error(`Only ${dates} dates covered; refusing to overwrite the committed file. Try again later.`);
} else {
  await writeFile(OUT, `${JSON.stringify({
    comment: "Day-precise anniversaries of websites, games, software, apps and internet memes, harvested from Wikidata by scripts/harvest-anniversaries.mjs. Each carries imageFile: a freely licensed Commons picture from the subject's Wikidata P18, because the picture everybody recognises -- box art, a screenshot, the meme itself -- is almost always non-free and this display may not reuse it. The generator seeds up to two a date, best-read first, and writes the body from the English Wikipedia extract. Regenerate with: npm run facts:harvest.",
    harvestedAt: new Date().toISOString().slice(0, 10),
    dates: byDate,
  }, null, 1)}\n`);
  console.log(`Wrote ${fileURLToPath(OUT)}`);
}
