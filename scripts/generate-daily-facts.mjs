import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';

const API = 'https://en.wikipedia.org/w/api.php';
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const OUTPUT = new URL('../public/facts/daily/', import.meta.url);
const USER_AGENT = 'ClockDailyFacts/1.0 (calendar data generator)';
const TEXT_LICENSE = { name: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/' };
const overrideFile = JSON.parse(await readFile(new URL('../data/daily-fact-overrides.json', import.meta.url), 'utf8'));
const overrides = new Map(overrideFile.facts.map(fact => [`${fact.date}:${fact.country}`, fact]));
const sectionScores = { Events: 180, Births: 90 };
const countries = [
  { id: 'spain', name: 'Spain', capital: 'Madrid', latitude: 40.4168, flag: 'Flag_of_Spain.svg', credit: 'Government of Spain', pattern: /\b(?:Spain|Spanish|Spaniard|Catalan|Basque|Galician|Asturian|Andalusian|Castile|Castilian|Aragon|Aragonese|Iberian|Reconquista)\b/i },
  { id: 'denmark', name: 'Denmark', capital: 'Copenhagen', latitude: 55.6761, flag: 'Flag_of_Denmark.svg', credit: 'Danish government', pattern: /\b(?:Denmark|Danish|Dane|Copenhagen|Jutland|Zealand|Norse|Viking)\b/i },
  { id: 'greece', name: 'Greece', capital: 'Athens', latitude: 37.9838, flag: 'Flag_of_Greece.svg', credit: 'Greek government', pattern: /\b(?:Greece|Greek|Hellenic|Athenian|Athens|Cretan|Crete|Thessaloniki|Byzantine|Constantinople|Sparta|Spartan)\b/i },
];

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
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Api-User-Agent': USER_AGENT,
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    },
    body,
    signal: AbortSignal.timeout(30_000),
  });
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

function decodeEntities(value) {
  return value
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)))
    .replace(/&#x([0-9a-f]+);/gi, (_, number) => String.fromCodePoint(Number.parseInt(number, 16)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&ndash;|&mdash;/gi, '–')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function plainText(value) {
  let text = value;
  for (let pass = 0; pass < 4; pass++) text = text.replace(/\{\{[^{}]*\}\}/g, '');
  return decodeEntities(text)
    .replace(/<!--[^]*?-->/g, '')
    .replace(/<ref\b[^>]*>[^]*?<\/ref>|<ref\b[^>]*\/>/gi, '')
    .replace(/\[\[(?:[^\]|]+\|)?([^\]]+)\]\]/g, '$1')
    .replace(/\[(?:https?:\/\/\S+)\s+([^\]]+)\]/g, '$1')
    .replace(/'{2,}/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .trim();
}

function linkedTitle(value) {
  for (const match of value.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]+)?\]\]/g)) {
    const title = match[1].trim();
    if (/^(?:File|Image|Category|Template|Help):/i.test(title)) continue;
    if (/^(?:\d{1,4}|AD \d{1,4}|\d{1,4} BC)$/.test(title)) continue;
    return title;
  }
  return null;
}

function parseCandidates(date, wikitext) {
  const byCountry = Object.fromEntries(countries.map(country => [country.id, []]));
  let section = '';
  for (const rawLine of wikitext.split(/\r?\n/)) {
    const heading = rawLine.match(/^==\s*([^=]+?)\s*==\s*$/);
    if (heading) {
      section = heading[1].trim();
      continue;
    }
    if (!(section in sectionScores) || !rawLine.startsWith('*')) continue;
    const match = rawLine.match(/^\*\s*(?:\[\[)?(\d{1,4})(?:\]\])?\s*(?:–|&ndash;|—|-)\s*(.+)$/);
    if (!match) continue;
    const year = Number(match[1]);
    const wikiText = match[2];
    const text = plainText(wikiText);
    const pageTitle = linkedTitle(wikiText);
    if (!pageTitle || text.length < 20 || text.length > 320) continue;
    for (const country of countries) {
      if (!country.pattern.test(text)) continue;
      const name = plainText((wikiText.match(/\[\[(?:[^\]|]+\|)?([^\]]+)\]\]/)?.[1] ?? pageTitle));
      let title = name;
      let body;
      if (section === 'Births') {
        const description = text.replace(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*,?\\s*`, 'i'), '').replace(/[.;]+$/, '');
        body = `${name}, ${description.replace(/^(a|an)\s+/i, '')}, was born on this day in ${year}.`;
      } else {
        body = `${year}: ${text.replace(/[.;]+$/, '')}.`;
      }
      body = body.replace(/\s+/g, ' ').replace(/, ,/g, ',').trim();
      if (body.length > 260) continue;
      const historical = year <= 1950 ? Math.min(55, Math.max(0, Math.round((1950 - year) / 12))) : -Math.min(45, Math.round((year - 1950) / 2));
      const eventful = /\b(?:battle|revolt|revolution|independence|founded|opened|crowned|treaty|siege|destroyed|discovered|abolished|liberated|invasion|first)\b/i.test(text) ? 32 : 0;
      const weakConnection = /\b(?:except|exception|excluding)\b/i.test(text) ? -45 : 0;
      const score = sectionScores[section] + historical + eventful + weakConnection + Math.min(6, Math.round(text.length / 60));
      byCountry[country.id].push({
        id: `${date.key}-${country.id}-${pageTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
        date: date.key,
        dateLabel: date.label,
        country: country.id,
        countryName: country.name,
        kind: section.toLowerCase(),
        year,
        title,
        body,
        pageTitle,
        score,
        calendarSource: `https://en.wikipedia.org/wiki/${date.title}`,
      });
    }
  }
  for (const values of Object.values(byCountry)) values.sort((a, b) => b.score - a.score || b.year - a.year || a.pageTitle.localeCompare(b.pageTitle));
  return byCountry;
}

function normalizedTitle(value) {
  return value.replace(/_/g, ' ').trim().replace(/\s+/g, ' ').toLowerCase();
}

function metadataValue(metadata, key) {
  return plainText(metadata?.[key]?.value ?? '');
}

function daylightFact(date, country) {
  const [month, day] = date.key.split('-').map(Number);
  const current = new Date(Date.UTC(2024, month - 1, day));
  const yearStart = new Date(Date.UTC(2024, 0, 0));
  const dayOfYear = Math.floor((current.getTime() - yearStart.getTime()) / 86_400_000);
  const radians = degrees => degrees * Math.PI / 180;
  const latitude = radians(country.latitude);
  const declination = radians(23.44) * Math.sin((2 * Math.PI * (284 + dayOfYear)) / 365.2422);
  const horizon = radians(-0.833);
  const cosine = (Math.sin(horizon) - Math.sin(latitude) * Math.sin(declination)) / (Math.cos(latitude) * Math.cos(declination));
  const daylightMinutes = Math.round((2 * Math.acos(Math.max(-1, Math.min(1, cosine))) * 12 / Math.PI) * 12) * 5;
  const hours = Math.floor(daylightMinutes / 60);
  const minutes = daylightMinutes % 60;
  const duration = minutes ? `${hours} hours and ${minutes} minutes` : `${hours} hours`;
  const filePage = `https://commons.wikimedia.org/wiki/File:${country.flag}`;
  return {
    id: `${date.key}-${country.id}-daylight`,
    date: date.key,
    dateLabel: date.label,
    country: country.id,
    countryName: country.name,
    kind: 'daylight',
    year: 0,
    title: `${country.capital}'s daylight`,
    body: `On ${date.label}, ${country.capital} gets about ${duration} of daylight.`,
    source: {
      name: 'NOAA Solar Calculator',
      url: 'https://gml.noaa.gov/grad/solcalc/',
      calendarUrl: 'https://gml.noaa.gov/grad/solcalc/calcdetails.html',
      license: { name: 'public-domain NOAA method', url: 'https://www.noaa.gov/disclaimer' },
    },
    image: {
      src: `https://commons.wikimedia.org/wiki/Special:Redirect/file/${country.flag}?width=1000`,
      alt: `The national flag of ${country.name}.`,
      credit: country.credit,
      source: filePage,
      license: 'Public domain',
      licenseUrl: filePage,
    },
  };
}

function countryFlag(country) {
  const filePage = `https://commons.wikimedia.org/wiki/File:${country.flag}`;
  return {
    src: `https://commons.wikimedia.org/wiki/Special:Redirect/file/${country.flag}?width=1000`,
    alt: `The national flag of ${country.name}.`,
    credit: country.credit,
    source: filePage,
    license: 'Public domain',
    licenseUrl: filePage,
  };
}

console.log('Reading the 366 English Wikipedia calendar pages...');
const datePages = new Map();
for (const batch of chunks(dates.map(date => date.title))) {
  const data = await api(API, {
    action: 'query',
    prop: 'revisions',
    rvprop: 'ids|timestamp|content',
    rvslots: 'main',
    redirects: '1',
    titles: batch.join('|'),
  });
  for (const page of data.query?.pages ?? []) {
    const content = page.revisions?.[0]?.slots?.main?.content;
    if (content) datePages.set(normalizedTitle(page.title), content);
  }
}

const candidateMap = new Map();
for (const date of dates) {
  const wikitext = datePages.get(normalizedTitle(date.title));
  if (!wikitext) throw new Error(`Missing calendar page: ${date.title}`);
  const parsed = parseCandidates(date, wikitext);
  for (const country of countries) {
    const candidates = parsed[country.id].slice(0, 1);
    candidateMap.set(`${date.key}:${country.id}`, candidates);
  }
}

const articleTitles = [...new Set([...candidateMap.values()].flat().map(candidate => candidate.pageTitle))];
console.log(`Resolving images for ${articleTitles.length} candidate articles...`);
const articleImages = new Map();
let articleBatch = 0;
for (const batch of chunks(articleTitles)) {
  const data = await api(API, {
    action: 'query',
    prop: 'pageimages|info',
    piprop: 'name|thumbnail',
    pithumbsize: '1000',
    redirects: '1',
    titles: batch.join('|'),
  });
  const aliases = new Map();
  for (const normalized of data.query?.normalized ?? []) aliases.set(normalizedTitle(normalized.from), normalizedTitle(normalized.to));
  for (const redirect of data.query?.redirects ?? []) aliases.set(normalizedTitle(redirect.from), normalizedTitle(redirect.to));
  for (const page of data.query?.pages ?? []) {
    if (!page.missing && page.pageimage && page.thumbnail?.source) articleImages.set(normalizedTitle(page.title), page);
  }
  for (const [from, to] of aliases) {
    const resolved = articleImages.get(to);
    if (resolved) articleImages.set(from, resolved);
  }
  articleBatch++;
  if (articleBatch % 10 === 0) console.log(`  article batch ${articleBatch}/${Math.ceil(articleTitles.length / 50)}`);
}

const imageTitles = [...new Set([...articleImages.values()].map(page => `File:${page.pageimage}`))];
console.log(`Reading license metadata for ${imageTitles.length} Wikimedia Commons files...`);
const imageMetadata = new Map();
let imageBatch = 0;
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
  imageBatch++;
  if (imageBatch % 10 === 0) console.log(`  image batch ${imageBatch}/${Math.ceil(imageTitles.length / 50)}`);
}

await rm(OUTPUT, { recursive: true, force: true });
await mkdir(OUTPUT, { recursive: true });
const gaps = [];
let total = 0;
for (const date of dates) {
  const facts = [];
  for (const country of countries) {
    const editorialOverride = overrides.get(`${date.key}:${country.id}`);
    if (editorialOverride) {
      facts.push(editorialOverride);
      total++;
      continue;
    }
    const candidates = candidateMap.get(`${date.key}:${country.id}`) ?? [];
    const candidate = candidates[0];
    if (!candidate) {
      gaps.push(`${date.key}:${country.id}`);
      facts.push(daylightFact(date, country));
      total++;
      continue;
    }
    const article = articleImages.get(normalizedTitle(candidate.pageTitle));
    const image = article && imageMetadata.get(normalizedTitle(`File:${article.pageimage}`));
    const articleTitle = article?.title || candidate.pageTitle;
    const articleUrl = article?.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(articleTitle.replace(/ /g, '_'))}`;
    let illustration = countryFlag(country);
    if (image) {
      const metadata = image.extmetadata ?? {};
      const credit = metadataValue(metadata, 'Attribution') || metadataValue(metadata, 'Artist') || metadataValue(metadata, 'Credit') || 'Wikimedia Commons contributor';
      const license = metadataValue(metadata, 'LicenseShortName') || metadataValue(metadata, 'UsageTerms') || 'See file page';
      let licenseUrl = metadata.LicenseUrl?.value || image.descriptionurl;
      if (licenseUrl.startsWith('//')) licenseUrl = `https:${licenseUrl}`;
      if (licenseUrl.startsWith('http://')) licenseUrl = `https://${licenseUrl.slice('http://'.length)}`;
      illustration = {
        src: image.thumburl,
        alt: candidate.kind === 'births' ? `Portrait or image of ${candidate.title}.` : `Image related to ${candidate.title}.`,
        credit,
        source: image.descriptionurl,
        license,
        licenseUrl,
      };
    }
    facts.push({
      id: candidate.id,
      date: candidate.date,
      dateLabel: candidate.dateLabel,
      country: candidate.country,
      countryName: candidate.countryName,
      kind: candidate.kind,
      year: candidate.year,
      title: candidate.title,
      body: candidate.body,
      source: { name: `Wikipedia · ${articleTitle}`, url: articleUrl, calendarUrl: candidate.calendarSource, license: TEXT_LICENSE },
      image: illustration,
    });
    total++;
  }
  if (facts.length === countries.length) {
    await writeFile(new URL(`${date.key}.json`, OUTPUT), `${JSON.stringify({ date: date.key, dateLabel: date.label, facts }, null, 2)}\n`);
  }
}

await writeFile(new URL('index.json', OUTPUT), `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  source: 'https://en.wikipedia.org/wiki/Wikipedia:On_this_day',
  method: 'Editorial overrides first; otherwise English Wikipedia Events and Births scored for age, historical significance and country relevance, with Wikimedia Commons image metadata.',
  dates: dates.length,
  facts: total,
  fallbacks: gaps,
}, null, 2)}\n`);

console.log(`Generated ${total} facts across ${dates.length} dates.`);
if (gaps.length) {
  console.log(`Used the daylight fallback for ${gaps.length} country-days without a matching historical entry.`);
}
