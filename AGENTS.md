# AGENTS.md

Instructions for AI coding agents working in this repository. Human-facing
documentation lives in [README.md](README.md) and [docs/](docs/).

## What this is

A Next.js wall display: a clock with a wardrobe and a small resident character,
weather, a forecast map, daily facts, and local departures. It is deployed to a **Render free-plan web service** and shown
in the **Silk browser on a Fire TV Stick HD**, running 24/7 without a reload.

Both ends are resource-constrained, and that decides most design questions.
**Read [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) before adding a dependency, an
animation, a polling loop, or any server-side work.** The short version:

- Client JavaScript is the scarce resource. No UI framework, no runtime
  CSS-in-JS, no state library, no date library.
- Every timer, listener, and Leaflet layer must be torn down in effect cleanup.
  A leak invisible in a five-minute dev session kills the display overnight.
- No `:hover`, tooltips, or focus-only affordances. There is no pointer.
- The server does almost nothing on purpose. Do not move browser fetches to it.

## Commands

```sh
npm ci            # install; use this, not npm install, unless changing deps
npm run dev       # dev server on http://localhost:3000
npm run check     # lint + typecheck + test + docs + rules + build. Run before delivering.
npm test          # node:test over tests/*.test.mjs
npm run shot -- --scene map            # screenshot the running display, 1280 x 720, headless Chrome
npm run probe                          # ask every forecast provider as the browser would
npm run probe:transit                  # ask every departure provider as the route would
```

## Debugging tools

Read [docs/DEBUGGING.md](docs/DEBUGGING.md) before investigating anything on
screen. In short:

- **`npm run shot`** (`scripts/screenshot.mjs`) is how screenshots are taken.
  It needs the dev server running (start it with the preview tool, never a bare
  `npm run dev` in Bash), waits for it, and writes PNGs under `screenshots/`.
  `--clip <selector>` gives the smallest image; `--class` forces an outfit, set
  piece or Tenant pose; `--freeze` stops animations at a time; `--narrow` and
  `--reduced-motion` cover the other layouts; `--transit-demo` fills the
  departure boards with every delay and incident mark; `--sequence n` captures
  a strip of moments from one page load, which is how a moving scene is shown;
  `--console` shows what the page logged. Do not screenshot through the browser
  pane: its crop is unsupported and a hidden pane returns stale frames.
- **`npm run motion`** (`scripts/measure-motion.mjs`) is how anything that
  moves is checked. A screenshot cannot show whether an animation is smooth,
  and a flicker in the forecast map once shipped through a green `npm run
  check`, a passing suite and three correct-looking screenshots. It reports how
  evenly a canvas is painted and whether what it draws reads as movement or as
  twitching, and exits non-zero on the latter. **Run it for every change that
  animates something**, alongside the screenshot:
  `npm run motion -- --scene map --demo`.
- **`npm run probe`** (`scripts/probe-forecast.mjs`) says which forecast
  provider is answering and why the others are not. Run it first when the
  weather card is muted or shows the dot.
- **`npm run probe:transit`** (`scripts/probe-transit.mjs`) does the same for
  departures: which provider answers, what each board would show, and how every
  delay, cancellation and platform change would be marked. Run it first when
  the boards show dashes. `--headsigns` lists what each stop is signing today,
  which is how `TRANSITOUS_HEADSIGNS` is re-derived after a timetable change.
- **`/?weather=off`** stops every weather request. **Use it for every capture
  that is not about the weather.** Open-Meteo's quota is ten thousand calls a
  day per IP address, one load of the forecast map costs about three hundred,
  and the display shares the address with this machine. A day of screenshots
  against `?scene=map` once spent the whole quota and muted the display. The
  limits and the arithmetic are in `lib/open-meteo-quota.ts`; a `429` locks
  Open-Meteo out for every component until the limit it names resets.
- **`/?weather=demo`** (`npm run shot -- --demo`) makes no request either but
  draws a synthetic forecast on the map. Use it for any capture **of** the map:
  headless Chrome starts each run with an empty profile, so `?weather=off`
  shows nothing and a live capture buys three hundred coordinates every time.
- **`/?time=HH:MM`** pins the clock to a Copenhagen time (`npm run shot --
  --time 08:46`), so an outfit can be checked against chosen digits.
- **`/?transit=demo`** (`npm run shot -- --transit-demo`) draws the departure
  boards from a synthetic answer holding a cancellation, a long delay, an early
  departure, a platform change and two service messages, asking no provider.
  Use it for any capture of how a delay or an incident is marked: a live feed
  will not produce one to order.
- Weather failures are logged as one `[weather] every provider failed: ...`
  line naming each provider and its reason.

`npm start` binds `127.0.0.1` and is local-only. Render uses
`npm run start:render`, which binds `0.0.0.0`.

## Layout

Dependencies point inward: `app/` → `components/` → `lib/`. Nothing points back.

| Directory | Holds |
| --- | --- |
| `app/` | Route entry points only: `layout.tsx`, `page.tsx`, `globals.css`, `app/api/departures/route.ts`. |
| `components/` | React components that own browser effects: timers, fetches, storage, Leaflet, wake lock. |
| `lib/` | Pure logic: parsing, validation, time conversion, selection, rotation timing. |
| `tests/` | One `node:test` suite per `lib/` module. |
| `scripts/` | Maintenance and debugging tooling, and the Claude Code hooks in `scripts/hooks/`. Plain Node, no dependencies. |

`lib/` may not import React, the DOM, `fetch`, or Next.js. This is enforced by
`eslint.config.mjs`, so lint will tell you before review does.

Cross-directory imports use the `@/` alias (`@/lib/weather`). Relative imports
are for siblings only.

## Rules

**New logic goes in `lib/` with a test unless it genuinely needs the browser.**
That is what keeps the suite fast and renderer-free. When you add a component,
ask what part of it is a pure function and move that part out first.

**Validate every external response at the boundary** before it reaches React
state, and add a fixture test for the malformed case. `validWeather`,
`parseRadarTimeline`, and `validDailyFacts` are the pattern to copy.

**Use `Europe/Copenhagen` in every formatter.** Never rely on the device's time
zone. Dates, hours, departures, and daily-fact keys are Copenhagen-local unless
an API contract explicitly says otherwise.

**Put layout in `app/globals.css`**, not in inline styles. Use the existing
tokens (`--background`, `--foreground`, `--accent`, `--rain`, `--muted`) before
adding a colour.

**Keep secrets server-side.** `REJSEPLANEN_ACCESS_ID` and `DEEPL_API_KEY` are
read only by `app/api/departures/route.ts`. Anything prefixed `NEXT_PUBLIC_` ships to the
browser and must never hold a credential. Never commit `.env.local`.

**Scripts stay in Node, not shell.** The repository is worked on from both
Ubuntu and macOS, where `sed`, `date`, and friends differ.

**Every fetch gets its own AbortController and a deadline.** A shared signal
stays aborted once it fires, and a request that never settles leaves a
`pending` flag set for good. Both end all refreshing on a display nobody
reloads. Copy the pattern in `components/weather-panel.tsx`.

**Anything read back from device storage goes through a validator in `lib/`.**
Storage is an input like a provider: a previous build may have written a
different shape. See `components/device-storage.ts`.

**Never spend the display's quota from a development machine.** The Fire TV and
this machine share one Open-Meteo quota. Pass `--offline` to `npm run shot`,
add `?weather=off` to any URL you load by hand unless the weather is the
subject (or `?weather=demo` when the forecast map is the subject), and never
run `npm run probe -- --grid` in a loop.

## Rules that are enforced for you

These run without being asked, so a violation is reported before review:

- `eslint.config.mjs`: `lib/` purity; `components/` never imports `app/`;
  every `Intl.DateTimeFormat` names a `timeZone`; no `toLocale*String`.
- `scripts/check-rules.mjs` (in `npm run check` and CI): no `:hover` or
  `cursor` in the CSS; every `lib/` module has a test; every timer, listener,
  animation frame and Leaflet map in a component has its teardown; no
  `NEXT_PUBLIC_` credential names; Render's start script exists; hooks exist;
  the font stylesheet matches the face list.
- `.claude/settings.json` hooks: `scripts/hooks/guard-generated.mjs` refuses
  edits to generated files and names the regenerating command;
  `scripts/hooks/lint-changed.mjs` lints each written file and, before a turn
  ends, lints and typechecks everything changed and runs the tests when `lib/`
  or `tests/` changed. A failure keeps the turn open with the output shown.

When one of these fires, fix the cause. Do not disable the rule, and do not
work around a hook by editing through Bash, unless Alejandro asked for exactly
that edit.

**Documentation is checked.** `npm run docs:check` fails when a Markdown file
links to or names a path that does not exist. If you move a file, fix the docs
in the same change.

## Do not touch without being asked

- `public/facts/daily/*.json` — 366 generated files. Change
  `data/daily-fact-overrides.json` and run `npm run facts:generate` instead.
  See [docs/DAILY_FACTS.md](docs/DAILY_FACTS.md).
- `lib/transit.ts` stop names and `lib/transitous.ts` headsigns — these match
  a live provider's exact strings and fail closed when wrong. The two providers
  do not use the same destination strings; `docs/TRANSPORT.md` has the table.
- `public/fonts/clock/*.woff2` and `app/clock-fonts.css` — generated by
  `npm run fonts:clock` from the face list in `scripts/fetch-clock-fonts.mjs`.
  Edit the list and rerun. See [docs/CLOCK.md](docs/CLOCK.md).
- `render.yaml` — must stay in step with the live Render dashboard.

## Visual confirmation

For every requested change that affects rendered behaviour, run the dashboard
and capture a screenshot of the relevant state before delivering. Show that
screenshot in the final response.

Take it with `npm run shot` (see Debugging tools above). Use the smallest
screenshot that demonstrates the change: `--clip .clock-block` for a clock
change, `--clip .weather-band` for the weather card, the relevant panel for a
rotating-panel change. To reach a rotating scene without waiting for the
cycle, pin it with `--scene map`, `--scene transport` or
`--scene fact --fact N` (the `/?scene=` debug mode in [README.md](README.md)),
and pass `--offline` unless the weather is the subject, or `--demo` when the
forecast map is.
Recheck both the 16:9 layout and the narrow (`max-aspect-ratio: 5/4`) layout
(`--narrow`) when responsive CSS is affected, and check the reduced-motion path
(`--reduced-motion`) when animation is touched. **Test at 1280 x 720**, the Fire
TV's actual resolution, which is the script's default.

For documentation-only, test-only, or backend-only changes with no meaningful
rendered state, say in the final response that no relevant screenshot was
available rather than showing an unrelated screen.

## Delivering

1. Implement the change.
2. Run `npm run check`.
3. Capture and show the relevant visual state when the UI changed.
4. Link the changed files and report verification results honestly. If a check
   failed or was skipped, say so.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
