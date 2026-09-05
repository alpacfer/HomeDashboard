// Choosing which anniversary is worth a wall.
//
// The English Wikipedia calendar pages ("September 5") hold a few hundred
// dated Events per day. Almost all of them are wars, treaties, crashes and
// election results. Buried among them are the ones a person actually looks up
// from across a room: the first YouTube video, the Osborne 1, Harambe, the
// day Microsoft was founded. This module is the part that tells those apart.
//
// It runs at build time from scripts/generate-daily-facts.mjs and is pure, so
// tests/fact-selection.test.mjs can hold the judgement calls still. Plain
// Node, no dependencies.
//
// Four things decide an entry:
//
//   1. Grim entries are dropped outright, not scored down. See GRIM.
//   2. Recency. An anniversary needs distance, so the last few years are
//      pushed away as news, and antiquity is pushed away as remote.
//   3. Category and phrasing. A first, a debut, a launch, a record.
//   4. How many people read the article. English Wikipedia pageviews are the
//      only signal here that is not a guess about taste, and they are what
//      separates the Osborne 1 (49k a year) from the Shivwits federal trust
//      relationship (794). The generator supplies them; scoring without them
//      still works and is simply blunter.

export function decodeEntities(value) {
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

export function plainText(value) {
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

export function wikiLinks(value) {
  const found = [];
  const seen = new Set();
  for (const match of value.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g)) {
    const title = match[1].trim().replace(/_/g, ' ');
    if (/^(?:File|Image|Category|Template|Help|Portal|wikt|s|q|c):/i.test(title)) continue;
    if (/^(?:\d{1,4}|AD \d{1,4}|\d{1,4} BC|\d{4}s)$/.test(title)) continue;
    if (seen.has(title)) continue;
    seen.add(title);
    found.push({ title, label: match[2]?.trim() || title });
  }
  return found;
}

// Nothing violent, nothing tragic. This runs on a wall in a home, all day,
// with nobody choosing to look at it. An entry that reads as a news bulletin
// about people being hurt is removed from the pool rather than ranked low,
// because a thin date must never be able to promote one.
const COUNT = '(?:\\d[\\d,]*|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|dozens|scores|hundreds|thousands|millions|several|many|all)';
export const GRIM = [
  new RegExp(`\\b(?:kill|killing|kills|killed|murder\\w*|injur\\w+|wound\\w+|dead|dies|died|perish\\w*)\\b[^.]{0,50}\\b${COUNT}\\b`, 'i'),
  new RegExp(`\\b${COUNT}\\b[^.]{0,50}\\b(?:killed|dead|deaths|die|dies|casualties|perish\\w*|injured|wounded|missing|victims)\\b`, 'i'),
  /\b(?:is|are|was|were|being)\s+(?:shot|killed|murdered|assassinated|executed|hanged|lynched|stabbed|beaten|kidnapped|abducted|tortured)\b/i,
  /\b(?:massacre\w*|genocide|ethnic cleansing|holocaust|pogrom|atrocit\w+|war crimes?|death toll|mass grave|concentration camp|death squad|slaughter\w*|famine|starvation)\b/i,
  /\b(?:suicide bomb\w*|car bomb\w*|terroris\w+|hostages?|hijack\w*|beheaded|firing squad|execution|lynch\w*|torture\w*|rape[ds]?|sexual (?:abuse|assault)|child abuse|slave trade|slavery)\b/i,
  /\b(?:crash\w*|derail\w*|capsiz\w*|sinks|sank|collide[sd]?|collision|explosion|explode[sd]?|detonat\w+|earthquake|tsunami|cyclone|hurricane|typhoon|tornado|epidemic|pandemic|outbreak|wildfire|landslide|mudslide|avalanche|stampede|shipwreck|engulfed by fire)\b/i,
  /\b(?:disaster\w*|catastroph\w+|meltdown|nuclear accident|oil spill|blast|flood\w*|drought|plague|quarantine|evacuat\w+|state of emergency|collapse[sd]? of the|burns? down|destroy\w+ the (?:city|town|village))\b/i,
  /\b(?:shooting\w*|gunman|gunmen|opens fire|bombing\w*|airstrike|air raid|insurgen\w+|militant\w*|guerrilla\w*|paramilitar\w*|junta|coup|purge|mutiny|riot\w*|apartheid|internment|deport\w+)\b/i,
  /\b(?:battle|siege|invasion|invade[sd]?|offensive|bombard\w+|surrender\w*|troops|army|armies|regiment|infantry|artillery|warship|torpedo|nuclear (?:test|weapon|bomb)|atomic bomb|missile|warhead|chemical weapon)\b/i,
  /\b(?:war|conflict|crisis|uprising|rebellion|revolt|insurgency|intifada)\s*:/i,
  /\b(?:intifada|uprising|rebellion|revolt|insurrection|civil unrest|martial law|dictator\w*|regime)\b/i,
  /\b(?:cease[- ]?fire|armistice|hostilities|belligerent\w*|peace treaty|prisoners? of war|occupation of|liberation of|War\b[^.]{0,20}\bbegins?\b)/i,
  /\b(?:death of|dies|died|funeral|mourn\w+|obituar\w+|posthumous\w*|assassin\w*|memorial service|state funeral|lying in state)\b/i,
  /\b(?:attacks?|attacked|attacking|cyberattacks?|ransomware|malware|raids?|ambush\w*|abduct\w+|arson|looting|vandalis\w+|unrest|clashes)\b/i,
  /\b(?:traged\w+|calamit\w+|fatal\w*|mortal\w*|wreck\w*|survivors?|missing at sea|distress signal|mayday|rescued from)\b/i,
  /\b(?:injur\w+|coma|paralys\w+|critical condition|hospitali[sz]ed|life support|amputat\w+)\b/i,
  /\b(?:rupture[sd]?|spills?|spilled|leaks? of|contaminat\w+|pollut\w+|toxic|radioactive release|evacuation)\b/i,
  /\b(?:execut(?:ed|es|ion|ions)|death (?:row|penalty|sentence)|capital punishment|electric chair|gas chamber|guillotine)\b/i,
  /\b(?:the body of|bodies of|remains (?:are|were|is|was) found|drown\w+|missing person|search and rescue)\b/i,
  /\b(?:declare[sd]? war|war on\b|at war\b|goes? to war|World War|the [A-Z]\w+ War\b)/,
  // Aviation entries on these pages are, almost without exception, accidents.
  /\bFlight\s+\d+\b/,
  // Admitting the last five years brought the 2020s with it. A pandemic, a
  // capital falling and a prison break are all grim wherever they sit in the
  // calendar, so they go here rather than in POLITICAL.
  /\b(?:COVID(?:[- ]?19)?|coronavirus|SARS-CoV[- ]?2?|lockdowns?|social distancing|face masks?)\b/i,
  /\b(?:Taliban|ISIS|ISIL|Islamic State|Al[- ]?Qaeda|Boko Haram|Hamas|Hezbollah)\b/i,
  /\b(?:flees|fled|fleeing|falls? (?:in)?to the hands of|seizes? (?:control|power))\b/i,
  /\b(?:prisoners?|inmates?|detainees?|penitentiary|hostage)\b/i,
  /\b(?:fails?|failure|explodes?|breaks? up)\s+(?:after|during|shortly after|on)\s+(?:lift[- ]?off|launch|take[- ]?off|re-?entry|ascent)\b/i,
];
export function isGrim(text) {
  return GRIM.some(pattern => pattern.test(text));
}

// Deliberately case-sensitive and deliberately short. "Thomas A. Edison" and
// "sworn in." are not fragments, and a looser version of this list threw away
// fifty-nine perfectly good entries to catch forty-four bad ones.
const FRAGMENT = [
  /\b(?:of|about|approximately|roughly|over|nearly|than|with|aboard|the|a|an)\s*[.,;]/,
  /\(\s*[),]/, /\s[,;:]\s*$/, /\b\d+\s*[-–]\s*[.,]/,
  /\b(?:at|of|to|by|for|about|over|nearly|with|from|than)\s+(?:stretching|measuring|weighing|covering|spanning|rising|standing|reaching|long|wide|high|deep|tall|thick|heavy|apart|away|below|above)\b/,
  /\b(?:at|of|to|by|for|with|from)\s+(?:at|of|to|by|for|with|from|in|on)\b/,
];
export function isFragment(text) {
  return FRAGMENT.some(pattern => pattern.test(text));
}

// Bureaucracy is not grim, only dull, so it is ranked down rather than
// dropped: a date with nothing better still has to fill three slots.
const DULL = [
  [/\b(?:treaty|convention|protocol|referendum|constitution\w*|parliament\w*|senate|congress|ratif\w+|amendment|legislat\w+|decree|accord|communiqu|delegation|ministr\w+|cabinet|prime minister|general election|inaugurat\w+|sworn in|resigns?|impeach\w*|indict\w+|convict\w+|sentenc\w+|court rules|supreme court|lawsuit|verdict|tribunal|sanctions|succeeded by|takes office|is appointed|steps down)\b/i, -40],
  [/\b(?:province|prefecture|municipalit\w+|administrative|annex\w+|secede[sd]?|independence from|admitted to the|becomes a member|joins the (?:European|United Nations|NATO)|declares independence|proclaims the|sovereignt\w+)\b/i, -30],
  [/\b(?:president|vice president|chancellor|state visit|summit|diplomat\w+|ambassador|foreign minister|head of state|monarch|coronation|abdicat\w+)\b/i, -32],
  [/\b(?:archbishop|bishop|pope|cardinal|canoniz\w+|beatif\w+|synod|diocese|patriarch|encyclical|papal|excommunicat\w+)\b/i, -28],
  [/\b(?:merger|acquisition|acquires|stock market|shareholders?|bankrupt\w+|initial public offering|nationalis\w+|privatis\w+|tariff|trade agreement|central bank|interest rate)\b/i, -20],
  // A routine mission is not the space age, it is a bus timetable. The shuttle
  // flew 135 times; five of those are worth a wall.
  [/\b(?:STS-\d+|Soyuz [A-Z]|Salyut|Progress M|Expedition \d+|Kosmos \d+|resupply)\b/, -110],
  [/\bSpace Shuttle \w+ (?:is )?launch\w*\b/i, -70],
  [/\b(?:deploy|carrying) the\b/i, -30],
  [/\b(?:elections?|electorate|ballot|candidate|coalition|assembly|committee|resolution|communist party|politburo|central committee|congress of the)\b/i, -34],
];

// The phrasings that mark a moment worth stopping for. Wikipedia's calendar
// style is consistent enough that "the first", "premieres" and "goes on sale"
// are reliable tells.
const DELIGHT = [
  [/\bthe first\b/i, 40], [/\bfirst[- ]ever\b/i, 40], [/\bfor the first time\b/i, 34],
  [/\bdebut\w*\b/i, 26], [/\bpremiere[sd]?\b/i, 26],
  [/\bworld record\b/i, 34], [/\brecord[- ]breaking\b/i, 26],
  [/\bbecomes the (?:first|youngest|oldest|fastest|largest)\b/i, 36],
  [/\bhighest[- ]grossing\b/i, 26],
  [/\b(?:releases|launches|publishes|introduces|unveils|invents|patents|discovers|premieres|opens to the public|goes on sale)\b/i, 28],
  [/\bis (?:released|published|introduced|unveiled|opened|broadcast|founded|incorporated)\b/i, 26],
  [/\b(?:last|final)\b[^.]{0,26}\b(?:episode|issue|flight|performance|game|broadcast|time)\b/i, 24],
  [/\b(?:world's|nation's|country's) (?:first|largest|longest|tallest|oldest|smallest)\b/i, 34],
  [/\bnumber one\b|\bno\. 1\b/i, 18],
  [/\bmillion (?:copies|viewers|users|players)\b/i, 22],
];

// Categories are scored by how many distinct terms they match, so an entry
// about a televised sports record lands in sport rather than in whichever
// pattern happened to be tested first.
export const CATEGORIES = [
  { id: 'tech', name: 'Tech', weight: 1.35, boost: 52, terms: [/\bcomputers?\b/i, /\bcomputing\b/i, /\bsoftware\b/i, /\binternet\b/i, /\bweb ?(?:site|page|browser)s?\b/i, /\bWorld Wide Web\b/i, /\bonline\b/i, /\be-?mail\b/i, /\bGoogle\b/, /\bApple\b/, /\bMicrosoft\b/, /\bIBM\b/, /\bIntel\b/, /\bFacebook\b/, /\bTwitter\b/, /\bYouTube\b/, /\bWikipedia\b/, /\bNetflix\b/, /\bNintendo\b/, /\bSega\b/, /\bPlayStation\b/, /\bXbox\b/, /\bAtari\b/, /\biPhone\b/i, /\biPod\b/i, /\bMacintosh\b/, /\bWindows \d/, /\bLinux\b/, /\bAndroid\b/, /\bsmartphones?\b/i, /\bvideo ?games?\b/i, /\barcade\b/i, /\bPac-Man\b/i, /\bTetris\b/i, /\bMinecraft\b/i, /\brobots?\b/i, /\bartificial intelligence\b/i, /\btransistors?\b/i, /\bmicrochips?\b/i, /\bsemiconductors?\b/i, /\btelephones?\b/i, /\btelegraphs?\b/i, /\bcellular\b/i, /\bmobile phones?\b/i, /\bbitcoin\b/i, /\bsearch engine\b/i, /\bsocial network\w*\b/i, /\bemoji\b/i, /\bGPS\b/, /\bCD-ROM\b/i, /\bDVD\b/, /\bfloppy\b/i, /\bmainframe\b/i, /\bsupercomputer\b/i, /\bDeep Blue\b/, /\bmodem\b/i, /\bcalculator\b/i] },
  { id: 'space', name: 'Space', weight: 1.25, boost: 44, terms: [/\bspacecraft\b/i, /\bspaceflight\b/i, /\bsatellites?\b/i, /\borbits?\b/i, /\bastronauts?\b/i, /\bcosmonauts?\b/i, /\bNASA\b/, /\bSpaceX\b/, /\bApollo \d/, /\bSputnik\b/, /\bVoyager\b/, /\bHubble\b/, /\btelescopes?\b/i, /\brockets?\b/i, /\bthe Moon\b/, /\blunar\b/i, /\bMars\b/, /\bMartian\b/i, /\bVenus\b/, /\bJupiter\b/, /\bSaturn\b/, /\bPluto\b/, /\bcomets?\b/i, /\basteroids?\b/i, /\bmeteor\w*\b/i, /\beclipse\b/i, /\bgalax\w+\b/i, /\bexoplanets?\b/i, /\bblack hole\b/i, /\bspace station\b/i, /\bspace shuttle\b/i, /\bspacewalk\b/i, /\bouter space\b/i, /\brovers?\b/i, /\bSpace Race\b/i] },
  { id: 'curious', name: 'Curious', weight: 1.3, boost: 52, terms: [/\bhoax\b/i, /\bprank\b/i, /\bstunt\b/i, /\bzoo\b/i, /\bgorillas?\b/i, /\belephants?\b/i, /\bpenguins?\b/i, /\bpandas?\b/i, /\bwhales?\b/i, /\bsharks?\b/i, /\boctopus\b/i, /\bpigeons?\b/i, /\bparrots?\b/i, /\bGuinness World\b/i, /\bworld's (?:largest|smallest|longest|oldest|heaviest|tallest)\b/i, /\bbizarre\b/i, /\bmyster\w+\b/i, /\btreasure\b/i, /\bUFO\b/, /\blotter\w+\b/i, /\bjackpot\b/i, /\bheist\b/i, /\bstolen\b/i, /\bforger\w+\b/i, /\bimpost\w+\b/i, /\bhot air balloon\b/i, /\bparachut\w+\b/i, /\btightrope\b/i, /\bdaredevil\b/i, /\bApril Fools\b/i, /\bescape[sd]? from\b/i] },
  { id: 'culture', name: 'Culture', weight: 1.15, boost: 36, terms: [/\balbums?\b/i, /\bsongs?\b/i, /\bbands?\b/i, /\bmusicians?\b/i, /\bsingers?\b/i, /\brock (?:band|group|music)\b/i, /\bhip hop\b/i, /\bjazz\b/i, /\bconcerts?\b/i, /\bWoodstock\b/i, /\bBeatles\b/, /\bElvis\b/, /\bMadonna\b/, /\bNirvana\b/, /\bfilms?\b/i, /\bmovies?\b/i, /\bcinema\b/i, /\bbox office\b/i, /\bHollywood\b/i, /\bAcademy Award\w*\b/i, /\bDisney\b/, /\bPixar\b/, /\bStar Wars\b/i, /\b(?:television|TV) (?:series|show|programme|program)\b/i, /\bsitcom\b/i, /\bnovels?\b/i, /\bauthors?\b/i, /\bpaintings?\b/i, /\bmuseums?\b/i, /\bexhibitions?\b/i, /\bcomics?\b/i, /\bcartoons?\b/i, /\bBroadway\b/i, /\bEurovision\b/i, /\bLEGO\b/i, /\bBarbie\b/i, /\bMuppets\b/i, /\bSimpsons\b/i, /\bMonopoly\b/i, /\bopera\b/i, /\bballet\b/i, /\bsymphony\b/i] },
  { id: 'science', name: 'Science', weight: 1.1, boost: 30, terms: [/\bscientists?\b/i, /\bphysicists?\b/i, /\bchemists?\b/i, /\bbiologists?\b/i, /\bmathematician\w*\b/i, /\bdiscover\w+\b/i, /\bpatents?\b/i, /\bexperiments?\b/i, /\blaborator\w+\b/i, /\bNobel\b/, /\bvaccines?\b/i, /\bpenicillin\b/i, /\bDNA\b/, /\bgenomes?\b/i, /\bcloning\b/i, /\bDolly the sheep\b/i, /\btransplants?\b/i, /\bdinosaurs?\b/i, /\bfossils?\b/i, /\bspecies\b/i, /\bevolution\b/i, /\bAntarctic\w*\b/i, /\bexpeditions?\b/i, /\bMount Everest\b/i, /\bperiodic table\b/i, /\bCERN\b/, /\bLarge Hadron\b/i, /\bquantum\b/i, /\blasers?\b/i, /\bX-rays?\b/i, /\bmicroscopes?\b/i, /\bsolar power\b/i, /\bMariana Trench\b/i, /\bsubmersible\b/i] },
  { id: 'sport', name: 'Sport', weight: 1.0, boost: 22, terms: [/\bOlympics?\b/i, /\bOlympic Games\b/i, /\bWorld Cup\b/i, /\bchampionships?\b/i, /\bmarathon\b/i, /\bworld record\b/i, /\bfootball\b/i, /\bbasketball\b/i, /\bNBA\b/, /\bbaseball\b/i, /\bcricket\b/i, /\btennis\b/i, /\bWimbledon\b/i, /\bgolf\b/i, /\bboxing\b/i, /\bheavyweight\b/i, /\bFormula One\b/i, /\bGrand Prix\b/i, /\bTour de France\b/i, /\bchess\b/i, /\bFIFA\b/, /\bSuper Bowl\b/i, /\bStanley Cup\b/i, /\bgold medal\b/i, /\bfour-minute mile\b/i, /\bathletics\b/i, /\bathletes?\b/i, /\brunners?\b/i, /\bsprint\w*\b/i, /\bcyclists?\b/i, /\bswimmers?\b/i, /\bwrestl\w+\b/i, /\bhockey\b/i, /\brugby\b/i, /\bmedals?\b/i, /\bruns? the (?:mile|marathon)\b/i, /\bmile in under\b/i, /\bhome runs?\b/i, /\bgrand slam\b/i] },
];
export const WORLD = { id: 'world', name: 'World', boost: -45 };

export function categorize(text) {
  let best = null;
  for (const category of CATEGORIES) {
    const hits = category.terms.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
    if (!hits) continue;
    const strength = hits * category.weight;
    if (!best || strength > best.strength) best = { category, hits, strength };
  }
  if (!best) return { id: WORLD.id, name: WORLD.name, hits: 0, boost: WORLD.boost };
  return { id: best.category.id, name: best.category.name, hits: best.hits, boost: best.category.boost + Math.min(18, best.hits * 6) };
}

// An anniversary needs distance, and antiquity reads as a textbook. But a
// calendar whose newest entry is five years old reads as a museum, so the last
// RECENT_YEARS are admitted rather than banned: below the 1975-2000 sweet spot
// on purpose, so they earn a place instead of flooding one, and only the year
// that has actually turned. `thisYear` is a parameter because this module is
// pure and because the alternative was a hardcoded era that silently aged.
// How many facts a date file holds. The generator runs as plain Node and
// cannot import lib/daily-facts.ts, which is where the browser reads the same
// number from, so the two are asserted equal in tests/daily-facts.test.mjs
// rather than shared.
export const FACTS_PER_DAY = 5;

// The far end of the same rule the recent window sets at the near end.
export const MODERN_ERA = 1000;
export const RECENT_YEARS = 5;
export function isRecent(year, thisYear = new Date().getUTCFullYear()) {
  const age = thisYear - year;
  return age >= 1 && age <= RECENT_YEARS;
}
export function recencyScore(year, thisYear = new Date().getUTCFullYear()) {
  const age = thisYear - year;
  // The current year is not an anniversary yet, and a later one is a typo or
  // a vandalised calendar page.
  if (age < 1) return -140;
  if (age <= RECENT_YEARS) return 58;
  if (year >= 2000) return 66;
  if (year >= 1975) return 74;
  if (year >= 1950) return 60;
  if (year >= 1900) return 26;
  if (year >= 1700) return -20;
  return -60;
}

// Politics is ranked down everywhere by DULL, and dropped outright inside the
// recent window. A treaty from 1963 is history; an election from last year is
// an argument someone in the room is still having, and letting the newest
// slot fill with one is the fastest way to make a wall display unwelcome.
//
// This list is a hard drop, so it is deliberately high-precision: every term
// here is political in every context. The words that are usually political
// and sometimes not — bill, king, queen, court, vote, poll, border — are left
// to DULL, because "Bill Gates", "Queen", "Stephen King" and a tennis court
// are exactly the entries this display exists for.
export const POLITICAL = [
  /\b(?:elections?|electoral|electorate|referendum|plebiscite|inaugurat\w+|sworn in|takes? (?:the )?oath|takes office|steps down as|resigns as|resignation as)\b/i,
  /\b(?:party leader|leader of the (?:\w+ ){0,2}Party\b|(?:Liberal|Labour|Conservative|Republican|Democratic|Communist|Socialist|National) Party)/,
  /\b(?:interim government|coalition government|caretaker government|chief adviser|head of government|independent state|diplomatic recognition|Nobel Peace Prize)\b/i,
  /\b(?:presidential|president of|prime minister|vice[- ]president|chancellor of|head of state|first lady|governor of|mayor of|senators?|congressm\w+|member of parliament)\b/i,
  /\b(?:parliament\w*|the senate|the congress|house of representatives|house of commons|politburo|cabinet|legislat\w+|impeach\w*|indict\w+|attorney general|supreme court|prosecutor)\b/i,
  /\b(?:treaty|treaties|sanctions?|tariffs?|embargo|diplomatic|ambassador|foreign minister|foreign policy|geopolitic\w+|statehood|sovereignty)\b/i,
  /\b(?:protests?|protesters?|demonstrations?|general strike|activis\w+|boycott|petitions?)\b/i,
  /\b(?:Brexit|European Union|NATO|United Nations|Republican Party|Democratic Party|Conservative Party|Labour Party|left[- ]wing|right[- ]wing|nationalis\w+|populis\w+|partisan)\b/i,
  /\b(?:immigration|asylum|deportations?|census|constitutional\b|amendment to the)\b/i,
  /\b(?:signs?|signed)\b[^.]{0,40}\binto law\b|\bexecutive order\b|\bstate of the union\b|\bconservatorship\b|\bdeclassified\b/i,
];
export function isPolitical(text) {
  return POLITICAL.some(pattern => pattern.test(text));
}

export function phrasingScore(text) {
  let score = 0;
  for (const [pattern, points] of DELIGHT) if (pattern.test(text)) score += points;
  for (const [pattern, points] of DULL) if (pattern.test(text)) score += points;
  return score;
}

// English Wikipedia pageviews over a year, as a score. Roughly: a thousand
// reads is nothing, fifty thousand is a real interest, a million is famous.
export function popularityScore(views) {
  if (!Number.isFinite(views) || views <= 0) return -20;
  return Math.max(-40, Math.min(90, Math.round(26 * (Math.log10(views + 10) - 3))));
}

// Links too generic to say anything about how interesting an entry is: a
// country or a capital is popular no matter what happened there.
export const GENERIC_LINKS = new Set(['United States', 'United Kingdom', 'England', 'France', 'Germany', 'Japan', 'China', 'India', 'Russia', 'Soviet Union', 'Canada', 'Australia', 'Italy', 'Spain', 'Greece', 'Denmark', 'Sweden', 'Norway', 'Netherlands', 'Belgium', 'Poland', 'Brazil', 'Mexico', 'New York City', 'London', 'Paris', 'Berlin', 'Moscow', 'Tokyo', 'Washington, D.C.', 'Los Angeles', 'San Francisco', 'Chicago', 'Rome', 'Madrid', 'Athens', 'Copenhagen', 'Europe', 'Africa', 'Asia', 'North America', 'South America', 'United Nations', 'NATO', 'European Union', 'United States Congress', 'United States Senate', 'President of the United States', 'World War II', 'World War I', 'Cold War', 'Christianity', 'Catholic Church', 'California', 'Texas', 'Florida', 'Scotland', 'Ireland', 'Wales', 'Turkey', 'Iran', 'Iraq', 'Israel', 'Egypt', 'South Africa', 'Argentina', 'Portugal', 'Switzerland', 'Austria', 'Finland', 'Hungary', 'Romania', 'Ukraine', 'Vietnam', 'South Korea', 'North Korea', 'Indonesia', 'Pakistan', 'Bangladesh', 'Nigeria', 'Kenya', 'Peru', 'Chile', 'Colombia', 'Cuba', 'Philippines', 'Thailand', 'Malaysia', 'Singapore', 'New Zealand', 'Czech Republic', 'Bulgaria', 'Serbia', 'Croatia', 'Slovakia', 'Estonia', 'Latvia', 'Lithuania', 'Iceland', 'Morocco', 'Algeria', 'Ethiopia', 'Ghana', 'Sudan', 'Syria', 'Lebanon', 'Jordan', 'Saudi Arabia', 'Afghanistan', 'Nepal', 'Sri Lanka', 'Myanmar', 'Cambodia', 'Laos', 'Mongolia', 'Kazakhstan', 'Uzbekistan', 'Belarus', 'Georgia (country)', 'Armenia', 'Azerbaijan', 'Bosnia and Herzegovina', 'Slovenia', 'Albania', 'North Macedonia', 'Montenegro', 'Moldova', 'Luxembourg', 'Malta', 'Cyprus', 'Boston', 'Seattle', 'Houston', 'Miami', 'Toronto', 'Montreal', 'Vancouver', 'Sydney', 'Melbourne', 'Amsterdam', 'Brussels', 'Vienna', 'Prague', 'Warsaw', 'Budapest', 'Lisbon', 'Dublin', 'Edinburgh', 'Manchester', 'Birmingham', 'Barcelona', 'Milan', 'Munich', 'Hamburg', 'Frankfurt', 'Zurich', 'Geneva', 'Stockholm', 'Oslo', 'Helsinki', 'Beijing', 'Shanghai', 'Hong Kong', 'Seoul', 'Mumbai', 'Delhi', 'Bangkok', 'Jakarta', 'Cairo', 'Istanbul', 'Tehran', 'Baghdad', 'Jerusalem', 'Dubai', 'NASA', 'Apple Inc.', 'Google', 'Microsoft', 'IBM', 'Amazon (company)', 'BBC', 'CNN', 'Space Shuttle program', 'Space Shuttle', 'International Space Station', 'Soviet space program', 'United States Navy', 'United States Army', 'United States Air Force', 'Royal Navy', 'Roman Catholic Church', 'Olympic Games', 'Summer Olympics', 'Winter Olympics', 'FIFA World Cup', 'Nobel Prize', 'Donald Trump', 'Barack Obama', 'Joe Biden', 'Vladimir Putin', 'Bill Clinton', 'George W. Bush', 'Ronald Reagan', 'Margaret Thatcher', 'Adolf Hitler', 'Joseph Stalin', 'Winston Churchill', 'Elizabeth II', 'Pope Francis', 'Pope John Paul II', 'Mao Zedong', 'John F. Kennedy', 'Richard Nixon', 'Apollo program', 'Space Race', 'Project Mercury', 'Project Gemini', 'History of rocketry']);

// The articles worth asking pageviews about: the entry's own links, minus the
// generic ones, capped so a long entry cannot cost a dozen requests.
export function measurableLinks(entry, limit = 4) {
  const titles = entry.links.map(link => link.title);
  const specific = titles.filter(title => !GENERIC_LINKS.has(title));
  return (specific.length ? specific : titles).slice(0, limit);
}

const ENTRY = /^\*\s*(?:\[\[)?(\d{1,4})(?:\]\])?\s*(?:–|&ndash;|—|-)\s*(.+)$/;

// Calendar entries often open with a topic label: "Apollo program: Apollo 8
// enters orbit around the Moon". The label is the shelf the entry was filed
// on, not what happened, and taking it as the subject put "Apollo program" on
// the wall twice in one December. Strip it before anything else reads the line.
const TOPIC_PREFIX = /^\s*(?:\[\[[^\]]{1,50}\]\]|[A-Z][^:[\]]{0,45})\s*:\s+(?=\S)/;
export function stripTopicPrefix(wikitext) {
  const stripped = wikitext.replace(TOPIC_PREFIX, '');
  return stripped.length >= 24 && /\[\[/.test(stripped) ? stripped : wikitext;
}

// Only the Events section. Births read as a list of names and descriptions
// with nothing happening in them, which is the failure this rework exists to
// fix, so they are not read at all.
export function parseEntries(wikitext) {
  const entries = [];
  let section = '';
  for (const line of wikitext.split(/\r?\n/)) {
    const heading = line.match(/^==\s*([^=]+?)\s*==\s*$/);
    if (heading) {
      section = heading[1].trim();
      continue;
    }
    if (section !== 'Events' || !line.startsWith('*')) continue;
    const match = line.match(ENTRY);
    if (!match) continue;
    const year = Number(match[1]);
    const wikitext = stripTopicPrefix(match[2]);
    const text = plainText(wikitext);
    const links = wikiLinks(wikitext);
    // A wall is read at a glance. Wikipedia's longest calendar entries run to
    // a paragraph of specialist vocabulary — a memoir on birefringence read to
    // the Academy of Sciences — and none of them belong on one.
    if (!links.length || text.length < 24 || text.length > 220) continue;
    // Antiquity is out of scope, not merely unlikely. recencyScore ranks it
    // down, but the variety pass can promote a low score over a better one of
    // a kind the day already has, which is how San Marino's founding in 301
    // reached the wall. See MODERN_ERA and tests/daily-facts.test.mjs.
    if (year < MODERN_ERA) continue;
    if (isGrim(text) || isFragment(text)) continue;
    const specific = links.find(link => !GENERIC_LINKS.has(link.title));
    entries.push({ year, text, links, subject: (specific ?? links[0]).title });
  }
  return entries;
}

export function scoreEntry(entry, views = new Map(), thisYear = new Date().getUTCFullYear()) {
  const category = categorize(entry.text);
  const popularity = popularityScore(Math.max(0, ...measurableLinks(entry).map(title => views.get(title) ?? 0)));
  const wordy = entry.subject.length > 42 ? -24 : 0;
  const recent = isRecent(entry.year, thisYear);
  // Sunk rather than filtered, so there is one place where an entry's fate is
  // decided and one number to read when asking why it lost.
  const recentPolitics = recent && isPolitical(entry.text) ? -160 : 0;
  return {
    ...entry,
    category,
    popularity,
    recent,
    score: recencyScore(entry.year, thisYear) + phrasingScore(entry.text) + category.boost + popularity + wordy
      + recentPolitics + Math.min(8, Math.round(entry.text.length / 50)),
  };
}

// Five a day, preferring different kinds. Variety is a preference and not a
// rule: only 136 of the 366 calendar dates offer five distinct categories at
// all, so the first pass takes one of each kind it can and the second fills
// the rest on score alone. A day of nothing but space launches still reads as
// a themed page, which is what the first pass is for.
//
// The order returned is the order the generator will try to use, and it drops
// anything it cannot illustrate, so it asks for far more than three. Category
// variety wins the first pass over the ranked entries and score alone wins the
// second. `reserve` comes last and only last: those entries were never
// measured against readership, and letting them compete on variety pulled the
// calendar back towards older and duller anniversaries.
// One of the three is held for the last RECENT_YEARS when the date offers a
// candidate worth having, because recent entries score below the sweet spot on
// purpose and would otherwise simply never win. RECENT_FLOOR is what "worth
// having" means: a recent entry has to clear a real score, not merely be the
// newest thing on a thin date, or the slot fills with a routine announcement
// nobody would stop for. 70 is where the quality cliff sits when the whole
// calendar is scored against real pageviews: above it are the Louvre heist,
// Ingenuity's first flight on Mars and Webb's launch; the band below opens
// with a declassified file and a signing ceremony.
export const RECENT_FLOOR = 70;
export function chooseFacts(entries, { views = new Map(), count = FACTS_PER_DAY, seeds = [], reserve = [], thisYear = new Date().getUTCFullYear() } = {}) {
  const rank = list => list.map(entry => scoreEntry(entry, views, thisYear)).sort((a, b) => b.score - a.score || b.year - a.year);
  const ranked = rank(entries);
  const spare = rank(reserve);
  const chosen = [...seeds];
  const usedCategories = new Set(seeds.map(seed => seed.category?.id ?? seed.category));
  const usedSubjects = new Set(seeds.map(seed => seed.subject));
  const take = (list, varietyOnly) => {
    for (const entry of list) {
      if (chosen.length >= count) return;
      if (usedSubjects.has(entry.subject)) continue;
      if (varietyOnly && usedCategories.has(entry.category.id)) continue;
      chosen.push(entry);
      usedCategories.add(entry.category.id);
      usedSubjects.add(entry.subject);
    }
  };
  const newest = ranked.find(entry => entry.recent && entry.score >= RECENT_FLOOR && !usedSubjects.has(entry.subject));
  if (newest) take([newest], false);
  take(ranked, true);
  take(ranked, false);
  take(spare, false);
  return chosen.slice(0, count);
}

// The picture credit, cut down to something that belongs under a picture on a
// wall. Commons' Attribution and Artist fields are free text, and about a
// tenth of them are not a name at all: a paragraph of provenance, a bare URL,
// a note asking to be told when the file is reused. Untouched they ran to 160
// characters and were the loudest thing in the bottom half of the panel.
//
// The name is what attribution owes; the rest is on the file page, which the
// credit links to. So: drop the scaffolding, keep the first credited party,
// and fall back to the site when what is left does not read as a name.
const CREDIT_ABBR = /\b(?:[A-Z]|Inc|Ltd|Co|Corp|Dr|Prof|St|Mr|Mrs|Ms|Jr|Sr|al|ca|fl|no|ed|vol|Bros)\.$/;
const CREDIT_PROSE = /\b(?:I|me|my|you|your|we|our|please|feel free|available at|published in|presumably|appreciate|notified|comes from|this (?:file|photo|image|work|media)|the authors?|exact image|gallery|retrieved|according to|see also|courtesy of|permission|own \w+ edit|based on|derivative (?:of|work)|vectori[sz]ed)\b/i;
const CREDIT_LABEL = /^(?:[^:]{1,30}:|(?:photo|photograph|image|picture|painting|portrait|drawing)\s+by)\s+/i;
// Where a second contributor starts. Commons chains them with slashes and
// semicolons, and Flickr credits append the uploader's home town.
// "and" is deliberately not here. Splitting on it turned "National
// Aeronautics and Space Administration" into "National Aeronautics", and a
// joint credit truncated to "Thomas Rowlandson and Augustus…" is a better
// attribution than one that silently drops the second name.
const CREDIT_PARTY = /\s*[;/]\s*|\s+[-–—]\s+|\s+(?:from|for|by)\s+|\s*,\s*(?:and\s+)?(?:distributed|restored|cropped|colou?ri[sz]ed|retouched|uploaded|derivative)\b/i;
const CREDIT_HOME = /\s+at\s+(?:the\s+)?English(?:-language)?\s+Wikipedia\b.*$/i;
const CREDIT_UPLOADER = /^(?:the\s+)?original uploader was\s+/i;
// An address is not a credit, and neither is a file name.
const CREDIT_EMAIL = /\S+\s*(?:@|\[at\])\s*\S+\.\w{2,}/gi;
const CREDIT_FILENAME = /^\S*_\S*_\S*$|\.(?:jpe?g|png|gif|svg|tiff?|webp|ogv|webm)\b/i;

// Deliberately one entry. Commons writes NASA's Artist field out in full on
// about a dozen of the calendar's pictures, and on a panel this size that
// truncates to "National Aeronautics and Space…", which is both the longest
// credit on the display and the one every reader already knows by its
// initials. This is the same kind of display normalisation readableTitle does
// for "IPhone", not the start of a lookup table: a name only belongs here when
// the organisation itself uses the short form as its name.
const CREDIT_INITIALISMS = [[/^National Aeronautics and Space Administration\b/i, 'NASA']];

export function tidyCredit(value, limit = 40) {
  let text = String(value ?? '')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(CREDIT_EMAIL, ' ')
    .replace(/\[\d+\]/g, ' ')
    .replace(/\([^()]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/^[-–—,;:.\s]+/, '')
    .trim();
  // Commons sometimes stores the same name twice in one field, which read as
  // "Unknown authorUnknown author" under the picture.
  const half = text.length / 2;
  if (Number.isInteger(half) && text.slice(0, half).trim() === text.slice(half).trim()) text = text.slice(0, half).trim();
  text = text.replace(/^(.{5,60}?)\1/, '$1').trim();
  text = text.replace(CREDIT_HOME, '').replace(CREDIT_UPLOADER, '').trim();
  for (const [pattern, short] of CREDIT_INITIALISMS) text = text.replace(pattern, short);
  for (let pass = 0; pass < 2; pass++) {
    const stripped = text.replace(CREDIT_LABEL, '').trim();
    if (stripped === text || stripped.length < 10) break;
    text = stripped;
  }
  for (const match of text.matchAll(/\.\s+/g)) {
    const head = text.slice(0, match.index + 1);
    if (head.length >= 8 && !CREDIT_ABBR.test(head)) { text = head.replace(/\.$/, ''); break; }
  }
  if (text.length > limit) {
    const separator = text.slice(4).search(CREDIT_PARTY);
    if (separator >= 0) text = text.slice(0, separator + 4).trim();
  }
  if (text.length > limit) {
    const comma = text.indexOf(',');
    const head = text.slice(0, comma);
    if (comma >= 6 && head.split(' ').length <= 4 && !CREDIT_ABBR.test(head)) text = head;
  }
  text = text.replace(/[-–—,;:.\s]+$/, '').trim();
  if (text.replace(/[^A-Za-zÀ-ɏ]/g, '').length < 3 || CREDIT_PROSE.test(text) || CREDIT_FILENAME.test(text)) return 'Wikimedia Commons';
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit + 1);
  const space = cut.lastIndexOf(' ');
  return (space > limit / 2 ? cut.slice(0, space) : text.slice(0, limit)).replace(/[-–—,;:.\s]+$/, '') + '…';
}

// The calendar entry, minus the scaffolding a wall display does not need: the
// year is shown on its own line, and a "Space Race:" style topic prefix is
// noise once the category is named above the headline.
//
// The doubled full stop is upstream, not a bug here. Wikipedia's own source
// for 19 October 2025 reads "in [[Paris]]..<ref>", and once the reference is
// stripped the panel showed "Paris..". One entry in 1098 today, but the
// calendar is re-read from a wiki on every refresh, so it is collapsed rather
// than corrected upstream and forgotten.
export function readableBody(text) {
  let body = String(text ?? '')
    .replace(/^(?:[A-Z][\w'’.-]*(?:\s+[\w'’.-]+){0,4})\s*:\s+/, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/([.!?])[.]+(?=\s|$)/g, '$1')
    .trim();
  if (body && !/[.!?"')\]]$/.test(body)) body += '.';
  return body;
}

// Whether a clip earns the slot a photograph would otherwise have.
//
// A video is not an upgrade on a picture. It costs a decoder on a stick that
// has exactly one, the scene lasts fifteen seconds and then moves on, and most
// of what Commons holds for these subjects is a slow pan over the same object
// the still already shows — a spacecraft on a stand, a museum exhibit, a
// portrait that happens to have been filmed. Three things have to be true:
//
//   1. The fact is about something that moved. A launch, a flight, a dance, an
//      eruption, a first performance. "Muhammad Ali wins gold" is a portrait,
//      and so is "the Osborne 1 is unveiled".
//   2. Fifteen seconds of it is representative. The panel plays the opening
//      and nothing else, so a two-hour documentary shows a title card, and a
//      three-second animation shows a stutter.
//   3. The file is of the subject rather than merely on its article. Wikipedia
//      articles carry incidental clips — an unrelated interview, a stock shot
//      of the city it happened in.
//
// Anything that fails is shown as the still it already had, which is the right
// answer far more often than not.
export const VIDEO_MIN_SECONDS = 4;
export const VIDEO_MAX_SECONDS = 150;
export const VIDEOS_PER_DAY = 1;

const MOTION = [
  /\b(?:launch\w*|lift[- ]?off|blast\w* off|takes? off|take[- ]?off)\b/i,
  /\b(?:flies|flew|flight|flying|airborne|orbits?|orbit\w+|spacewalk|re-?entry|splashdown|touchdown|lands?|landing)\b/i,
  /\b(?:danc\w+|perform\w+|premiere[sd]?|concert|sings?|sang|plays? live|broadcast\w*|televis\w+|screen\w+)\b/i,
  /\b(?:races?|racing|sprint\w*|runs? the|marathon|laps?|drives?|rides?|sails?|swims?|jumps?|leaps?|climbs?)\b/i,
  /\b(?:erupt\w+|explod\w+ into|geyser|waterfall|avalanche of|flows?)\b/i,
  /\b(?:parade|procession|ceremony|opening ceremony|demonstrat\w+|unveil\w+ in motion|marches?)\b/i,
  /\b(?:first film|motion picture|animation|animated|cartoon|footage|newsreel|film is (?:released|shown|screened))\b/i,
  /\b(?:robot\w*|rover|drone|helicopter|aircraft|aeroplane|airplane|balloon|train|locomotive|rocket)\b/i,
];
export function isMotion(text) {
  return MOTION.some(pattern => pattern.test(text));
}

// A loose match, on purpose: Commons file names are written by hand and rarely
// repeat an article title exactly. Sharing a distinctive word is enough to say
// the clip is of the subject rather than of the town it happened in.
const FILE_NOISE = new Set(['the', 'a', 'an', 'of', 'in', 'on', 'at', 'and', 'or', 'to', 'for', 'from', 'by', 'with',
  'video', 'film', 'clip', 'footage', 'movie', 'ogv', 'webm', 'ogg', 'mov', 'full', 'part', 'hd', 'original', 'archive']);
function words(value) {
  return new Set(String(value ?? '').toLowerCase().replace(/[_\-.]+/g, ' ').replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/).filter(word => word.length > 3 && !FILE_NOISE.has(word)));
}
export function fileMatchesSubject(file, subject) {
  const wanted = words(subject);
  if (!wanted.size) return false;
  const found = words(file);
  for (const word of wanted) if (found.has(word)) return true;
  return false;
}

export function videoEarnsItsPlace({ file, subject, text, seconds } = {}) {
  if (!Number.isFinite(seconds) || seconds < VIDEO_MIN_SECONDS || seconds > VIDEO_MAX_SECONDS) return false;
  if (!fileMatchesSubject(file, subject)) return false;
  return isMotion(String(text ?? ''));
}
