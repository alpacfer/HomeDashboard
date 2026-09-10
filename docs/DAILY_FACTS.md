# Daily facts

The display reads one small JSON file for the current Copenhagen date from
`public/facts/daily/MM-DD.json`. Every file holds exactly five facts. Nothing
is fetched from a fact provider at runtime, so a bad upstream response can
never change what is on the wall.

## What counts as a fact worth showing

The panel answers "what happened on this day", and the answer has to survive
being read from across a room by someone who did not choose to look. That
rules out most of what a calendar page contains:

- **Modern, not ancient.** A twelfth-century church council is a fact, not an
  anniversary. 92% of the calendar is from 1900 or later and most of it is
  post-war; `tests/daily-facts.test.mjs` fails under 85%, which is the floor
  rather than the target. Two mechanisms, at different strengths: `recencyScore`
  ranks an old entry down, which is what keeps that council off a day with
  anything better, and anything before `MODERN_ERA` — year 1000 — is dropped
  outright by `parseEntries`. The drop exists because ranking alone was not
  enough: the variety pass can promote a low score over a better one of a kind
  the day already has, and 3 September — which offers two good sport entries
  and little else — put San Marino's founding in 301 on the wall that way.
- **Recent as well as historic.** The last five years are admitted rather than
  banned, so the calendar does not read as a museum that closed in 2020. They
  rank *below* the 1975–2000 sweet spot on purpose, and `chooseFacts` holds one
  of the day's five slots for a recent entry that clears `RECENT_FLOOR` —
  otherwise they would simply never win, and a thin date would seat a routine
  announcement just for being new. The window is `RECENT_YEARS` counted from
  the year the generator runs, not a hardcoded era, and the current year is
  never shown: an anniversary needs the year to have turned.
- **Never political, and never political at all inside that window.**
  Elections, treaties, resignations and protests are ranked down everywhere by
  `DULL`. Inside the recent window they are dropped outright by `POLITICAL`,
  because an election from last year is an argument someone in the room is
  still having. That list is deliberately high-precision: the words that are
  usually political and sometimes not — bill, king, queen, court, vote, border
  — are left to `DULL`, because "Bill Gates", "Queen", "Stephen King" and a
  tennis court are exactly what the panel exists for.
- **Curious, not consequential.** The first YouTube video, the Osborne 1, the
  moth taped into the Harvard Mark II logbook, the day Microsoft was founded.
- **Never grim.** Crashes, massacres, bombings, disasters and casualty counts
  are removed from the pool outright rather than ranked low, so a thin date can
  never promote one. Opening the recent window brought the 2020s with it and
  the list grew to match: a pandemic, a capital falling, a prison break and a
  launch failure are grim wherever they sit in the calendar, so they are in
  `GRIM` and not in `POLITICAL`. The prison rule names prisoners and inmates
  rather than the building, because the first draft said `prison` and threw
  away Nelson Mandela walking out of Victor Verster. See
  [scripts/lib/fact-selection.mjs](../scripts/lib/fact-selection.mjs).

Each fact carries a category — tech, space, curious, culture, science, sport
or world — which names why it is worth reading and picks the accent colour.
Different kinds are preferred but not insisted on: only 81 of the 366 calendar
dates offer five distinct categories at all, so `chooseFacts` takes one of each
kind it can reach and then fills the remaining slots on score. A day of nothing
but space launches reads as a themed page, which is what the first pass exists
to avoid; two facts sharing a kind is fine.

Five slots cost something worth knowing about: the last two are filled from
further down the ranking, so they fall into the `world` catch-all far more
often. The share by slot runs 2, 9, 30, 40 and 46 per cent, and `world` is 26%
of the calendar as a whole. The fourth and fifth facts of a day are simply the
fourth and fifth most interesting things that happened on it. If that ever
wants fixing, the lever is better terms in `CATEGORIES` — or another category —
not a looser threshold in
[tests/daily-facts.test.mjs](../tests/daily-facts.test.mjs).

**Every figure in this document comes from `npm run facts:stats`**
([scripts/facts-stats.mjs](../scripts/facts-stats.mjs)), which reads the
generated files and prints the shares, the category counts, the distinct-kinds
spread and the clip shapes. Run it after a regeneration and paste what it says
rather than editing a number by hand: each of these had drifted a full
regeneration out of date, in the one document nobody re-derives.

The count lives twice, because nothing can share it: `DAILY_FACT_COUNT` in
[lib/daily-facts.ts](../lib/daily-facts.ts) is what the browser validates
against, `FACTS_PER_DAY` in
[scripts/lib/fact-selection.mjs](../scripts/lib/fact-selection.mjs) is what the
generator writes, and `lib/` may not be imported by a plain-Node script.
[tests/daily-facts.test.mjs](../tests/daily-facts.test.mjs) asserts they are
equal, because a mismatch would make the validator reject every file the
generator produces and leave the panel permanently unavailable.

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
5. picks five, preferring five different categories;
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
a date cannot produce five illustrated facts it throws, naming the date. The
thinnest dates in the calendar are 6 March and 28 February, which offer eight
and nine candidates for five slots, so a refresh that loses a picture upstream
is most likely to fail there.

## What is stored here, and what is not

| | Where | Size |
| --- | --- | --- |
| The facts | `public/facts/daily/*.json`, committed | 2.9 MB |
| The pictures | Wikimedia's CDN, fetched by the browser | ~400 MB if they were local |
| The clips | Wikimedia's CDN, fetched by the browser | ~10 MB if they were local |

**No media is committed, and that is deliberate.** The temptation is to keep
the sixteen clips locally because ten megabytes is nothing next to four hundred,
and that was tried. It is the wrong call for four reasons:

- It mitigates one risk for sixteen files and leaves the identical risk on
  1,830. A renamed Commons file breaks a picture exactly as it breaks a clip.
- Binaries in git are forever, and content-addressed names accumulate: nothing
  prunes a clip a later refresh stopped using, so the repository grows on every
  refresh and never shrinks. That is the opposite of scalable.
- Render clones the repository on every deploy, on the free plan.
- **The free service sleeps after fifteen minutes idle.** A clip served from
  here would pay a cold start of tens of seconds; `upload.wikimedia.org` never
  sleeps, does range requests properly, and is cached at the edge. It is
  strictly better at serving media than this service is.

So everything the browser draws comes from Wikimedia, and one rule covers it:
one origin, one failure mode, one attribution story. A picture or clip that
will not load already degrades to a caption rather than a broken panel.

The width the display asks for is `iiurlwidth` in
[scripts/generate-daily-facts.mjs](../scripts/generate-daily-facts.mjs), and it
is **480, which is not the width you get**. Wikimedia snaps a thumbnail request
to its own buckets, and the buckets are far apart:

| asked | served | bytes |
| --- | --- | --- |
| 480 | 500px | 23 KB |
| 540 | 960px | 59 KB |
| 1000 | 1280px | 93 KB |

Asking for 540 rather than 480 costs two and a half times the bytes for a
picture the panel paints 270px wide. 500px is still nearly twice what the only
screen this runs on can show, so it is sharp; 1280 was five times, and the
stick was decoding twenty-five times the pixels it needed. Check what came back
rather than what was asked for if this is ever tuned again.

## The local cache

A refresh asks Wikimedia for about seventeen thousand things and almost none of
them change between runs. Every answer is kept in `.cache/daily-facts`
(gitignored), so a second run needs no network and finishes in seconds instead
of eighteen minutes. That matters more than it sounds: before it existed,
adding one field to the sixteen facts that carry a clip cost a full re-read of
366 calendar pages, 5,884 articles and 4,814 file descriptions.

The cache is used by default and **`npm run facts:generate -- --refresh`
ignores it**, which is the way round that makes the cheap thing easy and the
expensive thing deliberate. A cached run reproduces the calendar exactly; only
`--refresh` can discover that Wikipedia has changed, so a real editorial
refresh wants it. Every run prints how old the cache is and how many answers
came from it, so a stale one is never merely invisible.

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

### Memes

Memes are seeds and can only be seeds, for two reasons. Wikipedia's calendar
pages almost never carry them — "Gangnam Style is released" is not an Event —
so the automatic pass cannot find them. And the picture everybody recognises is
almost always non-free: of 736 articles in Commons' meme and viral-video
categories, **24 have a freely licensed lead picture**, and that two dozen is
mostly not memes. Wikipedia holds the recognisable images locally under fair
use, which is a claim this display cannot make.

So each meme seed names, through `imageFile`, a freely licensed picture of the
meme's *subject* — Rick Astley on stage, Grumpy Cat's underbite, the Grogu
plush that flew as SpaceX Crew-2's zero-gravity indicator — rather than the
meme image itself. A meme also needs a day Wikipedia states outright. Doge is
not in the calendar for that reason: the article dates Kabosu's photograph to
"a 2010 blog post" and no further, and a wall is the wrong place to guess.

Generation is discovery, not the final editorial decision. Review the changed
JSON before committing a refresh, and look at the date on the running display
rather than only in the file:

```text
http://localhost:3000/?scene=fact&fact=0&date=05-28&weather=off
```

`npm run shot -- --scene fact --fact 0 --date 05-28 --offline` captures the
same thing.

## One-day editions

An exact-date edition can temporarily replace all five facts without changing
the recurring `MM-DD` calendar. Put the reviewed payload in
`public/facts/overrides/`, named for its exact date, and list that date in
`public/facts/overrides/index.json`. The index avoids asking the origin for a
file that does not exist on every ordinary day. On the named Copenhagen date,
the browser tries the edition first and falls back to the ordinary daily file
if the edition is missing, slow or invalid.

An edition may set `kicker` to replace “On this day”, and a fact may add an
`animation` object for a Wikimedia GIF. Every animated fact still requires its
ordinary `image`, which is shown for reduced motion and after a load failure.
Only the active fact receives moving media, and video teardown keeps the same
decoder-release rules described below.

Review an edition without changing the wall clock by using the full date:

```text
http://localhost:3000/?scene=fact&fact=0&date=2026-09-11&weather=off
```

The short `?date=09-11` form intentionally keeps showing the recurring file.

## Attribution

Wikipedia text is used under CC BY-SA 4.0. Each picture keeps its own
Wikimedia Commons credit and licence. The display links both, under the
picture and in the footer of the panel.

Both are furniture: one line each, around 8px, dimmer than `--muted`, and
`scripts/audit-ui.mjs` exempts them from the legibility and contrast floors
because nobody reads them from the sofa and the display would not be wrong
without them. Two things keep them that small. The panel's footer credits
"Wikipedia" and the licence rather than spelling out the article title, which
is the headline two lines above it and was the loudest thing in the lower half
of the panel; the link still resolves to the article and the full source name
stays in the accessible label. And `tidyCredit` in
[scripts/lib/fact-selection.mjs](../scripts/lib/fact-selection.mjs) cuts the
picture credit down to a name. Commons' Attribution and Artist fields are free
text, and about a tenth of them are not a name at all but a paragraph of
provenance, a bare URL, or a note asking to be told when the file is reused.
Untouched they ran to 160 characters; the ninetieth percentile is now 31. What
cannot be read as a name falls back to "Wikimedia Commons", which is truthful
because the credit links to the file page that carries the full field.

## Video

About one date in twenty-three shows a clip instead of a photograph. The rest keep
the picture they always had, and that is the intended ratio: a video is not an
upgrade on a photograph.

**What earns one.** `videoEarnsItsPlace` in
[scripts/lib/fact-selection.mjs](../scripts/lib/fact-selection.mjs) decides, and
is tested. Three things have to be true at once:

1. **Something moved.** A launch, a flight, a dance, an eruption, a first
   performance. "Muhammad Ali wins gold" is a portrait; so is "the Osborne 1 is
   unveiled". Most facts are portraits.
2. **Fifteen seconds of it is representative.** The scene is `FACT_MS` and the
   panel plays the opening and nothing else, so a two-hour documentary shows a
   title card and a three-second animation shows a stutter. `VIDEO_MIN_SECONDS`
   to `VIDEO_MAX_SECONDS`.
3. **The file is of the subject**, not merely on its article — articles carry
   incidental clips, an unrelated interview, a stock shot of the city. The
   match is on a shared distinctive word and is deliberately conservative: NASA
   names files "Ap14", which cannot be tied to "Apollo 14" without matching on
   the number alone, and matching on a number pulls in whatever shares it. That
   date shows its photograph, which is the cheap way to be wrong.

`VIDEOS_PER_DAY` caps it at one, so a date is a page with a moving picture on
it rather than a playlist, and the stick decodes at most one clip per scene.
Of two clips that qualify, the shorter wins: the panel's fifteen seconds covers
more of it.

**What is fetched.** Never the source file, which runs 8 to 100 MB. Wikimedia
transcodes everything, and the generator stores the `240p.vp9.webm` derivative
— about 0.3 Mbps, so 0.4 to 0.6 MB for the fifteen seconds that play — with the
`360p.mpeg4.mov` H.264 derivative behind it as a second `<source>`, because
whether Silk decodes VP9 is **not established**. The Fire TV's hardware does it
for YouTube, but that is not the same code path. Everything comes from
`upload.wikimedia.org`, which sends `Accept-Ranges: bytes` and
`Access-Control-Allow-Origin: *` — the same CDN and the same posture as the
pictures, so this costs Render nothing and needs no route handler.

**What shape it is.** A photograph is cropped to 4:3 and always has been:
cropping a still loses framing, which it can afford. A clip cannot — cropping a
film loses the shot. The calendar's widest is a Mars horizon panorama at
1.99:1, and forcing that into 4:3 threw away a third of the frame, horizon
included. So the generator stores the transcode's own `width` and `height`, the
panel sets them on the figure as `--media-ar`, and the clip is drawn whole.

The row is a two-column grid, so the column widths change with it.
`mediaShape` in [lib/daily-facts.ts](../lib/daily-facts.ts) sorts a clip into
three bands and is tested:

| Shape | Ratio | Columns (copy / picture) | What it is |
| --- | --- | --- | --- |
| `tall` | under 0.95 | 2 / 0.72 | Taller than it is wide. The words take the space; the clip is capped at 52vh so it cannot push the credit off the panel. |
| `boxy` | 0.95 to 1.5 | 1.5 / 1 | Academy 4:3 up to 3:2. The layout the panel was built around, and what a still always gets. |
| `wide` | 1.5 and over | 1 / 1.32 | 16:9 and wider. Earns more of the row instead of losing its edges. |

Of the sixteen clips in the calendar today, eleven are `boxy` and five are `wide`.
**None is `tall`** — Wikimedia's archive footage is film and television, and
neither was shot in portrait. The `tall` layout is built and tested but has no
live example, so a refresh that finds one is the first time it will be seen on
the wall.

Only a clip that is *playing* reshapes the row. Reduced motion and a refused
decoder both fall back to the 4:3 still, and the columns fall back with them,
which is why `playing` is decided in `RotatingPanel` rather than inside
`FactArtwork`.

**How it is played.** `FactVideo` in
[components/rotating-panel.tsx](../components/rotating-panel.tsx) is the only
thing on the display holding a decoder, and the wall is never reloaded, so:

- it is mounted only while its own fact is on screen, and on the way out it is
  paused, its `src` and every `<source>` src removed, and `load()` called.
  Dropping the element alone leaves the decoder holding its buffers, which is
  the overnight leak [DEPLOYMENT.md](DEPLOYMENT.md) exists to prevent;
- `muted` is what makes autoplay legal without a gesture, and there is no
  speaker on this wall regardless. `loop`, `playsInline`, `preload="metadata"`;
- any failure — a refused autoplay, a codec Silk will not take, a network
  fault — falls back to the still for the rest of the scene and does not retry.
  A clip this device cannot decode would otherwise retry every time its date
  came round, for weeks;
- `prefers-reduced-motion` gets the poster and nothing else, which is the path
  `npm run shot -- --reduced-motion` captures.

**Still unverified, and only the device can answer it:** whether Silk plays
either derivative at all. Read the user agent on the Fire TV, watch one clip,
and record the result in [DEPLOYMENT.md](DEPLOYMENT.md). Until then the
fallback chain is a hypothesis, not a tested path — the display degrades to the
photograph if it is wrong, which is why it was safe to ship.

Source documentation:

- https://www.mediawiki.org/wiki/API:Query
- https://www.mediawiki.org/wiki/API:Imageinfo/en
- https://www.mediawiki.org/wiki/API:Licensing
- https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/
