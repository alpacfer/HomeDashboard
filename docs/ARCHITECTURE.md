# Architecture and route map

HomeDashboard is a small, client-rendered Next.js display that runs continuously on a 16:9 screen. The browser owns the live display state; the server only proxies the optional Rejseplanen integration so its access ID never reaches the browser.

It is deployed to a Render free-plan web service and viewed in the Silk browser on a Fire TV Stick HD. Both ends of that chain are resource-constrained and shape most design decisions here. Read [DEPLOYMENT.md](DEPLOYMENT.md) before changing anything that affects bundle size, memory, animation, or polling.

## Routes and entry points

| URL or command | Source | Responsibility |
| --- | --- | --- |
| `/` | `app/page.tsx` | Owns the one-second clock tick and composes the display: clock, `WeatherPanel`, and the rotating right-hand panel. |
| `/api/departures` | `app/api/departures/route.ts` | Server-side Rejseplanen lookup, normalization, filtering, and two-minute public-result cache. |
| `/facts/daily/MM-DD.json` | `public/facts/daily/` | Static date-keyed facts loaded by the browser for the Copenhagen calendar date. |
| `npm run facts:generate` | `scripts/generate-daily-facts.mjs` | Deliberate rebuild of all 366 daily-fact files from reviewed overrides and external sources. |

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
│   └── clockFrame, clockDate       lib/clock-motion.ts   Copenhagen time/date formatting, digit transitions
├── WeatherPanel                   components/weather-panel.tsx
│   ├── SOURCES, parseCoverage,    lib/forecast-sources.ts  DMI first then Open-Meteo, payload
│   │   parseForecast                                    validation, accumulation differencing
│   ├── describeHour, isDaylight   lib/weather.ts        shared hour model, condition derivation,
│   │                                                    intensity bands, solar elevation
│   └── buildRibbon, rainHeadline, lib/forecast-summary.ts  rolling window, headline wording,
│       temperatureTrack                                 bar and temperature-track geometry
└── RotatingPanel                   components/rotating-panel.tsx
    │   └── nextRotation            lib/panel-rotation.ts scene timing
    ├── TransportPanel              components/transport-panel.tsx
    │   └── filterDepartures        lib/transit.ts        route configuration, time conversion, filtering
    ├── RadarPanel                  components/radar-panel.tsx
    │   └── parseRadarTimeline      lib/radar.ts          RainViewer response validation and tile URLs
    └── daily fact scene
        └── validDailyFacts         lib/daily-facts.ts    date key and payload validation
```

`app/globals.css` is the single visual system for the display. It contains the 16:9 layout, the narrow-screen layout, panel transitions, rain emphasis, and reduced-motion behavior. Keep component markup semantic and put layout changes in this stylesheet rather than adding one-off inline styles.

## Data flow

### Clock and date

`Home` updates `now` once per second. `Clock` passes that value to `clockFrame()` for minute-based digit animation and `clockDate()` for the date below the clock. Both formatters use `Europe/Copenhagen`, so the displayed calendar date does not depend on the device's time zone. A null value is used during the first render to avoid a server/client time mismatch.

### Weather

`WeatherPanel` fetches the forecast directly from the browser every 15 minutes, on reconnect/visibility resume, or when the user presses Enter or `R`. `lib/forecast-sources.ts` owns the providers and is asked in preference order: **DMI Open Data first, Open-Meteo second**, both keyless, both CORS-open, so neither needs a proxy route.

There are two because there must always be a fallback. DMI's forecast EDR enforces a fair-use limit of 500 requests per 5 seconds shared across every caller and answers `429` when busy; during their supercomputer maintenance it answered `429` to everything for hours and the display had no forecast at all. Open-Meteo's `dmi_seamless` is the same DMI Harmonie run, checked field by field against a direct DMI capture (cloud 0.82/0.99 against 82/99, visibility 5969/5870 against 5960/5880, temperatures identical), so the fallback costs directness and nothing else. A provider that fails is skipped for an hour, so a long outage does not spend a request every refresh. See [DEPLOYMENT.md](DEPLOYMENT.md) for the limits.

Both parsers return the identical `WeatherHour`, so which provider answered never changes what the display says. Only the credit line differs. Two properties of the DMI payload shape its parser, and both are documented in the module because getting either wrong produces confident nonsense on screen:

- **Its precipitation fields are accumulated since the model run started**, in kg/m² (= mm), despite metadata declaring them a rate in kg m⁻² s⁻¹. `parseCoverage()` differences consecutive steps, clamps the float dips flat stretches produce, and assigns each difference to the hour that *starts* at the earlier step. Reading them as a rate puts four-digit millimetre values on screen; assigning a difference to the later step shifts every rain hour one hour late. Open-Meteo reports hourly totals already summed, so `parseForecast()` differences nothing.
- **`precipitation-type` cannot be used to decide whether an hour is wet**, because DMI leaves it null in hours carrying several millimetres of rain. Amount alone decides. `probability-of-lightning` is not used either, having read 8 to 75 percent across a rain-free overcast day.

`lib/weather.ts` holds the shared model and the derivation. Being deterministic model output, neither provider is asked for a weather code or a probability: `describeHour()` derives the icon, the label and the intensity band from one hour's own cloud fraction, precipitation amounts and visibility. That is the fix for the original fault, where the icon came from DMI's `weather_code` and the percentage from Open-Meteo's own ensemble. Those are different forecasts — `precipitation_probability` is byte-identical across `dmi_seamless`, `best_match`, `ecmwf_ifs025` and `knmi_seamless` because DMI publishes no probability at all — so a slot reading `100%` beside an overcast icon was the data disagreeing with itself, not a rendering fault. A test asserts the property directly, and another asserts that neither request URL contains `probability` or `weather_code`.

Neither provider carries a day/night flag, so `isDaylight()` computes solar elevation rather than spending a request on it, verified within six minutes of almanac sunrise and sunset at both solstices.

`lib/forecast-summary.ts` turns those hours into the pinned panel: a one-line headline, a fixed 18-hour window, and one bar per hour. The window is rolling rather than a clock window, and there is no today/tomorrow switch. The previous 06:00–18:00 window shrank from seven rows to one over the course of a day, hid everything after 18:00, and needed an eight-second timer to flip between a `Today` and a `Tomorrow` panel. A fixed count of hours from now has no end hour to argue about and no day to switch, and `buildRibbon()` returns nothing at all rather than rendering a short or gapped window as though it were complete. Bar heights are clamped against a fixed millimetre ceiling so a drizzle never draws like a downpour and heights mean the same thing every day. The current weather remains available while a stale response is marked visually.

### Rotating panel

`panel-rotation.ts` is pure timing logic: transport, each daily fact, and radar each receive 30 seconds. `RotatingPanel` persists the next fact index in device-local storage and resumes at transport after the browser wakes. Artwork is preloaded in the component to reduce scene transitions without changing the data contract.

### Transport

The browser calls `/api/departures`, never Rejseplanen directly. The route reads `REJSEPLANEN_ACCESS_ID`, resolves configured stops, requests boards, and returns only normalized `TransitData`. `transit.ts` is deliberately pure and owns Copenhagen wall-clock conversion, exact stop matching, line/direction filtering, cancellation handling, and compact-board selection. See [TRANSPORT.md](TRANSPORT.md) before changing stops or provider behavior.

### Daily facts

`useDailyFacts()` derives an `MM-DD` key in Copenhagen time and loads exactly one static JSON file. `validDailyFacts()` checks the date, country set, and required source/image URLs before rendering. The generator is intentionally separate from runtime code; edit `data/daily-fact-overrides.json` for durable editorial changes and review generated files before committing. See [DAILY_FACTS.md](DAILY_FACTS.md).

### Radar

`RadarPanel` fetches RainViewer metadata in the browser, validates recent frames through `parseRadarTimeline()`, and builds precipitation tile URLs through `radarTileUrl()`. Leaflet is loaded only by the radar component. The map is an enhancement: an unavailable feed renders an in-panel status message and does not affect the clock or other scenes.

The metadata refreshes every five minutes with browser caching disabled, and on reconnect or visibility resume. RainViewer supplies two hours of historical frames at ten-minute intervals, not a forecast. Each appearance starts with the newest frame held for eight seconds, followed by chronological playback. The timestamp distinguishes `Latest radar` from `Radar replay` and shows the frame's age. Freshness is checked every minute against the newest frame: a frame more than 30 minutes old triggers a delay warning even if the request succeeded. Failed refreshes retain the previous timeline with a warning. RainViewer timestamps describe composite frame generation; individual radar observations may be older.

## Change guide

| If you need to change… | Start here | Also check |
| --- | --- | --- |
| Clock digits or date formatting | `lib/clock-motion.ts`, `components/clock.tsx` | `tests/clock.test.mjs`, `app/globals.css` |
| Forecast providers, payload parsing, or fallback order | `lib/forecast-sources.ts` | `tests/forecast-sources.test.mjs`, `DEPLOYMENT.md` |
| Condition or rain classification, intensity bands | `lib/weather.ts` | `tests/weather.test.mjs` |
| Forecast window, headline wording, or ribbon geometry | `lib/forecast-summary.ts` | `components/weather-panel.tsx`, `tests/forecast-summary.test.mjs` |
| Weather fetching, retry backoff, or staleness | `components/weather-panel.tsx` | `DEPLOYMENT.md`, `app/globals.css` |
| Main layout or responsive sizing | `app/globals.css` | `app/page.tsx`, reduced-motion media query |
| Right-panel timing | `lib/panel-rotation.ts` | `components/rotating-panel.tsx`, `tests/panel-rotation.test.mjs` |
| Transit stops, destinations, or normalization | `lib/transit.ts` | `app/api/departures/route.ts`, `TRANSPORT.md`, transit tests |
| Transit credentials, caching, or provider requests | `app/api/departures/route.ts` | `.env.example`, `TRANSPORT.md` |
| Daily fact content | `data/daily-fact-overrides.json` | `scripts/generate-daily-facts.mjs`, `docs/DAILY_FACTS.md` |
| Radar parsing or tile format | `lib/radar.ts`, `components/radar-panel.tsx` | `tests/radar.test.mjs` |
| Metadata or the favicon | `app/layout.tsx`, `public/` | production build |

Prefer pure functions for parsing, selection, time conversion, validation, and rotation decisions. Keep browser effects, timers, fetches, and DOM-dependent work in `*.tsx` components or route handlers. If a new external response is introduced, validate its boundary before it enters React state and add a fixture-level test for malformed data.

## Verification workflow

For a normal change:

1. Update the smallest owning module and its corresponding test.
2. Run `npm test` for behavior and `npm run lint` for code quality.
3. Run `npm run build` for the App Router, TypeScript, and production bundling check.
4. For display changes, inspect the result at both the normal 16:9 layout and the `max-aspect-ratio: 5/4` layout. Check the reduced-motion path when animations are touched.

The external weather, radar, and transit services are not required for unit tests. Provider credentials and live API verification are documented separately because they are environment-dependent.

## Time and naming conventions

- User-facing dates, hours, departures, and daily-fact keys are Copenhagen-local unless a source URL or API contract explicitly says otherwise.
- Use `Europe/Copenhagen` in every new formatter; never rely on the browser's default time zone.
- Keep provider/API types at the boundary and expose narrow normalized types to components.
- Use existing CSS tokens (`--background`, `--foreground`, `--accent`, `--rain`, `--muted`) before adding a new color.
- Keep secrets in server-only environment variables. Anything prefixed `NEXT_PUBLIC_` is eligible for the browser bundle and must not contain credentials.
