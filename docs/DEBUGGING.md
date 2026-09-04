# Debugging the display

How to see what the display sees, reproduce a state without waiting for it,
and find out why a panel is muted or blank. Everything here is plain Node
(`scripts/`) or a URL parameter, so it works the same on Ubuntu, macOS, the
GitHub runners, and against the deployed site.

```text
npm run shot -- [options]     screenshot the running dashboard, headless Chrome, 1280 x 720
npm run probe                 ask every forecast provider as the browser would
npm run check:rules           the AGENTS.md rules a script can check
/?scene=map                   pin the rotating panel (README)
/?weather=off                 make no weather request at all
/?weather=demo                as off, but the map draws a synthetic run
/?time=08:46                  pin the clock to a Copenhagen time
```

## URL flags

Every flag defaults to normal behaviour when absent or misspelt, so a bad URL
can never leave the wall display stuck. They combine:
`/?scene=map&weather=off&time=08:46`.

| Flag | Effect | Parsed in |
| --- | --- | --- |
| `?scene=transport`, `?scene=fact&fact=N`, `?scene=map` | Holds one scene on the right-hand panel and schedules nothing. A `Pinned` badge replaces the rotation ring. | `lib/panel-rotation.ts` |
| `?weather=off` | The weather card, the week strip and the forecast map make **no request**. The card shows its unavailable state. The clock, the transit strip and the daily facts work as normal. | `lib/debug-flags.ts` |
| `?weather=demo` | Makes no request either, but the forecast map draws the synthetic run in `lib/precipitation-demo.ts`: a band crossing the frame, hour by hour with the quarters inside an hour identical, exactly the shape the real provider returns. It is the only way to photograph the map's animation without buying a grid, and it is deterministic, so two captures of the same change are comparable. | `lib/debug-flags.ts` |
| `?time=HH:MM` | The clock reads that Copenhagen time; seconds still tick, so the minute still rolls. Everything that reads the clock follows: the wardrobe, the Tenant's mood, the ribbon's window. For checking an outfit against chosen digits, since a face that clips on a 4 looks fine at 21:21. | `lib/debug-flags.ts` |

Use `weather=off` for any capture that is not about the weather, and
`weather=demo` for one that is about the forecast map. The reason is quota,
explained below.

## Screenshots: `npm run shot`

`scripts/screenshot.mjs` launches headless Chrome, drives it over the DevTools
protocol, and writes a PNG under `screenshots/` (ignored by git). It needs a
server answering on `http://127.0.0.1:3000` (`npm run dev`, or the built site
with `npm start`) and waits up to a minute for it. Chrome is found on its own on
Ubuntu, macOS and the GitHub runners; pass `--chrome <path>` otherwise.

```sh
npm run shot -- --scene transport --offline            # 1280 x 720, no weather requests
npm run shot -- --scene map                             # the map, live data
npm run shot -- --narrow --scene fact --fact 1          # the max-aspect-ratio: 5/4 layout
npm run shot -- --clip .weather-band --scale 2          # one element, at 2x
npm run shot -- --offline --time 08:46 --clip .clock-block --class ".clock-block=clock-block o-neon"
npm run shot -- --offline --clip .clock-block --class ".clock-block=clock-block o-neon sp-domino" --freeze 800
npm run shot -- --reduced-motion --clip .display-shell
npm run shot -- --console                               # print what the page logged
```

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
