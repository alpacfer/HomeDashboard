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
npm run check:rules           the AGENTS.md rules a script can check
/?scene=map                   pin the rotating panel (README)
/?weather=off                 make no weather request at all
/?weather=demo                as off, but the map draws a synthetic run
/?time=08:46                  pin the clock to a Copenhagen time
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
| `?scene=transport`, `?scene=fact&fact=N`, `?scene=map` | Holds one scene on the right-hand panel and schedules nothing. A `Pinned` badge replaces the rotation ring. | `lib/panel-rotation.ts` |
| `?weather=off` | The weather card, the week strip and the forecast map make **no request**. The card shows its unavailable state. The clock, the transit strip and the daily facts work as normal. | `lib/debug-flags.ts` |
| `?weather=demo` | Makes no request either, but the forecast map draws the synthetic run in `lib/precipitation-demo.ts`: a band crossing the frame, hour by hour with the quarters inside an hour identical, exactly the shape the real provider returns. It is the only way to photograph the map's animation without buying a grid, and it is deterministic, so two captures of the same change are comparable. | `lib/debug-flags.ts` |
| `?time=HH:MM` | The clock reads that Copenhagen time; seconds still tick, so the minute still rolls. Everything that reads the clock follows: the wardrobe, the Tenant's mood, the ribbon's window. For checking an outfit against chosen digits, since a face that clips on a 4 looks fine at 21:21. | `lib/debug-flags.ts` |
| `?pet=weather`, `week`, `transport`, `fact`, `map` | Holds the Tenant at that measured UI landmark. This checks its destination poses without waiting for curiosity to select an adventure; normal travel is unchanged when the flag is absent. | `lib/debug-flags.ts` |
| `?pet=travel-weather`, `travel-week`, `travel-transport`, `travel-fact`, `travel-map` | Sends the Tenant from home to that landmark through its real measured landing pads, then holds it there. Use a screenshot sequence to inspect charge, parabola and chained landings without waiting for curiosity. | `lib/debug-flags.ts` |

Use `weather=off` for any capture that is not about the weather, and
`weather=demo` for one that is about the forecast map. The reason is quota,
explained below.

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
npm run shot -- --offline --time 08:46 --clip .clock-block --class ".clock-block=clock-block o-neon"
npm run shot -- --offline --clip .clock-block --class ".clock-block=clock-block o-neon sp-domino" --freeze 800
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
  styles go with it. This is how an outfit, a set piece or a Tenant pose is
  reached on demand: the class names are listed in [CLOCK.md](CLOCK.md).
- `--demo` is the `?weather=demo` flag above, and is how the forecast map is
  captured: headless Chrome starts each run with an empty profile, so without
  it every capture of the map buys another three hundred coordinates.
- `--time HH:MM` pins the clock (the `?time=` flag above), so an outfit can be
  checked against the digits that stress it. `08:46` shows a 0, an 8, a 4 and
  a 6, which between them are the widest and tallest digits of every face.
- `--freeze <ms>` pauses every CSS animation at that time, so a keyframe in the
  middle of a set piece can be captured.
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
npm run audit                      # 4 states, text out
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

It needs the dev server, the same as `npm run shot`, and exits 1 on an error so
it can gate a change. Run it before reaching for a screenshot after any CSS
change: it covers every scene and looks at the things eyes skip.

## Why is the weather card muted? `npm run probe`

`scripts/probe-forecast.mjs` requests every provider the display uses, through
the project's own URL builders and parsers, and prints one line per provider:
HTTP status, latency, size, CORS header, whether the payload parsed, and the
provider's reason when it refused.

```text
hourly DMI            HTTP 429  243 ms   0 KB    cors *     {"status":429,"error":"Too Many Requests","message":"Server is busy..."}
hourly Open-Meteo     HTTP 429  168 ms   0 KB    cors *     {"reason":"Daily API request limit exceeded. Please try again tomorrow."}
hourly MET Norway     HTTP 200  108 ms   90 KB   cors *     parsed 54 items  expires Thu, 03 Sep 2026 19:12:15 GMT
```

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
