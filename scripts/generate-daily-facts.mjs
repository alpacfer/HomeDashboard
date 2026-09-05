// Rebuilds all 366 daily-fact files. Run with `npm run facts:generate`.
//
// The judgement about which anniversary is worth showing lives in
// scripts/lib/fact-selection.mjs and is tested. This file is the plumbing
// around it: read the calendar pages, ask how many people read each candidate
// article, resolve a picture and its licence, write the files.
//
// It talks to three APIs and takes roughly twenty minutes, almost all of it
// waiting on pageviews. That is fine: this is a deliberate refresh, not
// something the display does.

import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import {
  CATEGORIES, WORLD, chooseFacts, measurableLinks, parseEntries, plainText, scoreEntry,
} from './lib/fact-selection.mjs';

const API = 'https://en.wikipedia.org/w/api.php';
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const PAGEVIEWS = 'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user';
const VIEWS_WINDOW = ['2024090100', '2025090100'];
const OUTPUT = new URL('../public/facts/daily/', import.meta.url);
const USER_AGENT = 'HomeDashboardDailyFacts/2.0 (https://github.com/; calendar data generator)';
const TEXT_LICENSE = { name: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/' };
const SHORTLIST = 10;
// `--views <file>` keeps the pageview answers between runs. Asking for them is
// fifteen of the twenty minutes, and a run that fails at the last date should
// not have to buy them again. Not used by CI; a refresh without it is current.
const viewsCache = process.argv.includes('--views') ? process.argv[process.argv.indexOf('--views') + 1] : null;
const CATEGORY_NAMES = new Map([...CATEGORIES, WORLD].map(category => [category.id, category.name]));

const seedFile = JSON.parse(await readFile(new URL('../data/daily-fact-overrides.json', import.meta.url), 'utf8'));
const seedsByDate = new Map();
for (const seed of seedFile.facts) {
  if (!CATEGORY_NAMES.has(seed.category)) throw new Error(`${seed.date}: unknown category "${seed.category}"`);
  if (!seedsByDate.has(seed.date)) seedsByDate.set(seed.date, []);
  seedsByDate.get(seed.date).push(seed);
}

const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const dates = [];
for (let month = 1; month <= 12; month++) {
  const dayCount = new Date(Date.UTC(2024, month, 0)).getUTCDate();
  for (let day = 1; day <= dayCount; day++) {
    dates.push({
      key: `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      title: `${monthNames[month - 1]}_${day}`,
      label: `${day} ${monthNames[month - 1]}`,
    });
  }
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let lastRequestAt = 0;

async function api(endpoint, params, attempt = 0) {
  const delay = Math.max(0, 1_100 - (Date.now() - lastRequestAt));
  if (delay) await pause(delay);
  lastRequestAt = Date.now();
  const body = new URLSearchParams({ format: 'json', formatversion: '2', maxlag: '5', ...params });
  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Api-User-Agent': USER_AGENT,
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    // A refresh runs for twenty minutes across three APIs, so one dropped
    // connection has to be survivable. Only a request that keeps failing
    // should end the run.
    if (attempt >= 6) throw error;
    await pause((2 ** attempt) * 1000);
    return api(endpoint, params, attempt + 1);
  }
  if ((response.status === 429 || response.status >= 500) && attempt < 6) {
    const retry = Math.max(2, Number(response.headers.get('retry-after')) || 2 ** attempt);
    await pause(retry * 1000);
    return api(endpoint, params, attempt + 1);
  }
  if (!response.ok) throw new Error(`${endpoint}: HTTP ${response.status}`);
  const data = await response.json();
  if (data.error?.code === 'maxlag' && attempt < 6) {
    await pause((2 ** attempt) * 1000);
    return api(endpoint, params, attempt + 1);
  }
  if (data.error) throw new Error(`${data.error.code}: ${data.error.info}`);
  return data;
}

function chunks(items, size = 50) {
  const result = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function normalizedTitle(value) {
  return value.replace(/_/g, ' ').trim().replace(/\s+/g, ' ').toLowerCase();
}

function metadataValue(metadata, key) {
  return plainText(metadata?.[key]?.value ?? '');
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

// The calendar entry, minus the scaffolding a wall display does not need: the
// year is shown on its own line, and a "Space Race:" style topic prefix is
// noise once the category is named above the headline.
function readableBody(text) {
  let body = text
    .replace(/^(?:[A-Z][\w'’.-]*(?:\s+[\w'’.-]+){0,4})\s*:\s+/, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .trim();
  if (body && !/[.!?"')\]]$/.test(body)) body += '.';
  return body;
}

// Wikipedia stores "IPhone" and displays "iPhone". The display title is the
// one a person would write.
function readableTitle(page, fallback) {
  const display = plainText(page?.displaytitle ?? '') || page?.title || fallback;
  return display.replace(/\s*\([^)]*\)\s*$/, '').trim() || fallback;
}

console.log('Reading the 366 English Wikipedia calendar pages...');
const datePages = new Map();
for (const batch of chunks(dates.map(date => date.title))) {
  const data = await api(API, {
    action: 'query',
    prop: 'revisions',
    rvprop: 'content',
    rvslots: 'main',
    redirects: '1',
    titles: batch.join('|'),
  });
  for (const page of data.query?.pages ?? []) {
    const content = page.revisions?.[0]?.slots?.main?.content;
    if (content) datePages.set(normalizedTitle(page.title), content);
  }
}

const shortlists = new Map();
for (const date of dates) {
  const wikitext = datePages.get(normalizedTitle(date.title));
  if (!wikitext) throw new Error(`Missing calendar page: ${date.title}`);
  const entries = parseEntries(wikitext);
  // Twice as many candidates as are measured. Pageviews are asked for only
  // the first SHORTLIST of them; the rest sit in reserve scoring as if unread,
  // which is exactly what they are for — a date where most of the good
  // candidates turn out to have no freely licensed picture.
  shortlists.set(date.key, entries.map(entry => scoreEntry(entry)).sort((a, b) => b.score - a.score).slice(0, SHORTLIST * 2));
}

const viewTitles = [...new Set([...shortlists.values()].flatMap(list => list.slice(0, SHORTLIST)).flatMap(entry => measurableLinks(entry)))];
console.log(`Asking how many people read ${viewTitles.length} candidate articles...`);
const views = new Map();
if (viewsCache && existsSync(viewsCache)) {
  for (const [title, count] of Object.entries(JSON.parse(await readFile(viewsCache, 'utf8')))) views.set(title, count);
  console.log(`  ${views.size} already answered in ${viewsCache}`);
}
const viewQueue = viewTitles.filter(title => !views.has(title));
let viewsDone = 0;
async function readViews(title) {
  const url = `${PAGEVIEWS}/${encodeURIComponent(title.replace(/ /g, '_'))}/monthly/${VIEWS_WINDOW[0]}/${VIEWS_WINDOW[1]}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'Api-User-Agent': USER_AGENT, 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(20_000) });
      if (response.status === 404) return 0;
      if (response.status === 429 || response.status >= 500) {
        await pause(500 * 2 ** attempt);
        continue;
      }
      if (!response.ok) return 0;
      const data = await response.json();
      return (data.items ?? []).reduce((total, item) => total + item.views, 0);
    } catch {
      await pause(400);
    }
  }
  return 0;
}
await Promise.all(Array.from({ length: 24 }, async () => {
  while (viewQueue.length) {
    const title = viewQueue.shift();
    views.set(title, await readViews(title));
    if (++viewsDone % 500 === 0) console.log(`  ${viewsDone}/${viewQueue.length + viewsDone} articles`);
  }
}));
if (viewsCache) await writeFile(viewsCache, JSON.stringify(Object.fromEntries(views)));

const chosen = new Map();
for (const date of dates) {
  const seeds = (seedsByDate.get(date.key) ?? []).map(seed => ({
    seed,
    year: seed.year,
    text: seed.body,
    subject: seed.article,
    links: [{ title: seed.article, label: seed.article }],
    category: { id: seed.category, name: CATEGORY_NAMES.get(seed.category) },
  }));
  // The whole shortlist, for three slots. Plenty of Wikipedia articles carry
  // no freely licensed picture — 13 July offered Live Aid, the Dartmouth
  // workshop and the 2014 World Cup final, and not one of them had one — so
  // the day needs far more candidates than it has places.
  const all = shortlists.get(date.key);
  const picks = chooseFacts(all.slice(0, SHORTLIST), { views, seeds, reserve: all.slice(SHORTLIST), count: SHORTLIST * 2 });
  if (picks.length < 3) throw new Error(`${date.key}: only ${picks.length} usable entries`);
  chosen.set(date.key, picks);
}

// A seed may name a different article for the picture: the Harambe article
// carries no freely licensed photograph, so the gorilla comes from the article
// on his subspecies while the source link still points at him.
const articleTitles = [...new Set([...chosen.values()].flat().flatMap(pick => [pick.subject, pick.seed?.imageArticle].filter(Boolean)))];
console.log(`Resolving pictures for ${articleTitles.length} articles...`);
const articles = new Map();
for (const batch of chunks(articleTitles)) {
  const data = await api(API, {
    action: 'query',
    prop: 'pageimages|info',
    piprop: 'name|thumbnail',
    pithumbsize: '1000',
    inprop: 'url|displaytitle',
    redirects: '1',
    titles: batch.join('|'),
  });
  const aliases = new Map();
  for (const normalized of data.query?.normalized ?? []) aliases.set(normalizedTitle(normalized.from), normalizedTitle(normalized.to));
  for (const redirect of data.query?.redirects ?? []) aliases.set(normalizedTitle(redirect.from), normalizedTitle(redirect.to));
  for (const page of data.query?.pages ?? []) {
    if (!page.missing) articles.set(normalizedTitle(page.title), page);
  }
  for (const [from, to] of aliases) {
    const resolved = articles.get(to);
    if (resolved) articles.set(from, resolved);
  }
}

// A seed may also name a Commons file outright. Some pictures are the obvious
// illustration for a fact and yet are nobody's lead image: the page of the
// Harvard Mark II logbook with the moth taped to it is the first computer bug,
// and the article on software bugs leads with a screenshot of a syntax error.
const seedFiles = seedFile.facts.filter(seed => seed.imageFile).map(seed => `File:${seed.imageFile}`);
const imageTitles = [...new Set([...seedFiles, ...[...articles.values()].filter(page => page.pageimage).map(page => `File:${page.pageimage}`)])];
console.log(`Reading licence metadata for ${imageTitles.length} Wikimedia Commons files...`);
const imageMetadata = new Map();
for (const batch of chunks(imageTitles)) {
  const data = await api(COMMONS_API, {
    action: 'query',
    prop: 'imageinfo',
    iiprop: 'url|extmetadata',
    iiurlwidth: '1000',
    iiextmetadatalanguage: 'en',
    iiextmetadatafilter: 'Artist|Credit|Attribution|LicenseShortName|LicenseUrl|ImageDescription|UsageTerms',
    titles: batch.join('|'),
  });
  for (const page of data.query?.pages ?? []) {
    const info = page.imageinfo?.[0];
    if (!page.missing && info?.thumburl && info?.descriptionurl) imageMetadata.set(normalizedTitle(page.title), info);
  }
}

await rm(OUTPUT, { recursive: true, force: true });
await mkdir(OUTPUT, { recursive: true });
const missingPictures = [];
const longHeadlines = [];
const tallPictures = [];
let total = 0;

// Commons sometimes stores the same name twice in one field, which reads as
// "Unknown authorUnknown author" under the picture.
function tidyCredit(value) {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  const half = trimmed.length / 2;
  if (Number.isInteger(half) && trimmed.slice(0, half) === trimmed.slice(half)) return trimmed.slice(0, half);
  return trimmed.slice(0, 160);
}
for (const date of dates) {
  const facts = [];
  for (const pick of chosen.get(date.key)) {
    if (facts.length === 3) break;
    const article = articles.get(normalizedTitle(pick.subject));
    const pictureFrom = articles.get(normalizedTitle(pick.seed?.imageArticle ?? pick.subject));
    const image = pick.seed?.imageFile
      ? imageMetadata.get(normalizedTitle(`File:${pick.seed.imageFile}`))
      : pictureFrom?.pageimage && imageMetadata.get(normalizedTitle(`File:${pictureFrom.pageimage}`));
    const articleTitle = article?.title || pick.subject;
    const articleUrl = article?.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(articleTitle.replace(/ /g, '_'))}`;
    const title = pick.seed?.title || readableTitle(article, pick.subject);
    // Six candidates for three slots, so a pick with no picture or a headline
    // that will not fit the panel is passed over rather than patched up.
    if (!image) {
      missingPictures.push(`${date.key} ${pick.subject}`);
      continue;
    }
    if (title.length > 52) {
      longHeadlines.push(`${date.key} ${title}`);
      continue;
    }
    // The panel crops every picture to 4:3, so a tall one loses its subject
    // entirely: the first iPhone's article picture is 600 by 1145, and cropping
    // it leaves a black rectangle where the phone was.
    if (image.thumbheight / image.thumbwidth > 1.6) {
      tallPictures.push(`${date.key} ${pick.subject}`);
      continue;
    }
    const metadata = image.extmetadata ?? {};
    const credit = metadataValue(metadata, 'Attribution') || metadataValue(metadata, 'Artist') || metadataValue(metadata, 'Credit') || 'Wikimedia Commons contributor';
    let licenseUrl = metadata.LicenseUrl?.value || image.descriptionurl;
    if (licenseUrl.startsWith('//')) licenseUrl = `https:${licenseUrl}`;
    if (licenseUrl.startsWith('http://')) licenseUrl = `https://${licenseUrl.slice('http://'.length)}`;
    facts.push({
      id: `${date.key}-${slug(pick.subject)}`,
      date: date.key,
      dateLabel: date.label,
      category: pick.category.id,
      categoryName: pick.category.name,
      year: pick.year,
      title,
      body: pick.seed?.body ?? readableBody(pick.text),
      source: {
        name: `Wikipedia · ${articleTitle}`,
        url: articleUrl,
        calendarUrl: `https://en.wikipedia.org/wiki/${date.title}`,
        license: TEXT_LICENSE,
      },
      image: {
        src: image.thumburl,
        alt: pick.seed?.alt || `Picture from the Wikipedia article on ${title}.`,
        credit: tidyCredit(credit),
        source: image.descriptionurl,
        license: metadataValue(metadata, 'LicenseShortName') || metadataValue(metadata, 'UsageTerms') || 'See file page',
        licenseUrl,
      },
    });
    total++;
  }
  if (facts.length !== 3) throw new Error(`${date.key}: ${facts.length} illustrated facts, need 3`);
  if (new Set(facts.map(fact => fact.id)).size !== 3) throw new Error(`${date.key}: duplicate fact ids`);
  await writeFile(new URL(`${date.key}.json`, OUTPUT), `${JSON.stringify({ date: date.key, dateLabel: date.label, facts }, null, 2)}\n`);
}

await writeFile(new URL('index.json', OUTPUT), `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  source: 'https://en.wikipedia.org/wiki/Wikipedia:On_this_day',
  method: 'Editorial seeds first; otherwise English Wikipedia Events scored by scripts/lib/fact-selection.mjs for recency, subject, phrasing and readership, with Wikimedia Commons picture metadata.',
  dates: dates.length,
  facts: total,
}, null, 2)}\n`);

console.log(`Generated ${total} facts across ${dates.length} dates.`);
if (missingPictures.length) console.log(`Passed over ${missingPictures.length} candidates with no picture.`);
if (longHeadlines.length) console.log(`Passed over ${longHeadlines.length} candidates whose headline was too long.`);
if (tallPictures.length) console.log(`Passed over ${tallPictures.length} candidates whose picture was too tall to crop.`);
