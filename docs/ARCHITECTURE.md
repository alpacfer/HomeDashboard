# Architecture and route map

HomeDashboard is a small, client-rendered Next.js display that runs continuously on a 16:9 screen. The browser owns the live display state; the server only proxies the optional Rejseplanen integration so its access ID never reaches the browser.

It is deployed to a Render free-plan web service and viewed in the Silk browser on a Fire TV Stick HD. Both ends of that chain are resource-constrained and shape most design decisions here. Read [DEPLOYMENT.md](DEPLOYMENT.md) before changing anything that affects bundle size, memory, animation, or polling.

## Routes and entry points

| URL or command | Source | Responsibility |
| --- | --- | --- |
| `/` | `app/page.tsx` | Owns the one-second clock tick and composes the display: clock, `WeatherPanel`, `WeekStrip`, and the rotating right-hand panel. |
| `/?scene=map` | `lib/panel-rotation.ts`, `components/rotating-panel.tsx` | Debug mode. Pins the rotating panel to `transport`, `fact` (with `&fact=N`) or `map` and schedules nothing. Unrecognised values are ignored. See the README. |
| `/?pet=map` | `lib/debug-flags.ts`, `components/clock.tsx`, `components/tenant.tsx` | Debug mode. Holds the Tenant at a measured weather, week, transport, fact or map landmark for deterministic visual checks. Unknown values are ignored. |
| `/?weather=off` | `lib/debug-flags.ts` | Debug mode. No weather, week or forecast-map request is made, so a capture spends no provider quota. See [DEBUGGING.md](DEBUGGING.md). |
| `/api/departures` | `app/api/departures/route.ts` | Server-side departure lookup: Rejseplanen when an access ID is set, Transitous otherwise or on failure, then normalization, filtering, and a two-minute public-result cache. |
| `/facts/daily/MM-DD.json` | `public/facts/daily/` | Static date-keyed facts loaded by the browser for the Copenhagen calendar date. |
| `npm run facts:generate` | `scripts/generate-daily-facts.mjs` | Deliberate rebuild of all 366 daily-fact files from reviewed overrides and external sources. |
| `npm run shot`, `npm run probe`, `npm run probe:transit` | `scripts/screenshot.mjs`, `scripts/probe-forecast.mjs`, `scripts/probe-transit.mjs` | Debugging tools: a headless-Chrome capture of the running display, and a check of every forecast and departure provider through the project's own parsers. See [DEBUGGING.md](DEBUGGING.md). |

Next.js App Router file names define the routes. Do not add a client-side routing library for display panels: `RotatingPanel` changes the panel scene in place so the URL remains stable.

## Directory layout

Dependencies point inward. `app/` may import from `components/` and `lib/`; `components/` may import from `lib/`; `lib/` imports nothing from the other two.

| Directory | Holds | Rule |
| --- | --- | --- |
| `app/` | Route entry points only: `layout.tsx`, `page.tsx`, `globals.css`, `app/api/departures/route.ts`. | A file belongs here only if the App Router gives it a URL, or it is the global stylesheet. |
| `components/` | The React components that own browser effects: timers, fetches, storage, Leaflet, wake lock. | Anything with `'use client'`, a hook, or a side effect. |
| `lib/` | Pure logic: parsing, validation, time conversion, selection, rotation timing. | No React, no DOM, no `fetch`, no Next.js. Enforced by `eslint.config.mjs`, not just by convention. |
| `tests/` | `node:test` suites, one per `lib/` module. | Tests import `lib/` directly. Nothing in `tests/` needs a renderer or a network. |
| `scripts/` | Build-time and maintenance tooling. | Plain Node with no dependencies, so it behaves the same on Ubuntu, macOS and CI. |

Imports across directories use the `@/` alias from `tsconfig.json` (`@/lib/weather`, `@/components/clock`). Relative imports are for siblings only.

That split is why `npm test` needs no renderer, no jsdom and no network: every rule worth testing already lives in a pure function. When you add logic, ask whether it can go in `lib/` before putting it in a component.

## UI composition

```text
app/page.tsx (Home)
├── KeepAwake                       components/keep-awake.tsx
├── Clock                           components/clock.tsx
│   ├── clockFrame, changedDigits  lib/clock-motion.ts   Copenhagen time, which digits roll
│   ├── pickOutfit, outfitDate,    lib/clock-wardrobe.ts  outfits, context weights, date formats
│   │   wardrobeContext
│   ├── pickSetPiece, delayToQuiet lib/clock-events.ts   set pieces and the quiet moments they fit
│   └── Tenant                      components/tenant.tsx
│       └── tenantMood, inkBox,     lib/clock-tenant.ts   mood, idle life, glyph geometry
│           tenantTargets
├── WeatherPanel                   components/weather-panel.tsx
│   ├── SOURCES, parseCoverage,    lib/forecast-sources.ts  DMI, then Open-Meteo, then MET Norway;
│   │   parseForecast,                                   payload validation, accumulation
│   │   parseLocationForecast                            differencing
│   ├── readStored, writeStored    components/device-storage.ts  last good answer, validated on read
│   ├── debugFlags                 lib/debug-flags.ts     ?weather=off
│   ├── describeHour, isDaylight   lib/weather.ts        shared hour model, condition derivation,
│   │                                                    intensity bands, solar elevation
│   └── buildRibbon, rainHeadline, lib/forecast-summary.ts  rolling window, headline wording,
│       temperatureTrack                                 bar, temperature-track and mark geometry
├── WeekStrip                       components/week-strip.tsx
│   ├── DAILY_SOURCES,             lib/daily-forecast.ts  Open-Meteo daily aggregates, then MET
│   │   parseDailyForecast,                              Norway aggregated by day; the seven days
│   │   parseMetDaily, describeDay                       after today, day condition
│   └── ICONS                      components/condition-icons.ts  one icon per condition, shared
└── RotatingPanel                   components/rotating-panel.tsx
    │   └── nextRotation            lib/panel-rotation.ts scene timing
    ├── TransportPanel              components/transport-panel.tsx
    │   └── filterDepartures        lib/transit.ts        route configuration, time conversion, filtering
    ├── ForecastMapPanel            components/forecast-map-panel.tsx
    │   ├── gridForView,            lib/precipitation-grid.ts  lattice from the view, 15-minute
    │   │   parsePrecipitationGrid,                              frames, quiet hours, intensity bands
    │   │   displayFrames, isQuietHours
    │   └── shouldFetchGrid,        lib/forecast-refresh.ts    run metadata, when to refetch
    │       nextCheckAt, parseModelRun
    └── daily fact scene
        └── validDailyFacts         lib/daily-facts.ts    date key and payload validation
```

`app/globals.css` is the single visual system for the display. It contains the fixed 1280 x 720 layout, panel transitions, the condition palette (`.condition-*` classes set `--sky`, the colour the icon and degree sign take, and the tint behind the card, so sun reads amber, cloud slate, rain blue), and reduced-motion behavior. Keep component markup semantic and put layout changes in this stylesheet rather than adding one-off inline styles.

## Data flow

### Clock and date

`Home` updates `now` once per second. `Clock` passes that value to `clockFrame()` for minute-based digit animation and to `outfitDate()` for the date below the clock. Both formatters use `Europe/Copenhagen`, so the displayed calendar date does not depend on the device's time zone. A null value is used during the first render to avoid a server/client time mismatch.

The clock also wears an outfit, plays a set piece now and then, and has a small character beside the minutes. All three are decided in pure modules (`lib/clock-wardrobe.ts`, `lib/clock-events.ts`, `lib/clock-tenant.ts`) and only drawn by `components/clock.tsx` and `components/tenant.tsx`. The weather panel reports the current hour's temperature and wetness up to `Home`, which hands it to the clock, so the wardrobe and the character react to the sky without a second fetch. See [CLOCK.md](CLOCK.md).

### Weather

`WeatherPanel` fetches the forecast directly from the browser every 15 minutes, on reconnect/visibility resume, or when the user presses Enter or `R`. `lib/forecast-sources.ts` owns the providers and is asked in preference order: **DMI Open Data first, Open-Meteo second, MET Norway third**, all keyless, all CORS-open, so none needs a proxy route.

There are three because there must always be a fallback, and one of them must not share a failure mode with the others. DMI's forecast EDR enforces a fair-use limit of 500 requests per 5 seconds shared across every caller and answers `429` when busy; during their supercomputer maintenance it answered `429` to everything for hours and the display had no forecast at all. Open-Meteo's `dmi_seamless` is the same DMI Harmonie run, checked field by field against a direct DMI capture (cloud 0.82/0.99 against 82/99, visibility 5969/5870 against 5960/5880, temperatures identical), so the fallback costs directness and nothing else. A provider that fails is skipped for an hour, so a long outage does not spend a request every refresh. See [DEPLOYMENT.md](DEPLOYMENT.md) for the limits.

Those two routes still share one point of failure: Open-Meteo's quota of ten thousand calls a day is counted per client IP address, and the display shares its address with every machine on the home connection. On 3 September 2026 DMI was in maintenance and Open-Meteo's quota had been spent by a day of forecast-map loads, so both were answering `429` and the card sat muted for hours. **MET Norway's Locationforecast** is therefore the third provider: a different model on a different quota, parsed by `parseLocationForecast()` into the same `WeatherHour`. It reports one precipitation amount with no rain/snow split and no visibility, so its frozen share is read from air temperature (`frozenShare()`) and fog from its fog fraction; both approximations are documented in the module and only ever on screen when both DMI routes have failed. Its terms are met by construction: coordinates truncated to four decimals in the URL, identification by the `Origin` header the browser sends on its own, and the fetch left cacheable so the browser honours the `Expires` header. The last good hours are also written to device storage and restored on load, so a reload starts from the previous forecast and its age, not from nothing. See [DEBUGGING.md](DEBUGGING.md).

Every parser returns the identical `WeatherHour`, so which provider answered never changes what the display says. Only the credit line differs. Two properties of the DMI payload shape its parser, and both are documented in the module because getting either wrong produces confident nonsense on screen:

- **Its precipitation fields are accumulated since the model run started**, in kg/m² (= mm), despite metadata declaring them a rate in kg m⁻² s⁻¹. `parseCoverage()` differences consecutive steps, clamps the float dips flat stretches produce, and assigns each difference to the hour that *starts* at the earlier step. Reading them as a rate puts four-digit millimetre values on screen; assigning a difference to the later step shifts every rain hour one hour late. Open-Meteo reports hourly totals already summed, so `parseForecast()` differences nothing.
- **`precipitation-type` cannot be used to decide whether an hour is wet**, because DMI leaves it null in hours carrying several millimetres of rain. Amount alone decides. `probability-of-lightning` is not used either, having read 8 to 75 percent across a rain-free overcast day.

`lib/weather.ts` holds the shared model and the derivation. Being deterministic model output, neither provider is asked for a weather code or a probability: `describeHour()` derives the icon, the label and the intensity band from one hour's own cloud fraction, precipitation amounts and visibility. That is the fix for the original fault, where the icon came from DMI's `weather_code` and the percentage from Open-Meteo's own ensemble. Those are different forecasts — `precipitation_probability` is byte-identical across `dmi_seamless`, `best_match`, `ecmwf_ifs025` and `knmi_seamless` because DMI publishes no probability at all — so a slot reading `100%` beside an overcast icon was the data disagreeing with itself, not a rendering fault. A test asserts the property directly, and another asserts that neither request URL contains `probability` or `weather_code`.

Neither provider carries a day/night flag, so `isDaylight()` computes solar elevation rather than spending a request on it, verified within six minutes of almanac sunrise and sunset at both solstices.

`lib/forecast-summary.ts` turns those hours into the pinned panel: a one-line headline, a fixed 18-hour window, and one bar per hour. The window is rolling rather than a clock window, and there is no today/tomorrow switch. The previous 06:00–18:00 window shrank from seven rows to one over the course of a day, hid everything after 18:00, and needed an eight-second timer to flip between a `Today` and a `Tomorrow` panel. A fixed count of hours from now has no end hour to argue about and no day to switch, and `buildRibbon()` returns nothing at all rather than rendering a short or gapped window as though it were complete. Bar heights are clamped against a fixed millimetre ceiling so a drizzle never draws like a downpour and heights mean the same thing every day.

The card separates two conditions. **Stale** is about the data: a forecast older than 45 minutes is drawn muted. **Offline** is about the connection: the last refresh failed on every provider, so the small dot appears. A refresh that fails while the forecast on screen is twenty minutes old shows the dot and nothing else, because that forecast is still current and must not look broken. The forecast is never removed. When every provider fails the component logs one `[weather]` line naming each provider and its reason, which is what `npm run shot -- --console` and the Silk remote console show.

### The week ahead

`WeekStrip` is a separate, thinner forecast under the ribbon: the seven days after today, each as a weekday, an icon and a high and low. It is deliberately not built from the hourly data, because the DMI Harmonie run the ribbon uses reaches only about two and a half days ahead. `lib/daily-forecast.ts` requests Open-Meteo's daily aggregates of its default model blend once an hour, with MET Norway behind it (`DAILY_SOURCES`, in preference order, the same pattern as the hours); `parseMetDaily()` aggregates MET's six-hourly windows into days, summing non-overlapping precipitation windows and taking each day's extremes from every window and sample that starts in it, and drops a day with fewer than four six-hourly samples. The same MET URL serves the hours, so the two panels share one cached response. Each parser validates the payload, drops today (the ribbon covers it hour by hour), and derives each day's condition from its own cloud cover and precipitation totals with day-sized thresholds (`DAY_WET_MM`, `DAY_HEAVY_MM`). No weather code or probability is requested, for the same reason as the hourly data. A day with any field missing is dropped, and a week with fewer than seven days is not shown: a strip with a hole in it reads as a mistake. "Today" is decided in Copenhagen time, so the first day falls off at Copenhagen midnight regardless of the device zone.

The ribbon and the week are two forecasts and are never mixed. The ribbon answers "what do the next hours do", the week answers "what does the weekend look like", and both take their icons from the one map in `components/condition-icons.ts` so the same sky never draws two pictures.

### Rotating panel

`panel-rotation.ts` is pure timing logic: transport and each daily fact receive 15 seconds, and the forecast map 30. The map keeps twice as long because it is the only animated scene and has a whole six-hour sequence to play; its frame timing is budgeted against `MAP_MS`. `RotatingPanel` persists the next fact index in device-local storage and resumes at transport after the browser wakes. Artwork is preloaded in the component to reduce scene transitions without changing the data contract.

The same module owns the debug mode. `pinnedRotation()` reads the page's query string and, given `?scene=map`, `?scene=transport` or `?scene=fact&fact=N`, returns a rotation with no duration; `RotatingPanel` then shows that scene, replaces the rotation ring with a `Pinned` badge and schedules nothing. Anything unrecognised returns null and the panel rotates as normal, so the display can never be left stuck by a bad URL. This is how a scene is reached when verifying a change: pin it rather than waiting for the cycle, locally or on the deployed site.

### Transport

The browser calls `/api/departures`, never a provider directly. The route reads `REJSEPLANEN_ACCESS_ID` and prefers Rejseplanen's API 2.0; without a key, or when that request fails, it falls back to Transitous, which needs no credential and serves Rejseplanen's own GTFS and SIRI realtime data. Either way the browser receives only normalized `TransitData`, tagged with the `source` that produced it.

`transit.ts` is deliberately pure and owns Copenhagen wall-clock conversion, exact stop matching, line/direction filtering, cancellation handling, compact-board selection, and the incident model both providers feed (`departureIncidents`, `boardIncidents`). `transitous.ts` owns the fallback's stop ids, headsign matching and response validation; the two providers do not use the same destination strings. See [TRANSPORT.md](TRANSPORT.md) before changing stops or provider behavior.

### Daily facts

`useDailyFacts()` derives an `MM-DD` key in Copenhagen time and loads exactly one static JSON file. `validDailyFacts()` checks the date, country set, and required source/image URLs before rendering. The generator is intentionally separate from runtime code; edit `data/daily-fact-overrides.json` for durable editorial changes and review generated files before committing. See [DAILY_FACTS.md](DAILY_FACTS.md).

### Forecast map

`ForecastMapPanel` draws forecast precipitation over a Leaflet basemap and shows **only the forecast**. It used to replay two hours of observed RainViewer radar with nothing ahead of now, which is the wrong half of the question for a wall display: you want to know whether the rain is coming here, not where it has been. RainViewer and its parsing module are gone; their free feed is documented as past-only and its `radar.nowcast` array was empty on every sample.

`lib/precipitation-grid.ts` builds a 3 km lattice (`CELL_KM`; Harmonie is a 2 km model, but a model resolves nothing finer than several grid lengths, so the coarser sampling loses nothing the map could draw and costs a third fewer calls) over **whatever the map is actually showing**, with one cell of margin on every side, and requests it in a single Open-Meteo call. The frame is landscape and the area worth framing (Hillerød down to Copenhagen) is portrait, so a fixed box left the sides of the frame bare; `gridForView()` takes the map's visible bounds instead, capped at `MAX_GRID_POINTS` (450) by opening the spacing rather than exceeding it, because Open-Meteo counts each coordinate as a call and allows 600 a minute, and bounded again to `MAX_URL_LENGTH` (7.8 KB) because the coordinates travel in the query string and Open-Meteo's nginx refuses a request line over 8 KB with a `414`. That response carries no CORS header, so the browser reports it as a generic network failure and nothing in the console names the cause; at the Fire TV's 1280 x 720 the frame asked for 437 points, the URL was 8.7 KB, and the map could never load there. The URL bound would bind first, at about 420 points, and coordinates carry three decimals (about 100 m against 3 km cells). At the TV's frame the lattice is 285 points, under both bounds, and each point is one call against Open-Meteo's quota (`lib/open-meteo-quota.ts`); the smoothing when drawn makes the spacing invisible. Rows are spaced in Web Mercator so every row is the same height in pixels. The data is the same DMI Harmonie run the pinned panel uses. Steps are **15 minutes**, not hourly, because the animation only reads as weather crossing the map at that spacing. Twelve hours are fetched and the next six shown, so the window stays six hours long between refreshes.

The last grid is kept in device storage and restored when the panel mounts, so a reload (a crash, a development session, a screenshot) within the same model run costs no grid request: the scheduler compares the stored run against the run metadata and fetches only when a newer one exists. One grid is about three hundred coordinates and Open-Meteo counts each as a call against a per-address daily quota of ten thousand, so this is what keeps development from spending the display's forecast. When Open-Meteo answers `429`, `components/open-meteo-lockout.ts` records until when (midnight UTC for the daily limit) and the map, the card and the week all leave Open-Meteo alone until then. The map has no fallback provider; when Open-Meteo is out it plays the stored run until its frames have passed and then says so.

The scene is laid out differently while hidden (the mini transit strip appears only once it is on screen), so the map is measured and fitted again each time it becomes active, and **nothing is requested before the first time it is shown**: a grid fetched at mount would be refetched for the real view thirty seconds later, and two grid requests inside a minute is more than the per-minute limit allows. After that, the grid is refetched only if the view reaches past it.

DMI's own EDR API has a `cube` query for exactly this, and it is deliberately not used: it accepts only its native Lambert projection, so every cell would need reprojecting and would land on the map rotated about 16 degrees against north. Asking Open-Meteo in latitude and longitude gives axis-aligned cells and no projection code at all. See [FORECAST_MAP.md](FORECAST_MAP.md) for the DMI work that is parked and what would finish it.

Frames are drawn onto a plain canvas sized to the map container and addressed in container pixels. The map never pans or zooms, so this needs no Leaflet pane transforms and no move listeners. Each frame is written as a tiny image, one pixel per grid cell, and drawn scaled over the grid's bounds with the browser's own bilinear smoothing: one `drawImage` per frame, and the 2 km cells read as a continuous field rather than a mosaic without asking the model for detail it does not have. Colours are the same intensity bands as the pinned forecast ribbon, so a colour means the same thing in both places.

Three rules keep the animation honest:

- **Every frame plays, wet or dry, and none is held.** Dropping dry frames would make a shower teleport across the map, and holding a single image tells the viewer nothing a number could not. A forecast with no precipitation anywhere is announced as such instead.
- **Only frames ahead of now are animated.** `futureFrames()` filters the sequence, so after a night without a refresh the part that is already over is skipped, and an overtaken forecast reports itself as expired rather than replaying yesterday.
- **Nothing is requested between 23:00 and 06:00 Copenhagen time.** `isQuietHours()` covers the grid and the run metadata alike; whatever is loaded keeps playing. A check that would fall in that window is moved to `quietHoursEnd()`, and because twelve hours are held a run fetched in the evening still has frames ahead of now at 06:00.

Refreshing itself is decided in `lib/forecast-refresh.ts`, and the rule is **fetch the grid only when a new run exists**. Open-Meteo serves a static `meta.json` per model (under a kilobyte, CDN-cached with an ETag, CORS-open) giving the last run's initialisation and availability times and the update interval. Each pass reads that, and `shouldFetchGrid()` asks for the grid only if the metadata names a run the map does not hold, the view has outgrown the grid, or there is no grid at all; without readable metadata it falls back to a three-hour cadence. `nextCheckAt()` then books the next pass for two minutes after the following run is expected, retrying every five minutes if it is late and backing off to hourly if it is a whole interval overdue. Hourly refetching used to buy a byte-identical forecast two times in three; this spends about seven grid requests a day.

The metadata is trusted for *when*, never for *whether the map still has anything to show*. It is a separate pipeline from the forecast data and has been seen stuck on an old run and answering `500` for hours while the forecast itself kept updating; a map that refetched only on a new run then sat on frames that had all passed, reporting the forecast as expired and waiting for an announcement that never came. `shouldFetchGrid()` therefore also refetches once fewer frames remain ahead of now than the map shows, whatever the metadata says. In the normal case a new run arrives first and the rule never fires; in the broken case it ends the stall at the next check, which is hourly at worst.

## Change guide

| If you need to change… | Start here | Also check |
| --- | --- | --- |
| Clock digits or date formatting | `lib/clock-motion.ts`, `components/clock.tsx` | `tests/clock.test.mjs`, `app/globals.css` |
| Forecast providers, payload parsing, or fallback order | `lib/forecast-sources.ts` | `tests/forecast-sources.test.mjs`, `DEPLOYMENT.md` |
| Condition or rain classification, intensity bands | `lib/weather.ts` | `tests/weather.test.mjs` |
| Forecast window, headline wording, or ribbon geometry | `lib/forecast-summary.ts` | `components/weather-panel.tsx`, `tests/forecast-summary.test.mjs` |
| Weather fetching, retry backoff, or staleness | `components/weather-panel.tsx` | `DEPLOYMENT.md`, `app/globals.css` |
| The week ahead: its provider, thresholds, or day condition | `lib/daily-forecast.ts` | `components/week-strip.tsx`, `tests/daily-forecast.test.mjs`, `DEPLOYMENT.md` |
| Condition colours or icons | `app/globals.css` (`.condition-*`), `components/condition-icons.ts` | `components/weather-panel.tsx`, `components/week-strip.tsx` |
| Main layout or display sizing | `app/globals.css` | `app/page.tsx`, reduced-motion media query |
| Right-panel timing, or the `?scene=` debug pin | `lib/panel-rotation.ts` | `components/rotating-panel.tsx`, `tests/panel-rotation.test.mjs`, README |
| The `?weather=off` flag, or a new debug flag | `lib/debug-flags.ts` | `tests/debug-flags.test.mjs`, the three weather components, `DEBUGGING.md` |
| What is kept in device storage between reloads | `components/device-storage.ts` | the `valid*` guards in `lib/weather.ts` and `lib/precipitation-grid.ts`, `tests/stored-shapes.test.mjs` |
| Screenshot or provider-probe tooling | `scripts/screenshot.mjs`, `scripts/probe-forecast.mjs` | `DEBUGGING.md`, `.claude/commands/`, `.github/workflows/ci.yml` |
| A rule every change must follow | `scripts/check-rules.mjs`, `eslint.config.mjs`, `scripts/hooks/` | AGENTS.md, `DEBUGGING.md` |
| Transit stops, destinations, or normalization | `lib/transit.ts` | `app/api/departures/route.ts`, `TRANSPORT.md`, transit tests |
| Fallback stop ids, headsigns, or response parsing | `lib/transitous.ts` | `app/api/departures/route.ts`, `TRANSPORT.md`, `tests/transitous.test.mjs` |
| How a delay or incident is marked | `lib/transit.ts` | `components/transport-panel.tsx`, `app/globals.css`, `TRANSPORT.md` |
| Transit credentials, caching, or provider requests | `app/api/departures/route.ts` | `.env.example`, `TRANSPORT.md` |
| Translating provider service messages | `lib/translation.ts` | `app/api/departures/route.ts`, `.env.example`, `TRANSPORT.md` |
| Daily fact content | `data/daily-fact-overrides.json` | `scripts/generate-daily-facts.mjs`, `docs/DAILY_FACTS.md` |
| Forecast map grid, frames, or quiet hours | `lib/precipitation-grid.ts` | `components/forecast-map-panel.tsx`, `tests/precipitation-grid.test.mjs` |
| Forecast map refresh cadence or run detection | `lib/forecast-refresh.ts` | `components/forecast-map-panel.tsx`, `tests/forecast-refresh.test.mjs`, `DEPLOYMENT.md` |
| Metadata or the favicon | `app/layout.tsx`, `public/` | production build |

Prefer pure functions for parsing, selection, time conversion, validation, and rotation decisions. Keep browser effects, timers, fetches, and DOM-dependent work in `*.tsx` components or route handlers. If a new external response is introduced, validate its boundary before it enters React state and add a fixture-level test for malformed data.

## Verification workflow

For a normal change:

1. Update the smallest owning module and its corresponding test.
2. Run `npm test` for behavior, `npm run lint` for code quality and `npm run check:rules` for the project rules.
3. Run `npm run build` for the App Router, TypeScript, and production bundling check.
4. For display changes, capture the result with `npm run shot` at the supported 1280 x 720 viewport. Add `--reduced-motion` when animations are touched, and `--offline` whenever the change is not about the weather. See [DEBUGGING.md](DEBUGGING.md).

The external weather, forecast map, and transit services are not required for unit tests. Provider credentials and live API verification are documented separately because they are environment-dependent.

## Time and naming conventions

- User-facing dates, hours, departures, and daily-fact keys are Copenhagen-local unless a source URL or API contract explicitly says otherwise.
- Use `Europe/Copenhagen` in every new formatter; never rely on the browser's default time zone.
- Keep provider/API types at the boundary and expose narrow normalized types to components.
- Use existing CSS tokens (`--background`, `--foreground`, `--accent`, `--rain`, `--muted`) before adding a new color.
- Keep secrets in server-only environment variables. Anything prefixed `NEXT_PUBLIC_` is eligible for the browser bundle and must not contain credentials.
