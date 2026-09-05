# Daily facts

The display reads one small JSON file for the current Copenhagen date from
`public/facts/daily/MM-DD.json`. Every file holds exactly three facts. Nothing
is fetched from a fact provider at runtime, so a bad upstream response can
never change what is on the wall.

## What counts as a fact worth showing

The panel answers "what happened on this day", and the answer has to survive
being read from across a room by someone who did not choose to look. That
rules out most of what a calendar page contains:

- **Modern, not ancient.** A twelfth-century church council is a fact, not an
  anniversary. Over ninety per cent of the calendar is from 1900 or later and
  most of it is post-war; `tests/daily-facts.test.mjs` fails if that slips.
- **Recent, but not news.** Anything inside the last few years is pushed away:
  an anniversary needs distance.
- **Curious, not consequential.** The first YouTube video, the Osborne 1, the
  moth taped into the Harvard Mark II logbook, the day Microsoft was founded.
- **Never grim.** Crashes, massacres, bombings, disasters and casualty counts
  are removed from the pool outright rather than ranked low, so a thin date can
  never promote one. See `GRIM` in
  [scripts/lib/fact-selection.mjs](../scripts/lib/fact-selection.mjs).

Each fact carries a category — tech, space, curious, culture, science, sport
or world — which names why it is worth reading and picks the accent colour.
A day never shows three of the same kind.

## How the calendar is built

Run `npm run facts:generate` to rebuild all 366 date files. It takes about
twenty minutes, almost all of it waiting on pageviews. The generator:

1. places the reviewed entries from `data/daily-fact-overrides.json` first;
2. reads the Events section of all 366 English Wikipedia calendar pages;
3. drops every grim entry, then scores the rest on recency, subject, phrasing
   and headline length;
4. asks the Wikimedia pageviews API how many people read each shortlisted
   article over the last year, which is the one signal here that is not a
   guess about taste — it is what separates the Osborne 1 (49,000 reads) from
   the Shivwits federal trust relationship (794);
5. picks three, preferring three different categories;
6. resolves each subject's Wikipedia article, its Wikimedia Commons lead
   picture, and that picture's creator and licence; and
7. writes the fact, its sources and its attribution into the date file.

The selection logic is pure and lives in
[scripts/lib/fact-selection.mjs](../scripts/lib/fact-selection.mjs), separate
from the network plumbing in
[scripts/generate-daily-facts.mjs](../scripts/generate-daily-facts.mjs), so
[tests/fact-selection.test.mjs](../tests/fact-selection.test.mjs) can hold the
judgement calls still: the entries that must never be shown, and the ones the
panel exists for.

The generator fails loudly rather than filling a gap with something weaker. If
a date cannot produce three illustrated facts it throws, naming the date.

## Editorial overrides

`data/daily-fact-overrides.json` is the editorial hand on the wheel. An entry
there takes a slot on its date before anything scored, and the generator fills
the remaining slots automatically.

An override is a seed, not a finished record: it names the article and the
words, and the generator resolves the picture, the licence and the source
links. That is why it does not have to be re-checked when a Commons file
changes.

```json
{
  "date": "05-28",
  "year": 2016,
  "category": "curious",
  "article": "Killing of Harambe",
  "title": "Harambe",
  "body": "A gorilla at Cincinnati Zoo…",
  "alt": "Harambe, a western lowland gorilla, at Cincinnati Zoo."
}
```

`date`, `year`, `category`, `article`, `title` and `body` are required. `alt`
replaces the generated image description, `imageArticle` takes the picture from
a different article than the one the source links to, and `imageFile` names a
Wikimedia Commons file outright — some pictures are the obvious illustration
for a fact and yet are nobody's lead image, like the page of the Harvard Mark
II logbook with the moth taped into it. Use an override when the
automatic pass cannot reach a fact — the grim filter removes the fall of the
Berlin Wall along with the war it ended — or when the article title makes a
poor headline, as "Apple Inc." does for the day the iPhone went on sale.

Generation is discovery, not the final editorial decision. Review the changed
JSON before committing a refresh, and look at the date on the running display
rather than only in the file:

```text
http://localhost:3000/?scene=fact&fact=0&date=05-28&weather=off
```

`npm run shot -- --scene fact --fact 0 --date 05-28 --offline` captures the
same thing.

## Attribution

Wikipedia text is used under CC BY-SA 4.0. Each picture keeps its own
Wikimedia Commons credit and licence. The display links both, under the
picture and in the footer of the panel.

Source documentation:

- https://www.mediawiki.org/wiki/API:Query
- https://www.mediawiki.org/wiki/API:Imageinfo/en
- https://www.mediawiki.org/wiki/API:Licensing
- https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/
