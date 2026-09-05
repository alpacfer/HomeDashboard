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
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import {
  CATEGORIES, FACTS_PER_DAY, VIDEOS_PER_DAY, WORLD, chooseFacts, isRecent, measurableLinks, parseEntries, plainText,
  readableBody, scoreEntry, tidyCredit, videoEarnsItsPlace,
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

// Every upstream answer is kept on disk, because a refresh asks Wikimedia for
// about seventeen thousand things and almost none of them change between runs.
// Before this, adding one field to the eighteen facts that carry a clip meant
// re-reading 366 calendar pages, 5,884 articles and 4,814 file descriptions —
// eighteen minutes, and eighteen minutes again for the next small change.
//
// The cache is on by default and `--refresh` ignores it, which is the way
// round that makes the cheap thing easy and the expensive thing deliberate.
// A cached run reproduces the calendar exactly; only `--refresh` can discover
// that Wikipedia has changed. The run prints the cache's age so a stale one is
// never invisible.
const CACHE_DIR = new URL('../.cache/daily-facts/', import.meta.url);
const refreshing = process.argv.includes('--refresh');
const cacheStats = { hit: 0, miss: 0 };

function cacheKey(kind, payload) {
  return `${kind}-${createHash('sha1').update(payload).digest('hex').slice(0, 32)}.json`;
}

async function cached(kind, payload, fetcher) {
  const file = new URL(cacheKey(kind, payload), CACHE_DIR);
  if (!refreshing) {
    try {
      const hit = JSON.parse(await readFile(file, 'utf8'));
      cacheStats.hit += 1;
      return hit;
    } catch { /* A miss, a half-written file, or no cache yet. Ask upstream. */ }
  }
  const fresh = await fetcher();
  cacheStats.miss += 1;
  // Written through a temporary name so an interrupted run cannot leave a
  // truncated file that later parses as a valid but wrong answer.
  const temporary = new URL(`${cacheKey(kind, payload)}.${process.pid}.tmp`, CACHE_DIR);
  await writeFile(temporary, JSON.stringify(fresh));
  await rm(file, { force: true });
  await writeFile(file, JSON.stringify(fresh));
  await rm(temporary, { force: true });
  return fresh;
}

async function cacheAge() {
  try {
    const files = await readdir(CACHE_DIR);
    if (!files.length) return null;
    let oldest = Infinity;
    for (const name of files.slice(0, 200)) {
      const info = await stat(new URL(name, CACHE_DIR));
      oldest = Math.min(oldest, info.mtimeMs);
    }
    return Number.isFinite(oldest) ? Math.round((Date.now() - oldest) / 86_400_000) : null;
  } catch { return null; }
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let lastRequestAt = 0;

// The cache wraps the request, not the retry loop: a run that had to back off
// through a 429 still stores one clean answer.
async function api(endpoint, params) {
  return cached('api', endpoint + '\n' + JSON.stringify(params), () => apiRequest(endpoint, params));
}

async function apiRequest(endpoint, params, attempt = 0) {
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
    return apiRequest(endpoint, params, attempt + 1);
  }
  if ((response.status === 429 || response.status >= 500) && attempt < 6) {
    const retry = Math.max(2, Number(response.headers.get('retry-after')) || 2 ** attempt);
    await pause(retry * 1000);
    return apiRequest(endpoint, params, attempt + 1);
  }
  if (!response.ok) throw new Error(`${endpoint}: HTTP ${response.status}`);
  const data = await response.json();
  if (data.error?.code === 'maxlag' && attempt < 6) {
    await pause((2 ** attempt) * 1000);
    return apiRequest(endpoint, params, attempt + 1);
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

// Wikipedia stores "IPhone" and displays "iPhone". The display title is the
// one a person would write.
function readableTitle(page, fallback) {
  const display = plainText(page?.displaytitle ?? '') || page?.title || fallback;
  return display.replace(/\s*\([^)]*\)\s*$/, '').trim() || fallback;
}

await mkdir(CACHE_DIR, { recursive: true });
const age = await cacheAge();
console.log(refreshing
  ? 'Refreshing: every upstream answer will be re-fetched and the cache rewritten.'
  : age === null
    ? 'No local cache yet. This run fills it; the next one will not need the network.'
    : `Using the local cache in .cache/daily-facts (oldest entry ${age} day${age === 1 ? '' : 's'} old). Pass --refresh to re-ask upstream.`);

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
  return cached('views', `${VIEWS_WINDOW.join('-')}\n${title}`, () => readViewsRequest(title));
}

async function readViewsRequest(title) {
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
  if (picks.length < FACTS_PER_DAY) throw new Error(`${date.key}: only ${picks.length} usable entries`);
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
    iiurlwidth: '480',
    iiextmetadatalanguage: 'en',
    iiextmetadatafilter: 'Artist|Credit|Attribution|LicenseShortName|LicenseUrl|ImageDescription|UsageTerms',
    titles: batch.join('|'),
  });
  for (const page of data.query?.pages ?? []) {
    const info = page.imageinfo?.[0];
    if (!page.missing && info?.thumburl && info?.descriptionurl) imageMetadata.set(normalizedTitle(page.title), info);
  }
}

// Clips, for the few subjects that have one. Most articles carry none, and
// most of what they do carry is not worth a decoder — see videoEarnsItsPlace
// in scripts/lib/fact-selection.mjs, which decides that and is tested.
console.log(`Looking for freely licensed video on ${articleTitles.length} articles...`);
const videosByArticle = new Map();
for (const batch of chunks(articleTitles)) {
  const data = await api(API, { action: 'query', prop: 'images', imlimit: '500', redirects: '1', titles: batch.join('|') });
  for (const page of data.query?.pages ?? []) {
    if (page.missing) continue;
    const clips = (page.images ?? []).map(image => image.title).filter(title => /\.(?:webm|ogv)$/i.test(title));
    if (clips.length) videosByArticle.set(normalizedTitle(page.title), clips);
  }
}
const clipTitles = [...new Set([...videosByArticle.values()].flat())];
console.log(`  reading ${clipTitles.length} candidate clips...`);
const clipInfo = new Map();
for (const batch of chunks(clipTitles)) {
  const data = await api(COMMONS_API, {
    action: 'query',
    prop: 'videoinfo',
    viprop: 'url|size|dimensions|extmetadata|derivatives',
    viurlwidth: '1000',
    viextmetadatalanguage: 'en',
    viextmetadatafilter: 'Artist|Credit|Attribution|LicenseShortName|LicenseUrl|UsageTerms',
    titles: batch.join('|'),
  });
  for (const page of data.query?.pages ?? []) {
    const info = page.videoinfo?.[0];
    if (!page.missing && info?.thumburl && info?.descriptionurl) clipInfo.set(normalizedTitle(page.title), info);
  }
}

// Wikimedia transcodes every clip; the source file is 8 to 100 MB and is never
// what the display should fetch. 240p VP9 is about 0.3 Mbps, and the H.264
// derivative stands behind it because whether Silk decodes VP9 is unverified.
// A clip with neither is skipped rather than served at full size.
function playableVideo(info) {
  const derivatives = info.derivatives ?? [];
  const pick = key => derivatives.find(derivative => derivative.transcodekey === key)?.src;
  const chosen = derivatives.find(derivative => derivative.transcodekey === '240p.vp9.webm')
    ?? derivatives.find(derivative => derivative.transcodekey === '360p.vp9.webm');
  const src = chosen?.src;
  const fallback = pick('360p.mpeg4.mov') ?? pick('480p.mpeg4.mov');
  if (!src) return null;
  // The transcode's own size, not the source file's. They agree on shape, but
  // the panel is laid out from the thing that actually plays.
  const width = Number(chosen.width ?? info.width);
  const height = Number(chosen.height ?? info.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return null;
  const metadata = info.extmetadata ?? {};
  let licenseUrl = metadata.LicenseUrl?.value || info.descriptionurl;
  if (licenseUrl.startsWith('//')) licenseUrl = `https:${licenseUrl}`;
  if (licenseUrl.startsWith('http://')) licenseUrl = `https://${licenseUrl.slice('http://'.length)}`;
  return {
    src,
    ...(fallback ? { fallback } : {}),
    width,
    height,
    poster: info.thumburl,
    seconds: Math.round(info.duration ?? 0),
    credit: tidyCredit(metadataValue(metadata, 'Attribution') || metadataValue(metadata, 'Artist') || metadataValue(metadata, 'Credit')),
    source: info.descriptionurl,
    license: metadataValue(metadata, 'LicenseShortName') || metadataValue(metadata, 'UsageTerms') || 'See file page',
    licenseUrl,
  };
}

// The clip a pick deserves, or nothing. Shortest first: of two that qualify,
// the one the panel's fifteen seconds covers more of is the better showing.
function chosenVideo(pick) {
  const clips = videosByArticle.get(normalizedTitle(pick.seed?.imageArticle ?? pick.subject)) ?? [];
  const usable = clips
    .map(title => ({ title, info: clipInfo.get(normalizedTitle(title)) }))
    .filter(clip => clip.info && videoEarnsItsPlace({
      file: clip.title.replace(/^File:/, ''),
      subject: pick.subject,
      text: pick.seed?.body ?? pick.text,
      seconds: clip.info.duration,
    }))
    .sort((a, b) => (a.info.duration ?? 0) - (b.info.duration ?? 0));
  for (const clip of usable) {
    const video = playableVideo(clip.info);
    if (video) return video;
  }
  return null;
}

await rm(OUTPUT, { recursive: true, force: true });
await mkdir(OUTPUT, { recursive: true });
const missingPictures = [];
const longHeadlines = [];
const tallPictures = [];
let total = 0;
// How many dates seated a fact from the last few years. The supply is thin —
// the calendar pages carry only a couple of hundred recent entries that are
// neither grim nor political — so this number is the honest measure of the
// recent window, and a refresh that quietly loses it should say so.
let recentFacts = 0;
let videoFacts = 0;

for (const date of dates) {
  const facts = [];
  let videos = 0;
  for (const pick of chosen.get(date.key)) {
    if (facts.length === FACTS_PER_DAY) break;
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
    const credit = metadataValue(metadata, 'Attribution') || metadataValue(metadata, 'Artist') || metadataValue(metadata, 'Credit');
    let licenseUrl = metadata.LicenseUrl?.value || image.descriptionurl;
    if (licenseUrl.startsWith('//')) licenseUrl = `https:${licenseUrl}`;
    if (licenseUrl.startsWith('http://')) licenseUrl = `https://${licenseUrl.slice('http://'.length)}`;
    // At most VIDEOS_PER_DAY, so a date is a page with a moving picture on it
    // rather than a playlist, and so the stick decodes one clip a scene at the
    // very most.
    const video = videos < VIDEOS_PER_DAY ? chosenVideo(pick) : null;
    if (video) {
      videos++;
      videoFacts++;
    }
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
      ...(video ? { video } : {}),
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
    if (isRecent(pick.year)) recentFacts++;
  }
  if (facts.length !== FACTS_PER_DAY) throw new Error(`${date.key}: ${facts.length} illustrated facts, need ${FACTS_PER_DAY}`);
  if (new Set(facts.map(fact => fact.id)).size !== FACTS_PER_DAY) throw new Error(`${date.key}: duplicate fact ids`);
  await writeFile(new URL(`${date.key}.json`, OUTPUT), `${JSON.stringify({ date: date.key, dateLabel: date.label, facts }, null, 2)}\n`);
}

await writeFile(new URL('index.json', OUTPUT), `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  source: 'https://en.wikipedia.org/wiki/Wikipedia:On_this_day',
  method: 'Editorial seeds first; otherwise English Wikipedia Events scored by scripts/lib/fact-selection.mjs for recency, subject, phrasing and readership, with Wikimedia Commons picture metadata.',
  dates: dates.length,
  facts: total,
}, null, 2)}\n`);

const asked = cacheStats.hit + cacheStats.miss;
console.log(`${cacheStats.hit} of ${asked} upstream answers came from the local cache, ${cacheStats.miss} from the network.`);
console.log(`Generated ${total} facts across ${dates.length} dates.`);
console.log(`${recentFacts} are from the last few years (${Math.round(100 * recentFacts / total)}%).`);
console.log(`${videoFacts} carry a clip that earned it; the rest are the photograph they always were.`);
if (missingPictures.length) console.log(`Passed over ${missingPictures.length} candidates with no picture.`);
if (longHeadlines.length) console.log(`Passed over ${longHeadlines.length} candidates whose headline was too long.`);
if (tallPictures.length) console.log(`Passed over ${tallPictures.length} candidates whose picture was too tall to crop.`);
