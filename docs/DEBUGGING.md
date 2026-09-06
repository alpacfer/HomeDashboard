# Debugging the display

How to see what the display sees, reproduce a state without waiting for it,
and find out why a panel is muted or blank. Everything here is plain Node
(`scripts/`) or a URL parameter, so it works the same on Ubuntu, macOS, the
GitHub runners, and against the deployed site.

```text
npm run shot -- [options]     screenshot the running dashboard, headless Chrome, 1280 x 720
npm run motion -- [options]   measure whether an animation is smooth or flickering
npm run probe                 ask every forecast provider as the browser would
npm run probe:transit         ask every departure provider as the route would
npm run audit                 check every scene at 1280 x 720 for layout faults
npm run scene -- [options]    measure a painted card: its edges, its landmarks, its light
npm run states -- [options]   every clock sky on one sheet; --seams, --baseline
npm run roll -- [options]     the digit transition, caught on the minute boundary
npm run horizon -- [options]  trace the painted sky and the shed window off the plates
npm run check:rules           the AGENTS.md rules a script can check
/?scene=map                   pin the rotating panel (README)
/?weather=off                 no weather request; placeholder card, ribbon and week
/?weather=demo                as off, and the map draws a synthetic run too
/?weather=none                no request and no placeholder: the empty card
/?time=08:46                  pin the clock to a Copenhagen time
/?weather=off&source=met      credit a named provider on the placeholder card
/?pet=map                     hold the Tenant at a measured UI landmark
/?pet=travel-map              replay its safe-spot journey to that landmark
```

## URL flags

Every flag defaults to normal behaviour when absent or misspelt, so a bad URL
can never leave the wall display stuck. They combine:
`/?scene=map&weather=demo&time=08:46&pet=map`.

| Flag | Effect | Parsed in |
| --- | --- | --- |
| `?transit=demo` | Draws the departure boards from a synthetic answer holding a cancellation, a long delay, an early departure, a platform change and two service messages. No provider is asked. It is the only way to check how a delay or an incident is marked on purpose. | `lib/transit-demo.ts` |
| `?scene=transport`, `?scene=fact&fact=N`, `?scene=map` | Holds one scene on the right-hand panel and schedules nothing. A `Pinned` badge replaces the rotation ring. Pinning also overrides the skip below, which is the only way to see the map on a dry forecast. | `lib/panel-rotation.ts` |
| `?weather=off` | The weather card, the week strip and the forecast map make **no request**. The card, the ribbon and the week strip are filled from `lib/weather-demo.ts` instead, so a capture of something else still shows the dashboard in context rather than a hole in it. Built from the pinned clock, so it lines up with `?time=`. The clock, the transit strip and the daily facts work as normal. | `lib/debug-flags.ts` |
| `?weather=dry` | As `demo`, but the synthetic run holds no precipitation at all. That is the state the rotation skips the forecast map for, so with `?scene=map` it is the only way to photograph the scene being skipped, and the only way to audit its caption. A live forecast will not produce a dry six hours to order any more than it will produce rain. `--dry` on the shot and audit tools. | `lib/debug-flags.ts`, `lib/precipitation-demo.ts` |
| `?weather=none` | No request and no placeholder: the card shows its genuinely unavailable state, with the offline dot. That is a state the display has to get right when every provider is down, so it stays reachable. `--no-weather` on any of the three tools. | `lib/debug-flags.ts` |
| `?weather=demo` | As `off` for the card, and the forecast map draws the synthetic run in `lib/precipitation-demo.ts` as well: a band crossing the frame, hour by hour with the quarters inside an hour identical, exactly the shape the real provider returns. It is the only way to photograph the map's animation without buying a grid, and it is deterministic, so two captures of the same change are comparable. | `lib/debug-flags.ts` |
| `?time=HH:MM` | The clock reads that Copenhagen time; seconds still tick, so the minute still rolls. Everything that reads the clock follows: the Tenant's mood and the ribbon's window. For checking the digits that stress the face, since one that clips on a 4 looks fine at 21:21. | `lib/debug-flags.ts` |
| `?source=google`, `dmi`, `open-meteo`, `met` | Credits that provider under the ribbon while the weather is a placeholder, so each source monogram can be photographed without asking anyone for a forecast. **Ignored when the weather is live**, where the mark names whoever actually answered. Combine with `weather=off`: `/?weather=off&source=met`. | `lib/debug-flags.ts` |
| `?pet=weather`, `week`, `transport`, `fact`, `map` | Holds the Tenant at that measured UI landmark. This checks its destination poses without waiting for curiosity to select an adventure; normal travel is unchanged when the flag is absent. | `lib/debug-flags.ts` |
| `?pet=travel-weather`, `travel-week`, `travel-transport`, `travel-fact`, `travel-map` | Sends the Tenant from home to that landmark through its real measured landing pads, then holds it there. Use a screenshot sequence to inspect charge, parabola and chained landings without waiting for curiosity. | `lib/debug-flags.ts` |
| `?pet-motion=hop`, `balance`, `peek` | Plays the pet's actual gravity/spring motion after a short setup. Hop jumps at home; balance and peek use a measured round digit. Reload to replay. Takes precedence over pet landmark flags. Pass the URL with `--url` to the screenshot and motion tools. | `lib/debug-flags.ts` |
| `?sky=night,snow,heavy` | Pins any of the scenery's light phase, weather and rate, in any order. The sky is normally derived from the sun's true elevation and the hour the weather card shows, so pinning it is the only way to photograph a state the weather is not currently offering. `--sky` on the browser tools, and repeatable on `npm run states` and `npm run scene`. | `lib/clock-sky.ts` |
| `?clock=workshop`, `plain` | Picks the clock widget's theme. `workshop` is the default painted shed; `plain` is the card as it was before themes existed. An unknown value falls back to the default, so a mistyped URL cannot leave the display in a state nobody chose. | `lib/clock-theme.ts` |
| `?date=MM-DD` | Loads that calendar day's facts instead of today's, so a specific entry can be checked without waiting for its date. `--date` on the browser tools. | `lib/daily-facts.ts` |

Use `weather=off` for any capture that is not about the weather, and
`weather=demo` for one that is about the forecast map. The reason is quota,
explained below.

## Where the paint stops: `npm run horizon`

Two of the card's shapes are properties of the artwork rather than decisions
anyone gets to make: the outline of the sky in the woodland painting, and the
four panes of glass in the shed window. Live layers are drawn over both — the
sun and the moon, the high thin cloud and the cloud bank outside; a drifting
sky behind the glass inside — and without those shapes the sun crosses the
tree canopy, the clouds sit on top of the far ridge, and the weather rubs out
the painted mullions.

So they are measured, not typed in. The tool decodes all four plates of each
scene and segments each one, then combines them by taking the median. What
comes out is a per-pixel **alpha**, not an outline: a hand-painted leaf edge is
soft, and a shape that can only say in or out renders a lacy canopy as a
staircase and cannot hold a gap of sky between two leaves at all. It writes
[app/horizon.css](../app/horizon.css), which is **generated — do not edit
it**, and two overlays to judge the result by:

```sh
npm run horizon                    # trace, write app/horizon.css, draw both overlays
npm run horizon -- --no-write      # report and draw, change nothing
npm run horizon -- --plate day     # one plate, when a trace looks wrong
```

**Look at the overlays.** `screenshots/horizon.png` is the clearing with
everything the mask removes dimmed and the sun's arc drawn across it;
`screenshots/horizon-window.png` is the shed window blown up, the same way. A
mask cannot be judged from its numbers; a picture of it over the painting can.
The dimming is drawn from the mask's own alpha, so a soft leaf edge shows as a
soft edge rather than as a line.

Three things the report says that are worth reading:

- **Edges.** How much of the picture came out neither sky nor not-sky — about
  0.9%, the width of every painted leaf edge in the canopy. This is the whole
  reason the answer is an alpha and not a polygon.
- **Agree.** How much of the picture the four plates read differently, and then
  how much of *that* is away from any edge. The first number is around 1.4% and
  is expected: four separately painted plates land their leaf edges a pixel
  apart, so along every edge one says sky where another says leaf. Only the
  second is gated, because a plate that had genuinely moved would disagree in
  the middle of open sky or the middle of a tree. Under 0.05% means the plates
  are in register.
- **LEAKED.** A window fill that reached the edge of its box crossed the frame
  and is describing the wall. The night plate does this — its frame, its glass
  and its sill are within a few levels of each other — so it is left out of the
  vote and the other three carry the trace. The geometry is the same in all
  four, so nothing is lost; the line is there so that a plate silently
  describing the wrong thing is never mistaken for agreement.

The segmentation itself is in [scripts/lib/segment.mjs](../scripts/lib/segment.mjs),
which explains itself at length. It does not run in Node — it is handed to the
headless Chrome as source text, because the only WebP decoder in this toolchain
is the browser's. It was developed against scikit-image and agrees with it to
99.98% of pixels; the reference is not a dependency and is not shipped.

Nothing here needs the dev server. The input is the artwork in
`public/scenes`, not a rendered page — but Node cannot decode WebP and this
repository will not add a dependency for it, so the plates are handed to a
headless Chrome as data URLs and read back through a canvas, the same trick
`npm run scene` uses.

## Two traps that cost hours

**The editor's browser pane is hidden, and a hidden page runs no animation
frames.** `document.visibilityState` is `hidden` there, so
`requestAnimationFrame` never fires. Nothing that animates will run, and the
forecast map will not even start: it measures its own view inside a
`requestAnimationFrame` callback, so it sits on "Loading forecast…" for ever
and looks broken when it is not. Screenshots through the pane are unsupported
for a different reason (the crop, and stale frames). Use `npm run shot` and
`npm run motion`, which drive headless Chrome, where the page really renders.

**Nothing the display is running changes because you pushed.** The Fire TV
shows the deployed Render build, it runs for weeks without a reload, and there
is no service worker, no version check and no `location.reload()` anywhere in
this app. A change is not on the screen until Render has deployed **and** the
page has been reloaded. If a change looks like it did nothing, check that
before you check the code: the browser is still running the JavaScript it
downloaded the day it was opened.

## Animation: `npm run motion`

A screenshot proves what one moment looks like. It cannot show whether an
animation is smooth, and that gap is not theoretical: the forecast map shipped
a flicker through a green `npm run check`, a passing suite and three
screenshots that each looked correct.

```sh
npm run motion -- --scene map --demo
```

`scripts/measure-motion.mjs` loads a scene in headless Chrome, watches a canvas
(`--selector`, default `.forecast-map-overlay`) for `--seconds`, and reports
two things that answer different questions.

| Reading | What it catches |
| --- | --- |
| **Cadence** — paints a second, and the min/median/p90/max gap between them | Bunching. A timer that also drives a React render bunches whenever the page is busy, which is what "not smooth" looks like even when every frame is correct. |
| **Reversals per pixel** — how often a pixel brightens, dims, then brightens again | Flicker. Something crossing the frame brightens a pixel once and dims it once, so about 1 is right. Much more is a value sitting on a threshold and twitching across it. |

The thresholds are measured, not guessed. On the forecast map over four
seconds, the continuous colour ramp scores **0.38** reversals per pixel and
putting the four hard colour bands back scores **2.38**, so the alarm sits at
1.5 and the command exits non-zero above it.

The same regression is guarded offline, with no browser, by
`tests/precipitation-flow.test.mjs`, which walks a whole pass at the rate the
loop really paints and asserts on the colour bytes that come out. That one runs
in `npm run check`; this one needs a dev server, so it does not.

For a compositor-moved DOM element, pass its selector instead of a canvas. The
command samples its box on animation frames and reports frame cadence, sampled
path length, and how many charge and jump phases began. The Tenant's
deterministic travel flag makes this reproducible:

```sh
npm run motion -- --scene transport --offline --pet travel-transport --selector .tenant --wait 200
```

To *see* motion rather than measure it, `npm run shot -- --sequence 3 --every
900` writes three frames from a single page load. One browser for the lot:
starting one per moment is most of a minute each time.

## Screenshots: `npm run shot`

`scripts/screenshot.mjs` launches headless Chrome, drives it over the DevTools
protocol, and writes a PNG under `screenshots/` (ignored by git). It needs a
server answering on `http://127.0.0.1:3000` (`npm run dev`, or the built site
with `npm start`) and waits up to a minute for it. Chrome is found on its own on
Ubuntu, macOS and the GitHub runners; pass `--chrome <path>` otherwise.

```sh
npm run shot -- --scene transport --offline            # 1280 x 720, no weather requests
npm run shot -- --scene transport --offline --transit-demo  # ... with every delay and incident mark
npm run shot -- --scene map                             # the map, live data
npm run shot -- --clip .weather-band --scale 2          # one element, at 2x
npm run shot -- --offline --time 08:46 --clip .clock-widget      # the clock card
npm run shot -- --offline --clip .clock-block --pad 0             # the digits, without the card
npm run shot -- --reduced-motion --clip .display-shell
npm run shot -- --scene map --demo --pet map
npm run shot -- --console                               # print what the page logged
```

- `--pad <px>` widens the crop around the clipped element (default 4). The
  Tenant's ears and leaf overflow its box, so `--clip .tenant --pad 22
  --scale 4` is the capture for the character.
- `--clip <selector>` gives the smallest image that shows the change, which is
  what AGENTS.md asks for.
- `--class "<selector>=<names>"` replaces the element's whole class list and
  re-applies it every 40 ms, because React rewrites `className` whenever its
  own value changes. Include the element's own class (`clock-block`) or its
  styles go with it. This is how a Tenant pose is reached on demand: the class
  names are listed in [CLOCK.md](CLOCK.md).
- `--demo` is the `?weather=demo` flag above, and is how the forecast map is
  captured: headless Chrome starts each run with an empty profile, so without
  it every capture of the map buys another three hundred coordinates.
- `--time HH:MM` pins the clock (the `?time=` flag above), so the face can be
  checked against the digits that stress it. `08:46` shows a 0, an 8, a 4 and
  a 6, which between them are the widest and tallest digits it has.
- `--freeze <ms>` pauses every CSS animation at that time, so a keyframe in the
  middle of a roll or a Tenant gesture can be captured.
- `--console` prints everything the page logged. The weather card logs one
  line, `[weather] every provider failed: ...`, naming each provider and its
  reason, which is the fastest explanation of a muted card.

The browser pane's own screenshots are unreliable for the clock: its crop is
unsupported, its waits are capped, and a hidden pane returns stale frames. Use
this script instead.

## Is the layout right? `npm run audit`

`scripts/audit-ui.mjs` loads every scene at the Fire TV's fixed 1280 x 720
viewport in one browser and asks the page about itself. It exists because
layout faults have reached the display through a green check, a passing suite
and screenshots that were looked at. These faults are mechanical and invisible
in a PNG unless you already know to look.

```sh
npm run audit                      # all 7 scenes at 1280 x 720, text out
npm run audit -- --json            # ... the same findings as JSON
npm run audit -- --scene map       # one scene at 1280 x 720
npm run audit -- --shots           # ... and a PNG per state, same page loads
npm run audit -- --all             # notes too
```

What it reports:

| Kind | Means |
| --- | --- |
| `clipped` | An ancestor hides its overflow and part of this element is outside it, with no pointer to scroll it back. Graded by how much of the element is gone, not by pixels: a hairline on a tall panel is a warning that the layout is at its limit, a third of a label is an error. |
| `page-scrolls` | The page is taller than the fixed viewport, so content would be unreachable. |
| `wrapped` | Something in the single-line contract in the script rendered on two lines. Text is meant to wrap, so this is an explicit list, not a guess. |
| `tiny-text` | Below the legibility floor for a screen read from across a room. Required attribution and debug chrome are exempt. |
| `contrast` | Measured against the first ancestor that actually paints a background, with translucent ink blended first. |
| `empty` | A pane rendered with no text at all, which is usually a data path that failed silently. |
| `overlap` | A map location tag is covered by the timeline, another tag, attribution, a status message or rotation indicator. Map tags are also checked against every edge of their viewport. |

It needs the dev server, the same as `npm run shot`, and exits 1 on an error so
it can gate a change. Run it before reaching for a screenshot after any CSS
change: it covers every scene and looks at the things eyes skip.

## The clock's sky, twenty at a time: `npm run states`

`scripts/clock-states.mjs` drives twenty sky states through one browser and
lays them out on a single sheet. The faults this scenery produces — a gradient
clipped into a hard line, a cloud that reads as bokeh, a shadow cut square by a
digit's own overflow — are invisible in any one tile and obvious when the tiles
are side by side.

```sh
npm run states                   # the twenty, on one sheet
npm run states -- --seams        # ... and the rows that change sharply across the width
npm run states -- --save-baseline   # remember the current twenty
npm run states -- --baseline     # what moved since, per state
```

`--seams` reads the captures back and names rows where the image changes
sharply across most of its width, which is what a clipped gradient leaves and a
hill never does. It found the snow-cap line that four rounds of looking had
missed. `--baseline` reports what moved since `--save-baseline`, per state, as
a share of pixels and the rows they are in — which is how you see that tuning
the cloud bank also moved the ridge.

Costs no provider quota: every state is `?weather=off` with `?sky=` pinned.
Baselines live under `screenshots/`, which is gitignored, so they are local
working files and cannot gate CI or a review.

## The digit roll: `npm run roll`

`scripts/clock-roll.mjs` catches the clock's transition, which happens on the
minute boundary and lasts under a second. Nothing else on the display needs
this, because everything else can be pinned or replayed on demand.

`?time=` shifts the clock by whole minutes and keeps the seconds, so the
boundary is always at :00 of the real clock. The script waits for the page's
own clock to reach :58.7 and then captures a fast strip across it, landing
eight or nine frames inside the roll.

```sh
npm run roll                            # the breeze, at dusk
npm run roll -- --sky day,rain,heavy    # the wash, and its faster pace
npm run roll -- --clip .clock-widget    # the whole card rather than the block
```

It takes the same URL flags as the other browser tools, so the roll can be
caught at a pinned time or against another host. `?weather=off` is the default:
photographing the digits should never spend a provider's quota.

## Where is the surface? `npm run scene`

`scripts/scene-guides.mjs` answers the question the painted cards keep asking:
where, in this picture, is the thing the live content has to line up with? The
workshop's bench is drawn twice — flat behind the digits, larger in front of
them — and the seam reads as one plank to the eye and as nothing at all to the
stylesheet. Nudging `padding-top` against a PNG is how that gets guessed at.

```sh
npm run scene -- --offline --time 08:46            # the clock card: table, guide PNG
npm run scene -- --card weather --offline          # the weather card
npm run scene -- --sky night,clear --sky dusk,rain # several states, one browser
npm run scene -- --no-shot --sky night,clear       # the table only
npm run scene -- --plain                           # the card with nothing drawn on it
```

It writes two things from one page load:

- **A table.** Every horizontal edge the composited card actually has, found by
  reading the rendered pixels rather than the source artwork, so the answer
  includes the second bench plane, the light pass and the weather filter. Then
  every element that has to meet one — the digits' ink and their baseline, the
  date, the Tenant's feet, each named group in the prop SVG — in card pixels
  and in per cent of its height, which is what the rules are written in.
- **A guide.** `screenshots/scene-<card>.png`: the same card with those
  landmarks ruled onto it, so a placement is judged against the picture rather
  than against a number.

It also reports the light — the mean colour of the card and of each third, and
where the brightest pool in the painting is. That is what the ambient filters
in [app/clock-workshop.css](../app/clock-workshop.css) are derived from, and
how the workshop lamp was put over the pool the night plate already paints,
rather than beside it.

The type and the props are hidden for the reading pass, because ivory digits
and a lamp's own glow are brighter than anything the painter put in the room
and would otherwise be the brightest pool in every state. `--with-content`
reads the composite instead. It needs the dev server, the same as
`npm run shot`.

## Why is the weather card muted? `npm run probe`

`scripts/probe-forecast.mjs` requests every provider the display uses, through
the project's own URL builders and parsers, and prints one line per provider:
HTTP status, latency, size, CORS header, whether the payload parsed, and the
provider's reason when it refused.

```text
hourly Google         HTTP 200  221 ms   38 KB   cors -     parsed 24 items
                      every hour dry, so qpf and snowQpf cannot be compared yet
hourly DMI            HTTP 429  243 ms   0 KB    cors *     {"status":429,"error":"Too Many Requests","message":"Server is busy..."}
hourly Open-Meteo     HTTP 429  168 ms   0 KB    cors *     {"reason":"Daily API request limit exceeded. Please try again tomorrow."}
hourly MET Norway     HTTP 200  108 ms   90 KB   cors *     parsed 54 items  expires Thu, 03 Sep 2026 19:12:15 GMT
```

`npm run probe` is a plain Node script and does not read `.env.local`, so source
it first:

```sh
set -a && . ./.env.local && set +a && npm run probe
```

Google is asked only when `GOOGLE_WEATHER_API_KEY` is in the environment, the
same way `npm run probe:transit` treats `REJSEPLANEN_ACCESS_ID`; without it the
line says so and the run carries on, which is what the display does too. The
probe asks Google directly rather than through `/api/weather`, so the key
travels in the query string and is scrubbed from everything printed. The second
line is there to settle one thing the documentation does not: whether Google's
`qpf` is the rain alone or the hour's whole total. `lib/google-weather.ts` adds
`snowQpf` to it, and the first hour that carries both settles it against DMI's
own split.

The card has two separate signals, and the probe tells you which applies:

| On screen | Meaning | Where |
| --- | --- | --- |
| Small orange dot, top right of the card | The last refresh failed on every provider, or the data is old. Connection problem. | `.offline-dot`, `components/weather-panel.tsx` |
| Card and ribbon drawn muted (grey text, ribbon at half opacity) | The forecast on screen is more than 45 minutes old. Data problem. | `.stale`, `app/globals.css` |

A dot without muting means a refresh just failed but the forecast on screen is
still current; the card retries with backoff (20 s doubling to 5 min). Muting
means every provider has been failing for at least 45 minutes. The forecast is
never removed: the last good one stays on screen, is kept in device storage, and
comes back after a reload.

## Providers and their quotas

Three keyless, CORS-open providers, asked in order until one answers with a
payload that parses. The order and the reasons are in `lib/forecast-sources.ts`
and `lib/daily-forecast.ts`.

| Provider | Carries | Limit | Failure seen |
| --- | --- | --- | --- |
| DMI forecast EDR | Hours (Harmonie) | 500 requests / 5 s shared by every caller | `429 Server is busy` for the whole maintenance window 31 Aug to 10 Sep 2026 |
| Open-Meteo | Hours (same Harmonie run), the week, the map grid | **10,000 weighted calls a day per client IP address**, 5,000 an hour, 600 a minute | `429 Daily API request limit exceeded` |
| MET Norway Locationforecast | Hours and the week (its own model) | 20 requests / s per application; honour `Expires`; four-decimal coordinates | none yet |

**Open-Meteo counts every coordinate in a request as a call.** The weight of a
request is `locations × max(1, days / 14) × max(1, variables / 10)`, so every
point forecast the display makes is one call and the forecast-map grid is one
call per coordinate (`lib/open-meteo-quota.ts`). At the Fire TV's frame the
grid is 285 coordinates on a 3 km lattice, so one load of the map scene is
about 300 calls, and the display alone spends roughly 1,800 a day (six grid
fetches, 96 hourly and 24 daily requests, counted at their worst). The quota
is per client IP address, and the Fire TV, the development machines and every
screenshot session on the same home connection share one. On 3 September 2026
a day of clock screenshots taken against `?scene=map` spent the whole quota by
the evening, Open-Meteo answered 429 to everything, DMI was in maintenance, and
the card sat muted with a forecast from hours before. Four things now stop
that recurring:

1. **MET Norway** stands behind both DMI routes, for the hours and the week. It
   is a different model on a different quota, so both DMI routes can be down
   without the card going stale.
2. **The last good answer is stored on the device** (`localStorage`, keys
   `home-dashboard:forecast-*:v1`) and restored on load. A reload within the
   same model run costs no grid request: the scheduler compares the stored run
   against the run metadata and fetches only when a newer run exists.
3. **`?weather=off`** for every capture that is not about the weather,
   **`?weather=demo`** for a capture of the map itself, and `npm run probe`
   never requests the grid unless told to.
4. **One refusal locks Open-Meteo out for everyone on the device.** When it
   answers `429 Daily API request limit exceeded`, the card, the week strip
   and the map stop asking it until midnight UTC, when the counter resets
   (an hourly or minutely refusal locks out until the next hour or minute).
   The lockout is shared through device storage
   (`home-dashboard:open-meteo-lockout:v1`, `components/open-meteo-lockout.ts`),
   so the map's refusal spares the card its own, and the card's `[weather]`
   line reads `Open-Meteo daily limit, not asked again before 02:00`. The
   probe prints the same line under any 429 it gets.

The forecast map has no fallback provider: nobody else serves a keyless
precipitation grid the browser can draw. When Open-Meteo is out, the map keeps
playing the stored run until its frames have passed and then says so, while the
card and the week stay up. See [FORECAST_MAP.md](FORECAST_MAP.md) for the DMI
work that could replace it.

## Why is the forecast map never coming round?

Most likely because it has nothing to show. The scene is skipped when the run
it holds has frames ahead of now and no precipitation in any of them, over the
six hours it would animate: thirty seconds of empty map with a caption saying
so is thirty seconds the departures and the next fact could have had. A dry day
therefore cycles in thirty seconds rather than a minute, and the map rejoins
the rotation on its own when a later run brings rain.

Three things it is **not**, all of which keep the scene: a run still loading, a
provider that failed, and a run whose last frame is behind us (`Forecast
expired`). If the map is missing and the forecast is wet, look at those first.

`?scene=map` overrides the skip, so pinning is how the scene is reached for a
capture whatever the sky is doing, and the synthetic runs decide what it shows:
`?weather=demo` always has rain in it, `?weather=dry` never does. The second is
what to reach for here — `npm run shot -- --scene map --dry` photographs the
scene that is being skipped, and `npm run audit -- --scene map-dry` reads its
caption against the basemap behind it. The decision is `dry` in `components/forecast-map-panel.tsx`,
reported through `onDry` and acted on by `nextRotation()` in
`lib/panel-rotation.ts`; the panel stays mounted and keeps refreshing while it
is skipped, so being away costs no extra request when it returns.

One appearance is unavoidable after a page load. The panel measures its own
view and arms its refresh scheduler the first time the scene is on screen, so
it withholds the skip until then: a map skipped before it had ever appeared
would never fetch another run, and could never find the rain that would bring
it back. On the wall, which is never reloaded, that is once ever.

## Remote debugging on the Fire TV

Silk is Chromium. With ADB debugging enabled on the stick,
`adb connect <ip>` then `chrome://inspect` in a desktop Chrome lists the
display's tab, and its console shows the same `[weather]` and `[week]` lines
the screenshot script prints with `--console`. Device storage can be cleared
from there too, which is the one way to force a fresh fetch of everything.

## Guardrails that run on their own

These are wired in `.claude/settings.json` and `eslint.config.mjs`, so they
apply to any agent working in this repository, not only to `npm run check`.

| Guardrail | What it does |
| --- | --- |
| `scripts/hooks/guard-generated.mjs` | Refuses edits to generated files (`public/facts/daily/`, `public/fonts/clock/`, `app/clock-fonts.css`, `package-lock.json`) and names the command that regenerates them. |
| `scripts/hooks/lint-changed.mjs` | Lints each file as it is written, and before a turn ends lints every changed file, typechecks if TypeScript changed, and runs the tests if `lib/` or `tests/` changed. |
| `eslint.config.mjs` | `lib/` may not import React, the DOM, `fetch` or Next.js; `components/` may not import from `app/`; every `Intl.DateTimeFormat` names a `timeZone`; no `toLocale*String`. |
| `scripts/check-rules.mjs` | No `:hover` or `cursor` in the CSS; every `lib/` module has a test; every timer, listener, frame and Leaflet map in a component has its teardown; no `NEXT_PUBLIC_` credential names; Render's start script exists and binds `0.0.0.0`; the hooks exist; the font stylesheet matches the face list. |
| `scripts/check-docs.mjs` | Every path a Markdown file names exists. |
