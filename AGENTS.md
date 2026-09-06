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
npm run audit                          # every scene at 1280 x 720, checked for layout faults
npm run scene -- --offline             # measure a painted card: edges, landmarks, light
npm run facts:generate                 # rebuild the calendar from the local cache, seconds
npm run facts:generate -- --refresh    # re-ask Wikimedia for everything, ~20 minutes
```

## Debugging tools

**Read [docs/DEBUGGING.md](docs/DEBUGGING.md) before investigating anything on
screen.** It explains what each tool is for and why it exists; this is the
index and the two rules that are not negotiable.

| Tool | Reach for it when |
| --- | --- |
| `npm run audit` | **After any CSS or layout change**, before a screenshot. All seven scenes in ~30 s, as text; `--json` for the findings as data. Exits 1 on an error. |
| `npm run motion` | **After any change that animates something.** A screenshot cannot show whether an animation is smooth. Exits 1 on a fault. |
| `npm run shot` | The picture, once the two above are clean. `--clip` for the smallest useful image. |
| `npm run scene` | Before nudging a number that has to agree with the artwork: it measures a painted card's real edges, landmarks and light. |
| `npm run states` | Looking at the clock's sky. Twenty states on one sheet; `--seams` finds clipped gradients, `--baseline` says what moved. |
| `npm run roll` | The digit transition, which lasts under a second on the minute boundary. |
| `npm run probe` | The weather card is muted or showing the dot. |
| `npm run probe:transit` | The departure boards show dashes. |

Two rules:

- **Never spend the display's quota from a development machine.** Open-Meteo
  allows ten thousand calls a day per IP address, one load of the forecast map
  costs about three hundred, and the Fire TV shares this address. A day of
  screenshots against `?scene=map` once spent the whole quota and muted the
  display. So: `--offline` (`?weather=off`) for every capture that is not about
  the weather, `--demo` (`?weather=demo`) when the forecast map *is* the
  subject, and never `npm run probe -- --grid` in a loop. The arithmetic is in
  `lib/open-meteo-quota.ts`; a `429` locks Open-Meteo out for every component
  until the limit it names resets. Google's tier is monthly, so a spent one
  stays spent until the first of the month.
- **Do not screenshot through the browser pane.** Its crop is unsupported and a
  hidden pane returns stale frames. The dev server must be running for any of
  these; start it with the preview tool, never a bare `npm run dev` in Bash.

The URL flags these tools set — `?weather=off|demo|dry|none`, `?time=`,
`?scene=`, `?transit=demo`, `?sky=`, `?clock=`, `?date=`, `?pet=` — are listed
with what each one is for in [docs/DEBUGGING.md](docs/DEBUGGING.md#url-flags).
Weather failures are logged as one `[weather] every provider failed: ...` line
naming each provider and its reason.

`npm start` binds `127.0.0.1` and is local-only. Render uses
`npm run start:render`, which binds `0.0.0.0`.

## Layout

Dependencies point inward: `app/` → `components/` → `lib/`. Nothing points back.

| Directory | Holds |
| --- | --- |
| `app/` | Route entry points and stylesheets only: `layout.tsx`, `page.tsx`, the six `*.css` files, and the two routes `app/api/departures/route.ts` and `app/api/weather/route.ts`. |
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
state, and add a fixture test for the malformed case. `validWeatherHours`
(`lib/weather.ts`), `parsePrecipitationGrid` (`lib/precipitation-grid.ts`) and
`validDailyFacts` (`lib/daily-facts.ts`) are the pattern to copy.

**Use `Europe/Copenhagen` in every formatter.** Never rely on the device's time
zone. Dates, hours, departures, and daily-fact keys are Copenhagen-local unless
an API contract explicitly says otherwise.

**Put layout in a stylesheet, not in inline styles.** `app/globals.css` is
the shared system; the Tenant is `app/tenant.css` and each clock theme has its
own file. Use the existing tokens (`--background`, `--foreground`, `--accent`,
`--rain`, `--muted`) before adding a colour.

**Keep secrets server-side.** `REJSEPLANEN_ACCESS_ID` and `DEEPL_API_KEY` are
read only by `app/api/departures/route.ts`, and `GOOGLE_WEATHER_API_KEY` only
by `app/api/weather/route.ts`. Anything prefixed `NEXT_PUBLIC_` ships to the
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
this machine share one Open-Meteo quota and one Google Cloud project. The
arithmetic and the flags are under "Debugging tools" above.

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
  ends, lints and typechecks everything changed, runs the tests when `lib/` or
  `tests/` changed, and runs `check:rules` and `docs:check` whenever anything
  they cover changed — including a stylesheet, which eslint cannot read. A
  failure keeps the turn open with the output shown.

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
- `render.yaml` — must stay in step with the live Render dashboard, which is
  the source of truth. Change the dashboard first.
- `package-lock.json` — written by npm. Change `package.json` and run
  `npm install`.

`scripts/hooks/guard-generated.mjs` refuses an edit to each of these and names
the command instead, and `npm run check:rules` keeps its list and this one in
step. The two transit entries are the exception: those files are mostly
ordinary logic, so the hook leaves them alone and this rule is the only thing
guarding the strings.

## Visual confirmation

For every requested change that affects rendered behaviour, run the dashboard
and capture a screenshot of the relevant state before delivering. Show that
screenshot in the final response.

Run `npm run audit` first: it is faster than a capture, it covers every scene
at once, and a screenshot that looks right can still be clipping content or
wrapping a marker onto its own line. Then take the picture with `npm run shot`
(see Debugging tools above). Use the smallest
screenshot that demonstrates the change: `--clip .clock-widget` for a clock
change, `--clip .weather-band` for the weather card, the relevant panel for a
rotating-panel change. To reach a rotating scene without waiting for the
cycle, pin it with `--scene map`, `--scene transport` or
`--scene fact --fact N` (the `/?scene=` debug mode in [README.md](README.md)),
and pass `--offline` unless the weather is the subject, or `--demo` when the
forecast map is.
Check the reduced-motion path (`--reduced-motion`) when animation is touched.
**Test at 1280 x 720**, the Fire TV's actual and only supported resolution,
which is the script's default.

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
