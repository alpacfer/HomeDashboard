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
   weather, radar, or daily facts to the server to "clean things up": that
   trades a free CDN-cached asset for paid instance memory.
2. **Client JavaScript is the scarce resource, not server CPU.** The Fire TV
   Stick decodes and executes every byte on a slow core. Leaflet is already the
   heaviest thing shipped and is loaded only by `components/radar-panel.tsx`,
   when the radar scene first appears. Keep it that way. No UI framework, no
   runtime CSS-in-JS, no state library, no date library: `Intl` and
   `app/globals.css` cover this display.
3. **Long-lived means leaks matter.** The display runs for weeks without a
   reload. Every `setInterval`, `setTimeout`, event listener, and Leaflet layer
   must be torn down in its effect cleanup. A leak that is invisible in a
   five-minute dev session will exhaust the stick's memory overnight.
4. **Animation budget is small.** Prefer `transform` and `opacity`, which the
   compositor can handle, over layout- or paint-triggering properties. The
   radar frame animation is the most expensive thing on screen; treat its
   timing constants in `components/radar-panel.tsx` as a performance budget.
5. **Nothing may depend on interaction.** There is no pointer and no keyboard.
   `:hover` states, tooltips, and focus-only affordances are invisible to the
   only user this display has.

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
