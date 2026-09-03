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
5. **Nothing may depend on interaction.** There is no pointer and no keyboard.
   `:hover` states, tooltips, and focus-only affordances are invisible to the
   only user this display has.

## Provider limits

Three external providers are called from the browser, and each has a limit worth
respecting for a display that runs unattended for weeks.

| Provider | Documented limit | What the code does about it |
| --- | --- | --- |
| DMI forecast EDR | 500 requests per 5 seconds, shared across all callers. Over it, `429 Server is busy` rather than a queue. | Asked first every refresh, and skipped for an hour after it fails so a long outage does not cost a request each time. |
| Open-Meteo `dmi_seamless` | Non-commercial fair use, CDN-cached. | The fallback, used only when DMI does not answer. Carries the same DMI Harmonie run. |
| Open-Meteo daily forecast | Same quota as the grid below; one coordinate, so one call. | The week strip under the ribbon. Fetched hourly from `components/week-strip.tsx`, about 24 calls a day, with the same backoff and keep-the-last-good-answer behaviour as the weather panel. |
| Open-Meteo forecast grid | 10,000 calls a day, 5,000 an hour, **600 a minute**, and every coordinate in a request counts as a call. Over it, `429`. | One request carries about 410 coordinates, capped at 450 so a single request cannot trip the per-minute limit. It is fetched only when Open-Meteo's per-model `meta.json` names a run the map does not hold, which is every three hours at most, never between 23:00 and 06:00, and never before the scene has been on screen once. That is about 3,000 a day, down from 6,480 when it was refetched hourly. The metadata checks are a static kilobyte, roughly fifteen a day. |
| Rejseplanen | Per-key, undocumented. | Proxied through `/api/departures`, which caches results for two minutes so every browser refresh does not become a provider request. |

The weather panel refreshes every 15 minutes and retries a failure with jittered
exponential backoff from 20 seconds to a 5-minute ceiling. The last good
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

Any change to the weather fetch must keep four properties: **there is always
more than one provider**, a failed request never clears the forecast already on
screen, retries back off rather than spin, and no code path can issue requests
faster than the refresh interval.

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

At 1280 x 720 the viewport aspect ratio is 16:9, so the main layout in
`app/globals.css` applies and the `max-aspect-ratio: 5/4` block does not. The
layout is sized in `vw`/`vh`, so it scales, but text legibility at TV viewing
distance is a separate question from layout correctness: check the real screen,
not just a resized desktop window.

Televisions may also crop the outer few percent of the picture. The
`padding: 6vh 5vw` on `.dashboard` is the margin that absorbs it. Do not reduce
it without checking the physical display.

Two browser APIs are best-effort rather than guaranteed on Silk:

- **Screen Wake Lock**, used by `components/keep-awake.tsx`. It already retries
  and degrades quietly. Verify on the device whether the screen actually stays
  on, or whether the Fire TV's own sleep timer has to be disabled instead.
- **`localStorage`**, used by `components/rotating-panel.tsx` to resume the
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
