import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  categorize, chooseFacts, isFragment, isGrim, measurableLinks, parseEntries, popularityScore, recencyScore, scoreEntry,
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

test('an anniversary needs distance: neither antiquity nor last year', () => {
  assert.ok(recencyScore(2005) > recencyScore(681));
  assert.ok(recencyScore(1981) > recencyScore(1937));
  assert.ok(recencyScore(2024) < recencyScore(1981), 'the last few years are still news');
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
  assert.deepEqual(entries.map(entry => entry.year), [681, 1975, 2005]);
  assert.equal(entries.some(entry => entry.text.includes('Hawija')), false);
  assert.equal(entries.some(entry => entry.text.includes('Sørensen')), false, 'births read as a list of names, not as history');
  assert.equal(entries[2].subject, 'YouTube');
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

test('the modern, well-read entry outranks the ancient council', () => {
  const entries = parseEntries(CALENDAR);
  const views = new Map([['Microsoft', 900_000], ['YouTube', 2_000_000], ['Me at the zoo', 270_000], ['Twelfth Council of Toledo', 1_909]]);
  const ranked = entries.map(entry => scoreEntry(entry, views)).sort((a, b) => b.score - a.score);
  assert.equal(ranked.at(-1).subject, 'Twelfth Council of Toledo');
});

test('three facts a day, of different kinds, with no subject twice', () => {
  const entries = [
    { year: 2005, text: 'The first YouTube video is published.', links: [{ title: 'YouTube' }], subject: 'YouTube' },
    { year: 2007, text: 'Apple Inc. releases its first mobile phone, the iPhone.', links: [{ title: 'IPhone' }], subject: 'IPhone' },
    { year: 1975, text: 'Microsoft is founded by Bill Gates and Paul Allen.', links: [{ title: 'Microsoft' }], subject: 'Microsoft' },
    { year: 1957, text: 'Sputnik 1 becomes the first artificial satellite to orbit the Earth.', links: [{ title: 'Sputnik 1' }], subject: 'Sputnik 1' },
    { year: 1977, text: 'Star Wars is released in US theaters.', links: [{ title: 'Star Wars' }], subject: 'Star Wars' },
  ];
  const picked = chooseFacts(entries);
  assert.equal(picked.length, 3);
  assert.equal(new Set(picked.map(fact => fact.category.id)).size, 3, 'a day of nothing but tech reads as a themed page');
  assert.equal(new Set(picked.map(fact => fact.subject)).size, 3);
});

test('an editorial seed takes a slot before anything scored', () => {
  const entries = [
    { year: 1975, text: 'Microsoft is founded by Bill Gates and Paul Allen.', links: [{ title: 'Microsoft' }], subject: 'Microsoft' },
    { year: 1957, text: 'Sputnik 1 becomes the first artificial satellite to orbit the Earth.', links: [{ title: 'Sputnik 1' }], subject: 'Sputnik 1' },
  ];
  const seed = { year: 2016, subject: 'Killing of Harambe', category: { id: 'curious', name: 'Curious' }, text: 'A gorilla.' };
  const picked = chooseFacts(entries, { seeds: [seed] });
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
