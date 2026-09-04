# Deployment and target environment

Two constrained environments bracket this project, and together they decide most
design questions. Read this before adding a dependency, an animation, a polling
loop, or anything that runs on the server.

```text
  Render free-plan web service  ──HTTPS──>  Fire TV Stick HD, Silk browser
  512 MB RAM, shared CPU                    720p output, weak GPU, old Chromium
  sleeps when idle                          runs 24/7, never reloaded by hand
```

## The rules that follow from it

1. **The server does almost nothing.** Only `/api/departures` runs server-side,
   and only because the Rejseplanen access ID must not reach the browser.
   Everything else is static or fetched by the browser directly. Do not move
   weather, the forecast map, or daily facts to the server to "clean things up": that
   trades a free CDN-cached asset for paid instance memory. Weather stays in
   the browser because both its providers are keyless and send
   `Access-Control-Allow-Origin: *`. The older `dmigw.govcloud.dk` DMI host
   still works but requires a key; switching to it would force a proxy route
   and is not worth it.
2. **Client JavaScript is the scarce resource, not server CPU.** The Fire TV
   Stick decodes and executes every byte on a slow core. Leaflet is already the
   heaviest thing shipped and is loaded only by `components/forecast-map-panel.tsx`,
   when the forecast map scene first appears. Keep it that way. No UI framework, no
   runtime CSS-in-JS, no state library, no date library: `Intl` and
   `app/globals.css` cover this display.
3. **Long-lived means leaks matter.** The display runs for weeks without a
   reload. Every `setInterval`, `setTimeout`, event listener, and Leaflet layer
   must be torn down in its effect cleanup. A leak that is invisible in a
   five-minute dev session will exhaust the stick's memory overnight.
4. **Animation budget is small.** Prefer `transform` and `opacity`, which the
   compositor can handle, over layout- or paint-triggering properties. The
   forecast map animation is the most expensive thing on screen; treat its
   frame timing in `components/forecast-map-panel.tsx` as a performance budget,
   and note it is also budgeted against `MAP_MS` in `lib/panel-rotation.ts`.
   The clock's set pieces and its character are held to the same rule: every
   set piece is `transform` and `opacity` on four cells, and the two exceptions
   (the "ink" and "morph" pieces, which animate `clip-path` and variable-font
   axes) run for three seconds at most, a few times an hour. If the stick
   stutters, disable those two first. See [CLOCK.md](CLOCK.md).
   The clock's outfit fonts are 22 subset woff2 files, about 0.9 MB in all,
   but each is fetched only the first time its outfit is worn and cached from
   then on; the display never downloads more than one at a time.
5. **Nothing may depend on interaction.** There is no pointer and no keyboard.
   `:hover` states, tooltips, and focus-only affordances are invisible to the
   only user this display has.

## Provider limits

Four external providers are called from the browser, and each has a limit worth
respecting for a display that runs unattended for weeks. The one that matters
most is Open-Meteo's, because it is counted **per client IP address**: the Fire
TV, the machines the project is developed on and every screenshot session share
the home connection's quota. See [DEBUGGING.md](DEBUGGING.md) for the day it ran
out and what now prevents that.

| Provider | Documented limit | What the code does about it |
| --- | --- | --- |
| DMI forecast EDR | 500 requests per 5 seconds, shared across all callers. Over it, `429 Server is busy` rather than a queue. | Asked first every refresh, and skipped for an hour after it fails so a long outage does not cost a request each time. |
| Open-Meteo `dmi_seamless` | Shares the 10,000-call daily quota below. | The second opinion, used only when DMI does not answer. Carries the same DMI Harmonie run. Not asked at all while a `429` from any Open-Meteo request on the device says the quota is spent: the lockout in `components/open-meteo-lockout.ts` lasts until the limit it names resets, midnight UTC for the daily one, and is shared with the week strip and the map. |
| MET Norway Locationforecast | 20 requests a second per application; honour the `Expires` header; coordinates truncated to four decimals; identification by `Origin` for browser clients. | The third opinion for the hours and the second for the week, on its own model and its own quota, so both DMI routes can be down without the display going stale. Fetched with the browser's HTTP cache enabled so `Expires` is respected, and one URL serves both panels. |
| Open-Meteo daily forecast | Same quota as the grid below; one coordinate, so one call. MET Norway behind it. | The week strip under the ribbon. Fetched hourly from `components/week-strip.tsx`, about 24 calls a day, with the same backoff and keep-the-last-good-answer behaviour as the weather panel. |
| Open-Meteo forecast grid | 10,000 weighted calls a day, 5,000 an hour, **600 a minute**, per client IP address. A request weighs `locations × max(1, days / 14) × max(1, variables / 10)`, so every coordinate in it counts as a call (`lib/open-meteo-quota.ts`). Over it, `429`. | One request carries about 285 coordinates at the Fire TV's frame: a 3 km lattice, since Harmonie's effective resolution is several times its 2 km grid and the field is smoothed when drawn, so nothing the map could show is lost. The lattice is capped at 450 points so a single request cannot trip the per-minute limit, and bounded to a 7.8 KB URL because Open-Meteo's nginx answers a request line over 8 KB with a `414` that carries no CORS header and reaches the browser as a plain network failure. It is fetched when Open-Meteo's per-model `meta.json` names a run the map does not hold, or when fewer frames remain ahead of now than the map shows (the metadata has been seen stuck or answering `500` for hours while the forecast kept updating), which is every three hours at most, never between 23:00 and 06:00, never before the scene has been on screen once, and never while a `429` has locked Open-Meteo out. That is about 1,700 a day, down from 3,000 at 2.4 km and 6,480 when it was refetched hourly. The metadata checks are a static kilobyte, roughly fifteen a day. |
| Rejseplanen | Per-key, undocumented. | Proxied through `/api/departures`, which caches results for two minutes so every browser refresh does not become a provider request. |

The weather panel refreshes every 15 minutes and retries a failure with jittered
exponential backoff from 20 seconds to a 5-minute ceiling. The last good answer
from every provider is also kept in device storage and restored on load, so a
reload shows a forecast at once and, for the map, costs no grid request while
the stored model run is still the current one. The last good
forecast stays on screen throughout, whichever provider supplied it.

**DMI answering `429` is normal, not an outage, and it is why there are two
providers.** The limit is shared, so a busy moment upstream is enough to trigger
it. During DMI's supercomputer maintenance it answered `429` to every request
for hours and the display had no forecast at all, which is not an acceptable
failure mode for a screen nobody reloads. `lib/forecast-sources.ts` therefore
asks DMI first and falls back to Open-Meteo's `dmi_seamless`, which is the same
Harmonie run: values were checked field by field against a direct DMI capture
and match. Both parsers return the identical `WeatherHour`, so which provider
answered never changes what the display says, only the credit line.

Any change to the weather fetch must keep five properties: **there is always
more than one provider**, a failed request never clears the forecast already on
screen, retries back off rather than spin, no code path can issue requests
faster than the refresh interval, and a provider that has said its quota is
spent is not asked again by anything on the device before that quota resets.

**Do not poll DMI while developing.** Repeated probing during this integration
saturated the shared limit and locked the endpoint out for minutes at a time,
which is both self-defeating and rude to every other caller. Work against
`tests/fixtures/dmi-harmonie-hourly.json`, a real captured response of the DMI
Harmonie run, and take one live request only to confirm the finished change. If
a live payload is needed, fetch it once and save it: never put a retry loop on
this API. Read the API documentation before probing it, too. Three requests were
spent guessing the native-CRS `bbox` format for cube queries when the answer was
in DMI's own EDR documentation all along.

DMI free data is licensed **CC BY 4.0 and attribution is mandatory**. The
weather icon links to DMI's terms of use and carries the credit in its
accessible label. Do not remove that link.

## Render

The service was created through the Render dashboard, so **the dashboard is the
source of truth**, not this file. `render.yaml` in the repository root records
the intended configuration for reference and for rebuilding the service, but
Render only applies it to services created from a Blueprint. Change one, check
the other.

| Setting | Value | Why |
| --- | --- | --- |
| Instance type | Free | 512 MB RAM, shared CPU. |
| Build command | `npm ci && npm run build` | `npm ci` for a lockfile-exact install. |
| Start command | `npm run start:render` | Binds `0.0.0.0` so Render's proxy can reach it. |
| Node version | from `.nvmrc` | Same version as local and CI. |
| Health check path | `/` | The one static route. |
| Environment | `REJSEPLANEN_ACCESS_ID`, `SITE_URL` | Set in the dashboard. Never committed. |

**`npm start` will not work on Render.** It binds `127.0.0.1`, which is
deliberate for local use and fatal behind Render's proxy. Use
`npm run start:render`, which binds `0.0.0.0` and honours Render's `PORT`.

### Sleeping and cold starts

A free web service sleeps after roughly 15 minutes with no inbound request, and
the next request pays a cold start of tens of seconds. In practice the
dashboard prevents this itself: `components/transport-panel.tsx` polls
`/api/departures` every 120 seconds, so the service stays awake for as long as
the TV is showing it. Cold starts are therefore only visible after the TV has
been off.

Do not add an external uptime pinger to avoid that. Free instance hours are
capped per account per month, and pinging a display nobody is watching spends
them for nothing.

### Build memory

The build runs on the free plan too, and Next.js builds are the most
memory-hungry step in the project. If a build starts failing with an
out-of-memory kill rather than a compile error, the cause is usually a newly
added dependency rather than the application code.

## Fire TV Stick HD

| Property | Value | How to confirm |
| --- | --- | --- |
| Output resolution | 1280 x 720 | Fire TV display settings. |
| Browser | Amazon Silk, Chromium-based, lags mainline Chromium | Load the dashboard and read `navigator.userAgent`. |
| Input | Remote only. No pointer, no hover, no keyboard. | — |

**The Silk Chromium version is not yet recorded here.** It sets the real
baseline for JavaScript and CSS features, and guessing it is worse than leaving
it blank. Read the user agent string on the device, write the version into the
table above, and only then consider adding a `browserslist` key to
`package.json` to pin build output to that baseline.

The only supported viewport is 1280 x 720 (16:9). The layout is sized in
`vw`/`vh` for that display, but text legibility at TV viewing distance is a
separate question from layout correctness: check the real screen, not just a
resized desktop window.

Televisions may also crop the outer few percent of the picture. The
`padding: 6vh 5vw` on `.dashboard` is the margin that absorbs it. Do not reduce
it without checking the physical display.

Two browser APIs are best-effort rather than guaranteed on Silk:

- **Screen Wake Lock**, used by `components/keep-awake.tsx`. It already retries
  and degrades quietly. Verify on the device whether the screen actually stays
  on, or whether the Fire TV's own sleep timer has to be disabled instead.
- **`localStorage`**, used by `components/weather-panel.tsx`,
  `components/week-strip.tsx` and `components/forecast-map-panel.tsx` to keep
  the last good forecast (`home-dashboard:forecast-*:v1`, read back through
  validators in `lib/`), and by `components/rotating-panel.tsx` to resume the
  fact index. A failure there must never break the rotation.

## Verifying a change against this environment

Local checks catch correctness, not fitness for the target. Before delivering
anything that touches the UI or dependencies:

1. Run `npm run check`.
2. Read the route table `npm run build` prints. Client JS growth is the number
   that matters for the Fire TV, and a jump means a dependency landed in the
   browser bundle.
3. Test the layout at exactly 1280 x 720, not just at the browser's default
   window size.
4. For anything long-running, leave it open and confirm timers and listeners
   are cleaned up on scene change.
