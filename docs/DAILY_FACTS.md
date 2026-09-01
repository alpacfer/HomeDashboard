# Daily country facts

The display reads one small JSON file for the current Copenhagen date from
`public/facts/daily/MM-DD.json`. Every file contains exactly three entries, in
this order: Spain, Denmark and Greece. This keeps the screen fast and means a
bad upstream response can never change the display unexpectedly.

## How the calendar is built

Run `npm run facts:generate` to rebuild all 366 date files. The generator:

1. applies the reviewed entries in `data/daily-fact-overrides.json`;
2. reads the Events and Births sections from all English Wikipedia
   calendar pages;
3. finds entries that explicitly mention Spain/Spanish, Denmark/Danish or
   Greece/Greek (including a small set of regional terms);
4. strongly prefers older events such as discoveries, battles, revolts,
   foundations and firsts, while penalising modern or weakly related entries;
5. resolves the best linked article and uses its Wikimedia Commons image when
   available, with the country's flag as the image fallback;
6. reads the Commons creator and license metadata; and
7. writes the selected fact, article source, calendar source, image source,
   creator and license into the date file.

If the strongest anniversary has no article picture, the historical fact stays
and the country's public-domain flag is used. Only a date with no matching
historical entry at all receives the NOAA daylight fallback, keeping all 366
days complete without inventing history.

The generator exits with an error if any country is missing on any date. The
test suite independently checks all 1,098 facts, the fixed country order,
source URLs, image attribution and short copy length.

## Editorial review

Generation is the discovery step, not the final editorial decision. Review the
changed JSON files before committing a refresh. Prefer a positive event or a
notable birth, keep the sentence easy to read, and replace any
entry that is ambiguous, overly political or poorly illustrated. Manual edits
remain stable until the next deliberate regeneration.

Wikipedia text is attributed under CC BY-SA 4.0. Each image keeps its own
Wikimedia Commons credit and license. The display links both attributions.

Source documentation:

- https://www.mediawiki.org/wiki/Wikifeeds
- https://www.mediawiki.org/wiki/API:Imageinfo/en
- https://www.mediawiki.org/wiki/API:Licensing
