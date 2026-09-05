import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FACTS_PER_DAY, categorize, chooseFacts, fileMatchesSubject, isFragment, isGrim, isMotion, isPolitical, isRecent,
  measurableLinks, parseEntries, popularityScore,
  readableBody, recencyScore, scoreEntry, tidyCredit, videoEarnsItsPlace,
} from '../scripts/lib/fact-selection.mjs';

// Real lines from the English Wikipedia calendar pages. The point of this
// suite is that the editorial judgement in fact-selection.mjs stays put: these
// are the entries the display must never show, and the ones it exists for.

const GRIM_LINES = [
  'At least 111 people are killed and 233 injured as violence breaks out in Hawija, Iraq.',
  'SAETA Flight 011 crashes in Pastaza Province, Ecuador, killing all 57 people on board.',
  'In West Bengal, India, the Jnaneswari Express train derailment and subsequent collision kills 148 passengers.',
  'Harambe, a gorilla, is shot to death after grabbing a three-year-old boy in his enclosure at the Cincinnati Zoo.',
  'Cold War: Fall of the Berlin Wall: East Germany opens checkpoints in the Berlin Wall.',
  'The Chernobyl disaster occurs in the Ukrainian Soviet Socialist Republic.',
  'James Holmes opened fire at a movie theater in Aurora, Colorado, killing 12 and injuring 70 others.',
  'Spanish Civil War: Llanes falls to the Nationalists following a one-day siege.',
];

const KEEPER_LINES = [
  'The first YouTube video, titled "Me at the zoo", is published by co-founder Jawed Karim.',
  'Apple Inc. releases its first mobile phone, the iPhone.',
  'Microsoft is founded as a partnership between Bill Gates and Paul Allen in Albuquerque, New Mexico.',
  'First case of a computer bug being found: A moth lodges in a relay of a Harvard Mark II computer.',
  'Dolly the sheep becomes the first mammal cloned from an adult cell.',
  'MTV begins broadcasting in the United States and airs its first video, "Video Killed the Radio Star".',
  'Sputnik 1 becomes the first artificial satellite to orbit the Earth.',
  'Scott Fahlman posts the first documented emoticons :-) and :-( on the Carnegie Mellon University bulletin board system.',
];

test('an entry about people being hurt never reaches the display', () => {
  for (const line of GRIM_LINES) assert.equal(isGrim(line), true, line);
});

test('the entries this display exists for survive the filter', () => {
  for (const line of KEEPER_LINES) assert.equal(isGrim(line), false, line);
});

test('categories follow the subject, not the first pattern that matches', () => {
  assert.equal(categorize('Apple Inc. releases its first mobile phone, the iPhone.').id, 'tech');
  assert.equal(categorize('Sputnik 1 becomes the first artificial satellite to orbit the Earth.').id, 'space');
  assert.equal(categorize('Star Wars is released in US theaters.').id, 'culture');
  assert.equal(categorize('Roger Bannister becomes the first person to run the mile in under four minutes.').id, 'sport');
  assert.equal(categorize('Dolly the sheep becomes the first mammal cloned from an adult cell.').id, 'science');
  assert.equal(categorize('The Twelfth Council of Toledo implements measures in Spain.').id, 'world');
});

test('an anniversary needs distance, but the calendar does not stop five years ago', () => {
  assert.ok(recencyScore(2005, 2026) > recencyScore(681, 2026));
  assert.ok(recencyScore(1981, 2026) > recencyScore(1937, 2026));
  // The last five years are admitted, and deliberately rank below the sweet
  // spot: a recent entry earns its place through the slot chooseFacts holds
  // for one, not by outscoring the Osborne 1.
  assert.ok(recencyScore(2024, 2026) > recencyScore(1600, 2026));
  assert.ok(recencyScore(2024, 2026) < recencyScore(1981, 2026));
  // This year is not an anniversary yet, and a later one is a vandalised page.
  assert.equal(recencyScore(2026, 2026), -140);
  assert.equal(recencyScore(2027, 2026), -140);
  // The window moves with the year instead of ageing into a hardcoded era.
  assert.equal(isRecent(2021, 2026), true);
  assert.equal(isRecent(2021, 2027), false);
});

test('recent politics is dropped outright; recent everything else is not', () => {
  for (const line of [
    'A general election is held in the United Kingdom.',
    'Justin Trudeau announces his resignation as leader of the Liberal Party of Canada.',
    'Nobel laureate Muhammad Yunus takes oath as Chief Adviser to form an interim government in Bangladesh.',
    'Protests begin across the country over the new law.',
    'Israel recognises Somaliland as an independent state.',
  ]) assert.equal(isPolitical(line), true, line);
  // The words that are usually political and sometimes not are left to DULL:
  // these are exactly the entries the panel exists for.
  for (const line of [
    'The Nintendo Switch 2 video game console is released worldwide.',
    'The Ingenuity helicopter becomes the first aircraft to achieve flight on another planet.',
    'Microsoft is founded as a partnership between Bill Gates and Paul Allen.',
    'Queen releases the single Bohemian Rhapsody.',
    'Stephen King publishes his first novel, Carrie.',
    'The longest tennis match in history ends on court 18 at Wimbledon.',
  ]) assert.equal(isPolitical(line), false, line);
});

test("a recent election sinks; the same year's console launch does not", () => {
  const election = { year: 2024, text: 'A general election is held in the United Kingdom.', links: [{ title: 'X' }], subject: 'X' };
  const console2 = { year: 2025, text: 'The Nintendo Switch 2 video game console is released worldwide.', links: [{ title: 'Nintendo Switch 2' }], subject: 'Nintendo Switch 2' };
  const views = new Map([['Nintendo Switch 2', 900_000]]);
  assert.ok(scoreEntry(election, views, 2026).score < 0);
  assert.ok(scoreEntry(console2, views, 2026).score > 110);
  // An old election is only dull, not dropped: a thin date still needs three.
  assert.ok(scoreEntry({ ...election, year: 1974 }, views, 2026).score > scoreEntry(election, views, 2026).score);
});

test('one of the three is held for the last five years, when the day offers one worth having', () => {
  const older = [
    { year: 1975, text: 'Microsoft is founded as a partnership between Bill Gates and Paul Allen.', links: [{ title: 'Microsoft' }], subject: 'Microsoft' },
    { year: 1957, text: 'Sputnik 1 becomes the first artificial satellite to orbit the Earth.', links: [{ title: 'Sputnik 1' }], subject: 'Sputnik 1' },
    { year: 1977, text: 'Star Wars is released in US theaters.', links: [{ title: 'Star Wars' }], subject: 'Star Wars' },
  ];
  const views = new Map([['Microsoft', 900_000], ['Sputnik 1', 400_000], ['Star Wars', 2_000_000], ['Nintendo Switch 2', 900_000]]);
  const strong = { year: 2025, text: 'The Nintendo Switch 2 video game console is released worldwide.', links: [{ title: 'Nintendo Switch 2' }], subject: 'Nintendo Switch 2' };
  assert.equal(chooseFacts([...older, strong], { views, thisYear: 2026, count: 3 }).some(fact => fact.subject === 'Nintendo Switch 2'), true,
    'a recent entry loses on score alone, which is what the reserved slot is for');
  // The slot is held, not given away. An entry whose only merit is being new
  // stays off the wall, or a thin date becomes a news bulletin.
  const weak = { year: 2024, text: 'A regional water authority is reorganised in the north of the country.', links: [{ title: 'Water' }], subject: 'Water' };
  assert.equal(chooseFacts([...older, weak], { views, thisYear: 2026, count: 3 }).some(fact => fact.subject === 'Water'), false);
  // And nothing about the reserved slot loosens the rules that were there
  // before it: still three, still of three kinds.
  const picked = chooseFacts([...older, strong], { views, thisYear: 2026, count: 3 });
  assert.equal(picked.length, 3);
  assert.equal(new Set(picked.map(fact => fact.category.id)).size, 3);
});

test('the body loses the scaffolding and gains a full stop, but never two', () => {
  // The topic prefix is the shelf the entry was filed on, not what happened,
  // and the category is already named above the headline.
  assert.equal(readableBody('Space Race: Apollo 8 enters orbit around the Moon'), 'Apollo 8 enters orbit around the Moon.');
  assert.equal(readableBody('MTV begins broadcasting in the United States'), 'MTV begins broadcasting in the United States.');
  assert.equal(readableBody('The first YouTube video is published.'), 'The first YouTube video is published.');
  // Upstream, not ours: Wikipedia's source for 19 October 2025 reads
  // "in [[Paris]]..<ref>", and stripping the reference left "Paris.." on the
  // wall. The calendar is re-read from a wiki every refresh, so this is
  // collapsed here rather than fixed upstream and forgotten.
  assert.equal(readableBody('Pieces of the French Crown Jewels are stolen during a heist on the Louvre Museum in Paris..'),
    'Pieces of the French Crown Jewels are stolen during a heist on the Louvre Museum in Paris.');
  assert.equal(readableBody('It ran for years... and then stopped'), 'It ran for years. and then stopped.');
  assert.equal(readableBody(''), '');
});

test('a clip has to earn the slot a photograph would have had', () => {
  const earns = (file, subject, text, seconds) => videoEarnsItsPlace({ file, subject, text, seconds });
  // Something moved, the file is of the subject, and fifteen seconds of it is
  // representative.
  assert.equal(earns('Ariane 5 10 2007.ogv', 'Ariane 5', 'The last Ariane 5 rocket is launched carrying two satellites.', 60), true);
  assert.equal(earns('Apollo 9 16mm Film 1969.webm', 'Apollo 9', 'Apollo 9 is launched into orbit to test the lunar module.', 120), true);

  // A portrait is a portrait. Nothing in this one moves, and a photograph says
  // it better than fifteen seconds of footage would.
  assert.equal(earns('Muhammad Ali NYWTS.webm', 'Muhammad Ali', 'Muhammad Ali wins the gold medal in the light heavyweight boxing competition.', 40), false);

  // The panel plays the opening and nothing else, so a documentary shows a
  // title card and a three-second animation shows a stutter.
  assert.equal(earns('A day with Thomas A. Edison.webm', 'Thomas Edison', 'Thomas Edison opens the first motion picture studio.', 1_500), false);
  assert.equal(earns('Spirk.ogv', 'Accordion', 'An accordion is played on film.', 2), false);

  // On the article is not the same as of the subject.
  assert.equal(earns('Unrelated Paris street scene.webm', 'Ariane 5', 'The last Ariane 5 rocket is launched.', 60), false);

  // Deliberately conservative, and this is what that costs: NASA names its
  // files "Ap14", which cannot be tied to "Apollo 14" without matching on the
  // number alone, and matching on a number pulls in whatever else shares it.
  // The date shows its photograph instead, which is the cheap way to be wrong.
  assert.equal(earns('Ap14 flag.ogv', 'Apollo 14', 'Apollo 14 lands on the Moon and the crew plants the flag.', 30), false);

  assert.equal(fileMatchesSubject('Ariane 5 10 2007.ogv', 'Ariane 5'), true);
  assert.equal(fileMatchesSubject('Commons-logo.svg', 'Ariane 5'), false);
  assert.equal(isMotion('The Ingenuity helicopter achieves the first flight on another planet.'), true);
  assert.equal(isMotion('Microsoft is founded as a partnership between Bill Gates and Paul Allen.'), false);
});

test('a picture credit is cut to a name, and to nothing when it is not one', () => {
  // Real Attribution and Artist fields from Wikimedia Commons.
  assert.equal(tidyCredit('NASA'), 'NASA');
  assert.equal(tidyCredit('Ira Rosenberg'), 'Ira Rosenberg');
  assert.equal(tidyCredit('NASA / JPL'), 'NASA / JPL', 'a short chain of credits is left alone');
  assert.equal(tidyCredit('Unknown authorUnknown author'), 'Unknown author', 'Commons stores some names twice');
  assert.equal(tidyCredit('Original: Rob Janoff'), 'Rob Janoff');
  assert.equal(tidyCredit('Lumidek at English Wikipedia'), 'Lumidek');
  assert.equal(tidyCredit('The original uploader was TexasDex at English Wikipedia'), 'TexasDex');
  assert.equal(tidyCredit('NASA Headquarters - GReatest Images of NASA'), 'NASA Headquarters',
    'over the limit, only the first credited party is kept');
  assert.equal(tidyCredit('Photo by Lotte Jacobi, per a credit in the bottom-left corner of the print'), 'Lotte Jacobi');
  assert.equal(tidyCredit('Original uploader was Mswggpai at English Wikipedia'), 'Mswggpai');
  assert.equal(tidyCredit('fir0002 flagstaffotos [at] gmail.com'), 'fir0002', 'an address is not a credit');
  assert.equal(tidyCredit('Unknown authorUnknown author or not stated'), 'Unknown author or not stated',
    'a doubled field does not always double exactly');
  // A joint credit truncates rather than splitting: dropping the second name
  // would be a worse attribution than showing that there is one. This is also
  // why "and" is not a party separator — it cut "National Aeronautics and
  // Space Administration" down to "National Aeronautics".
  // The exception to that: an organisation whose own short name is what
  // everyone calls it. Truncating this one read "National Aeronautics and
  // Space…" on a dozen dates.
  assert.equal(tidyCredit('National Aeronautics and Space Administration'), 'NASA');
  assert.equal(tidyCredit('National Aeronautics and Space Administration / JPL-Caltech'), 'NASA / JPL-Caltech');
  assert.equal(tidyCredit('Thomas Rowlandson (1756–1827) and Augustus Charles Pugin (1762–1832)'), 'Thomas Rowlandson and Augustus Charles…');
  // Not a name at all. The file page is linked beside it and carries the full
  // field, so the site is a truthful credit and a paragraph of provenance is
  // not something to put under a picture on a wall.
  assert.equal(tidyCredit('I would appreciate being notified if you use my work outside Wikimedia.'), 'Wikimedia Commons');
  assert.equal(tidyCredit('Note: Image is available at [1] on the Paleontological Research Institution web site.'), 'Wikimedia Commons');
  assert.equal(tidyCredit('https://wellcomeimages.org/indexplus/obf_images/05/8e/26.jpg'), 'Wikimedia Commons');
  assert.equal(tidyCredit('BEA_De_Havilland_DH-106_Comet_4B_Manteufel.jpg: Ralf Manteufel'), 'Wikimedia Commons', 'a file name is not a credit');
  assert.equal(tidyCredit('own svg edit based on different vector graphics'), 'Wikimedia Commons');
  assert.equal(tidyCredit(''), 'Wikimedia Commons');
  assert.equal(tidyCredit(undefined), 'Wikimedia Commons');
  // Whatever comes back has to fit on one line beside the licence.
  for (const credit of ['a'.repeat(400), 'Word '.repeat(60), 'McFadden Publications, Inc.; no photographer credited; photo likely the work of Sonya Noskowiak']) {
    assert.ok(tidyCredit(credit).length <= 41, credit.slice(0, 30));
  }
});

test('readership separates a real interest from a footnote', () => {
  assert.ok(popularityScore(860_664) > popularityScore(49_371));
  assert.ok(popularityScore(49_371) > popularityScore(794));
  assert.equal(popularityScore(0), -20);
  assert.ok(popularityScore(50_000_000) <= 90, 'one runaway article cannot swamp every other signal');
});

const CALENDAR = [
  '== Events ==',
  '===Pre-1600===',
  '* [[681]] – [[Twelfth Council of Toledo]]: King Erwig of the Visigoths initiates a council in Spain.',
  '===1901–present===',
  '* [[1975]] – [[Microsoft]] is founded as a partnership between [[Bill Gates]] and [[Paul Allen]] in [[Albuquerque, New Mexico]].',
  '* [[2005]] – The first [[YouTube]] video, titled "[[Me at the zoo]]", is published by co-founder [[Jawed Karim]].',
  '* [[2013]] – At least 111 people are killed as violence breaks out in [[Hawija]], Iraq.',
  '== Births ==',
  '* [[1868]] – [[S. P. L. Sørensen]], Danish chemist and academic (died 1939)',
  '== Deaths ==',
  '* [[1997]] – [[Someone]], English actor (born 1920)',
].join('\n');

test('only dated Events entries are read, and grim ones are dropped there', () => {
  const entries = parseEntries(CALENDAR);
  assert.deepEqual(entries.map(entry => entry.year), [1975, 2005], 'the 681 council is below the floor');
  assert.equal(entries.some(entry => entry.text.includes('Hawija')), false);
  assert.equal(entries.some(entry => entry.text.includes('Sørensen')), false, 'births read as a list of names, not as history');
  assert.equal(entries[1].subject, 'YouTube');
});

test('antiquity is out of scope, not merely unlikely', () => {
  // recencyScore ranks it down, but the variety pass can promote a low score
  // over a better one of a kind the day already has: 3 September has two good
  // sport entries, so variety took San Marino's founding in 301 for the third
  // slot. Ranking alone was not enough, so parseEntries holds the floor.
  assert.deepEqual(parseEntries('== Events ==\n* [[301]] – [[San Marino]], the world\'s oldest republic still in existence, is founded.'), []);
  assert.deepEqual(parseEntries('== Events ==\n* [[681]] – [[Twelfth Council of Toledo]]: King Erwig initiates a council in Spain.'), []);
  const [medieval] = parseEntries('== Events ==\n* [[1492]] – [[Christopher Columbus]] sets foot on an island in the [[Bahamas]].');
  assert.equal(medieval.year, 1492, 'the floor is antiquity, not the modern era: the scoring handles the rest');
});

test('a country, or an organisation too large to mean anything, is not evidence of interest', () => {
  const [osborne] = parseEntries('== Events ==\n* [[1981]] – The [[Osborne 1]], the first portable computer, is unveiled in [[San Francisco]].');
  assert.deepEqual(measurableLinks(osborne), ['Osborne 1']);
  // NASA is read a million times a year whether or not it opened a warehouse.
  const [facility] = parseEntries('== Events ==\n* [[1994]] – [[NASA]]\'s [[Space Station Processing Facility]], a new manufacturing building, is opened.');
  assert.deepEqual(measurableLinks(facility), ['Space Station Processing Facility']);
  // But an entry whose every link is a household name still gets a score.
  const [founding] = parseEntries('== Events ==\n* [[1975]] – [[Microsoft]] is founded in the [[United States]].');
  assert.deepEqual(measurableLinks(founding), ['Microsoft', 'United States']);
});

test('a household name cannot lend its readership to a dull entry', () => {
  const [facility] = parseEntries('== Events ==\n* [[1994]] – [[NASA]]\'s [[Space Station Processing Facility]], a new manufacturing building, is opened.');
  const [landing] = parseEntries('== Events ==\n* [[1997]] – [[NASA]]\'s [[Mars Pathfinder]] lands on the surface of [[Mars]].');
  const views = new Map([['NASA', 3_000_000], ['Space Station Processing Facility', 3_000], ['Mars Pathfinder', 400_000]]);
  assert.ok(scoreEntry(landing, views).score > scoreEntry(facility, views).score);
});

test('the modern, well-read entry outranks the merely old one', () => {
  const calendar = CALENDAR.replace('* [[681]] – [[Twelfth Council of Toledo]]: King Erwig of the Visigoths initiates a council in Spain.',
    '* [[1568]] – The [[Twelfth Council of Toledo]] meets in Spain.');
  const views = new Map([['Microsoft', 900_000], ['YouTube', 2_000_000], ['Me at the zoo', 270_000], ['Twelfth Council of Toledo', 1_909]]);
  const ranked = parseEntries(calendar).map(entry => scoreEntry(entry, views)).sort((a, b) => b.score - a.score);
  assert.equal(ranked.at(-1).subject, 'Twelfth Council of Toledo');
});

const DAY = [
  { year: 2005, text: 'The first YouTube video is published.', links: [{ title: 'YouTube' }], subject: 'YouTube' },
  { year: 2007, text: 'Apple Inc. releases its first mobile phone, the iPhone.', links: [{ title: 'IPhone' }], subject: 'IPhone' },
  { year: 1975, text: 'Microsoft is founded by Bill Gates and Paul Allen.', links: [{ title: 'Microsoft' }], subject: 'Microsoft' },
  { year: 1957, text: 'Sputnik 1 becomes the first artificial satellite to orbit the Earth.', links: [{ title: 'Sputnik 1' }], subject: 'Sputnik 1' },
  { year: 1977, text: 'Star Wars is released in US theaters.', links: [{ title: 'Star Wars' }], subject: 'Star Wars' },
  { year: 1969, text: 'The first message is sent over ARPANET between two computers.', links: [{ title: 'ARPANET' }], subject: 'ARPANET' },
  { year: 1996, text: 'Dolly the sheep becomes the first mammal cloned from an adult cell.', links: [{ title: 'Dolly (sheep)' }], subject: 'Dolly (sheep)' },
];

test('a day is five facts, never the same subject twice', () => {
  const picked = chooseFacts(DAY);
  assert.equal(picked.length, FACTS_PER_DAY);
  assert.equal(new Set(picked.map(fact => fact.subject)).size, FACTS_PER_DAY);
});

test('different kinds are preferred, but five slots cannot insist on it', () => {
  // The first pass takes one of each kind it can reach, so a day with the
  // choice never opens with five of the same.
  const varied = chooseFacts(DAY);
  assert.ok(new Set(varied.map(fact => fact.category.id)).size >= 4, 'a day of nothing but tech reads as a themed page');
  // Only 136 of the 366 calendar dates offer five distinct categories at all,
  // so on the rest the second pass fills the remaining slots on score and two
  // facts share a kind. That is allowed; running short of facts is not.
  const oneKind = [
    { year: 1957, text: 'Sputnik 1 becomes the first artificial satellite to orbit the Earth.', links: [{ title: 'Sputnik 1' }], subject: 'Sputnik 1' },
    { year: 1969, text: 'Apollo 11 lands the first astronauts on the Moon.', links: [{ title: 'Apollo 11' }], subject: 'Apollo 11' },
    { year: 1990, text: 'The Hubble telescope is launched into orbit.', links: [{ title: 'Hubble Space Telescope' }], subject: 'Hubble Space Telescope' },
    { year: 1977, text: 'The Voyager 1 spacecraft is launched towards Jupiter and Saturn.', links: [{ title: 'Voyager 1' }], subject: 'Voyager 1' },
    { year: 1971, text: 'Mariner 9 becomes the first spacecraft to orbit another planet.', links: [{ title: 'Mariner 9' }], subject: 'Mariner 9' },
  ];
  const themed = chooseFacts(oneKind);
  assert.equal(themed.length, FACTS_PER_DAY, 'a thin date still fills the day');
  assert.equal(new Set(themed.map(fact => fact.category.id)).size, 1);
});

test('an editorial seed takes a slot before anything scored', () => {
  const entries = [
    { year: 1975, text: 'Microsoft is founded by Bill Gates and Paul Allen.', links: [{ title: 'Microsoft' }], subject: 'Microsoft' },
    { year: 1957, text: 'Sputnik 1 becomes the first artificial satellite to orbit the Earth.', links: [{ title: 'Sputnik 1' }], subject: 'Sputnik 1' },
  ];
  const seed = { year: 2016, subject: 'Killing of Harambe', category: { id: 'curious', name: 'Curious' }, text: 'A gorilla.' };
  const picked = chooseFacts(entries, { seeds: [seed], count: 3 });
  assert.equal(picked[0].subject, 'Killing of Harambe');
  assert.equal(picked.length, 3);
});

test('a sentence left hanging by a stripped template is never shown', () => {
  // Wikipedia's {{convert}} template disappears with the rest of them, and
  // what is left reads as a fragment.
  assert.equal(isFragment('The Japanese solar-sail spacecraft IKAROS passes the planet Venus at a distance of about.'), true);
  assert.equal(isFragment('The Humber Bridge opens to traffic, connecting Yorkshire and Lincolnshire.'), false);
  const entries = parseEntries('== Events ==\n* [[2010]] – The [[solar-sail]] spacecraft [[IKAROS]] passes [[Venus]] at a distance of about.');
  assert.deepEqual(entries, []);
});

test('a middle initial and a sentence ending in a preposition are not fragments', () => {
  assert.equal(isFragment('Thomas A. Edison finishes construction of the first motion picture studio.'), false);
  assert.equal(isFragment("Haiti's first democratically elected president is sworn in."), false);
  assert.equal(isFragment('Mary Shelley publishes Frankenstein; or, The Modern Prometheus.'), false);
  assert.equal(isFragment('President Roosevelt meets King Ibn Saud aboard the, officially beginning relations.'), true);
});

test('a routine shuttle flight loses to anything else the day offers', () => {
  const [routine] = parseEntries('== Events ==\n* [[1995]] – [[Space Shuttle Discovery]] is launched on [[STS-70]] to deploy the [[TDRS-7]] satellite.');
  const [coaster] = parseEntries('== Events ==\n* [[1951]] – [[Vuoristorata]], one of the oldest still-operating wooden roller coasters in Europe, is opened at [[Linnanmäki]].');
  const views = new Map([['Space Shuttle Discovery', 300_000], ['Vuoristorata', 2_000], ['Linnanmäki', 20_000]]);
  assert.ok(scoreEntry(coaster, views).score > scoreEntry(routine, views).score);
});

test('a measurement stripped out of the middle of a sentence is caught too', () => {
  assert.equal(isFragment("The Gotthard Road Tunnel opens as the world's longest highway tunnel at stretching from Göschenen to Airolo."), true);
  assert.equal(isFragment('The Humber Bridge opens to traffic, connecting Yorkshire and Lincolnshire.'), false);
  assert.equal(isFragment('Roger Bannister becomes the first person to run the mile in under four minutes.'), false);
});

test('a reserve entry is a last resort, never a way to win on variety', () => {
  const measured = [
    { year: 2005, text: 'The first YouTube video is published.', links: [{ title: 'YouTube' }], subject: 'YouTube' },
    { year: 1975, text: 'Microsoft is founded by Bill Gates and Paul Allen.', links: [{ title: 'Altair 8800' }], subject: 'Altair 8800' },
  ];
  const reserve = [{ year: 1822, text: 'A memoir on birefringence is read to the Academy of Sciences.', links: [{ title: 'Birefringence' }], subject: 'Birefringence' }];
  const picked = chooseFacts(measured, { reserve, count: 3 });
  assert.deepEqual(picked.map(fact => fact.subject), ['YouTube', 'Altair 8800', 'Birefringence']);
  // With three places and only two measured entries the reserve fills the
  // last one — but it never displaces a measured entry.
  assert.equal(chooseFacts(measured, { reserve, count: 2 }).some(fact => fact.subject === 'Birefringence'), false);
});
