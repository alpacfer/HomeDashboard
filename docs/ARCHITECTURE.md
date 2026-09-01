# Architecture and route map

HomeDashboard is a small, client-rendered Next.js display intended to run continuously on a 16:9 screen. The browser owns the live display state; the server only proxies the optional Rejseplanen integration so its access ID never reaches the browser.

## Routes and entry points

| URL or command | Source | Responsibility |
| --- | --- | --- |
| `/` | `app/page.tsx` | Main clock, current weather, pinned hourly forecast, and rotating right-hand panel. |
| `/api/departures` | `app/api/departures/route.ts` | Server-side Rejseplanen lookup, normalization, filtering, and two-minute public-result cache. |
| `/facts/daily/MM-DD.json` | `public/facts/daily/` | Static date-keyed facts loaded by the browser for the Copenhagen calendar date. |
| `npm run facts:generate` | `scripts/generate-daily-facts.mjs` | Deliberate rebuild of all 366 daily-fact files from reviewed overrides and external sources. |

Next.js App Router file names define the routes. Do not add a client-side routing library for display panels: `RotatingPanel` changes the panel scene in place so the URL remains stable.

## UI composition

```text
app/page.tsx (Home)
├── KeepAwake
├── Clock
│   └── clock-motion.ts (Copenhagen time/date formatting and digit transitions)
├── current weather + pinned hourly forecast
│   └── weather.ts (validated API shape, local-hour selection, rain rules)
└── RotatingPanel
    ├── TransportPanel
    │   └── transit.ts (route configuration, time conversion, filtering)
    ├── RadarPanel
    │   └── radar.ts (RainViewer response validation and tile URLs)
    └── daily fact scene
        └── daily-facts.ts (date key and payload validation)
```

`app/globals.css` is the single visual system for the display. It contains the 16:9 layout, the narrow-screen layout, panel transitions, rain emphasis, and reduced-motion behavior. Keep component markup semantic and put layout changes in this stylesheet rather than adding one-off inline styles.

## Data flow

### Clock and date

`Home` updates `now` once per second. `Clock` passes that value to `clockFrame()` for minute-based digit animation and `clockDate()` for the date below the clock. Both formatters use `Europe/Copenhagen`, so the displayed calendar date does not depend on the device's time zone. A null value is used during the first render to avoid a server/client time mismatch.

### Weather

`Home` fetches Open-Meteo directly from the browser every 15 minutes, on reconnect/visibility resume, or when the user presses Enter or `R`. `validWeather()` rejects incomplete or out-of-range payloads before state changes. `buildForecasts()` uses a compact 06:00–18:00 local window and keeps the first imminent hour plus every two-hour point and the final visible hour.

When the last visible hour of today has passed, `forecastTargets()` includes tomorrow and `buildForecasts()` removes an empty today entry when tomorrow is available. This keeps the active forecast heading on `Tomorrow` instead of showing an empty “today” state. The current weather remains available while a stale response is marked visually.

### Rotating panel

`panel-rotation.ts` is pure timing logic: transport, each daily fact, and radar each receive 30 seconds. `RotatingPanel` persists the next fact index in device-local storage and resumes at transport after the browser wakes. Artwork is preloaded in the component to reduce scene transitions without changing the data contract.

### Transport

The browser calls `/api/departures`, never Rejseplanen directly. The route reads `REJSEPLANEN_ACCESS_ID`, resolves configured stops, requests boards, and returns only normalized `TransitData`. `transit.ts` is deliberately pure and owns Copenhagen wall-clock conversion, exact stop matching, line/direction filtering, cancellation handling, and compact-board selection. See [TRANSPORT.md](../TRANSPORT.md) before changing stops or provider behavior.

### Daily facts

`useDailyFacts()` derives an `MM-DD` key in Copenhagen time and loads exactly one static JSON file. `validDailyFacts()` checks the date, country set, and required source/image URLs before rendering. The generator is intentionally separate from runtime code; edit `data/daily-fact-overrides.json` for durable editorial changes and review generated files before committing. See [DAILY_FACTS.md](DAILY_FACTS.md).

### Radar

`RadarPanel` fetches RainViewer metadata in the browser, validates recent frames through `parseRadarTimeline()`, and builds precipitation tile URLs through `radarTileUrl()`. Leaflet is loaded only by the radar component. The map is an enhancement: an unavailable feed renders an in-panel status message and does not affect the clock or other scenes.

## Change guide

| If you need to change… | Start here | Also check |
| --- | --- | --- |
| Clock digits or date formatting | `app/clock-motion.ts`, `app/clock.tsx` | `tests/clock.test.mjs`, `app/globals.css` |
| Forecast hours, day switching, or rain classification | `app/weather.ts` | `app/page.tsx`, `tests/weather.test.mjs` |
| Main layout or responsive sizing | `app/globals.css` | `app/page.tsx`, reduced-motion media query |
| Right-panel timing | `app/panel-rotation.ts` | `app/rotating-panel.tsx`, `tests/panel-rotation.test.mjs` |
| Transit stops, destinations, or normalization | `app/transit.ts` | `app/api/departures/route.ts`, `TRANSPORT.md`, transit tests |
| Transit credentials, caching, or provider requests | `app/api/departures/route.ts` | `.env.example`, `TRANSPORT.md` |
| Daily fact content | `data/daily-fact-overrides.json` | `scripts/generate-daily-facts.mjs`, `docs/DAILY_FACTS.md` |
| Radar parsing or tile format | `app/radar.ts`, `app/radar-panel.tsx` | `tests/radar.test.mjs` |
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
