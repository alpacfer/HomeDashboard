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

Where to read before changing something:

| If you are changing | Read first |
| --- | --- |
| Anything on screen, a timer, a fetch, a dependency | [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) |
| Where a piece of code belongs, or the data flow | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| The clock, its sky, the painted shed or the Tenant | [docs/CLOCK.md](docs/CLOCK.md) |
| The forecast map, the grid or the living-map sheets | [docs/FORECAST_MAP.md](docs/FORECAST_MAP.md) |
| Departures, stop names, headsigns, delay marking | [docs/TRANSPORT.md](docs/TRANSPORT.md) |
| The daily facts, their selection or the overrides | [docs/DAILY_FACTS.md](docs/DAILY_FACTS.md) |
| How to see, measure or diagnose any of it | [docs/DEBUGGING.md](docs/DEBUGGING.md) |

## Commands

```sh
npm ci            # install; use this, not npm install, unless changing deps
npm run dev       # dev server on http://localhost:3000
npm run check     # lint + typecheck + test + docs + rules + build. Run before delivering.
npm test          # node:test over tests/*.test.mjs
npm run shot -- --scene map            # screenshot the running display, 1280 x 720, headless Chrome
npm run shot -- --offline --clip .clock-widget --then --sky night,clear   # several states, one browser
npm run probe                          # ask every forecast provider as the browser would
npm run probe:transit                  # ask every departure provider as the route would
npm run audit                          # every scene at 1280 x 720, checked for layout faults
npm run scene -- --offline             # measure a painted card: edges, landmarks, light
npm run facts:generate                 # rebuild the calendar from the local cache, seconds
npm run facts:generate -- --refresh    # re-ask Wikimedia for everything, ~20 minutes
npm run facts:stats                    # the calendar by the numbers; every figure in DAILY_FACTS.md
npm run agents:sync                    # rewrite the Codex copies of .claude/ after editing it
```

## Debugging tools

**Read [docs/DEBUGGING.md](docs/DEBUGGING.md) before investigating anything on
screen.** It explains what each tool is for and why it exists; this is the
index and the two rules that are not negotiable.

| Tool | Reach for it when |
| --- | --- |
| `npm run audit` | **After any CSS or layout change**, before a screenshot. All seven scenes in ~30 s, as text; `node scripts/audit-ui.mjs --json` for the findings as data. `--save-baseline` before a change and `--baseline` after says which elements moved. Exits 1 on an error. |
| `npm run motion` | **After any change that animates something.** A screenshot cannot show whether an animation is smooth, and it cannot show a shape scaled through nothing for part of a cycle; this reports both. Exits 1 on a fault. |
| `npm run shot` | The picture, once the two above are clean. `--clip` for the smallest useful image; `--then` for several states in one browser (about 5 s each, not 35); `--pose "<sel>=<phase>"` to hold a moving element at a chosen moment. |
| `npm run scene` | Before nudging a number that has to agree with the artwork: it measures a painted card's real edges, landmarks and light. |
| `npm run states` | Looking at the clock's sky. Twenty states on one sheet; `--seams` finds clipped gradients, `--baseline` says what moved. |
| `npm run roll` | The digit transition, which lasts under a second on the minute boundary. |
| `npm run horizon` | **After changing a painting in `public/scenes`.** Retraces the sky's outline and the shed window's panes off the plates and rewrites `app/horizon.css`. Look at the two overlays it draws. |
| `python3 assets/map-design/segment-map.py` | **After changing a painting in `public/maps`.** Recuts the nine living-map sheets — water, night lights and cloud shadow — out of the plates. Needs numpy, scipy and Pillow; deterministic, so an unchanged plate gives the same bytes. |
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
  **Port 3000 is usually already held by another session's server in this
  folder.** That server serves this working tree, so use it: attach the pane
  with the `homedashboard-attach` configuration, or just run the scripts, which
  only need the URL. Do not stop to ask about the port.

Three habits that save the most time with these tools:

- **`npm run <tool> -- --help` prints every flag.** Read that rather than
  slicing `docs/DEBUGGING.md` for a flag name; the doc is for why, the header
  is for what.
- **One command for several states.** `npm run shot -- <base> --then <changes>
  --then <changes>` captures each in the same browser. A shell loop of
  `npm run shot` launches a Chrome per state and has timed out the Bash tool
  four times.
- **A one-off browser measurement imports `scripts/lib/browser.mjs`.** It finds
  Chrome, waits for the server, builds the URL from the same flags and cleans
  up after itself. Never spawn Chrome by hand from a scratch script, and fold
  anything measured twice into `scripts/`.

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
| `app/` | Route entry points and stylesheets only: `layout.tsx`, `page.tsx`, the seven `*.css` files, and the two routes `app/api/departures/route.ts` and `app/api/weather/route.ts`. |
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
Ubuntu and macOS, where `sed`, `date`, and friends differ. Everything in
`scripts/` is Node and stays that way: those are the tools npm runs, on two
operating systems, in CI. There is one file outside that rule —
[assets/map-design/segment-map.py](assets/map-design/segment-map.py), which cuts
the living map's sheets out of the painted plates. It runs by hand, roughly
never, its output is committed, and it is in `assets/` rather than `scripts/`
precisely so it is not mistaken for part of the build. Doing its segmentation in
Node would mean a new dependency in a repository that guards its dependency list
carefully.

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
  `cursor` in the CSS; a tiling layer's travel equals its tile, on
  `background-size` and on `mask-size` alike; no keyframe scales a shape
  negative or under 0.15 unless that frame is also at opacity 0 (a stroked
  shape scaled through nothing draws as a dash; fade it instead, or mark the
  block `/* rules: allow-collapse */` with the reason); every drawing in `public/scenes/`
  parses and carries `preserveAspectRatio="none"`, and every mask a stylesheet
  names exists — all three of those fail silently in the browser, which shows a
  broken or letterboxed mask as no mask and makes the layer wearing it
  disappear; every `lib/` module has a test; every timer, listener,
  animation frame and Leaflet map in a component has its teardown; no
  `NEXT_PUBLIC_` credential names; Render's start script exists; hooks exist;
  the font stylesheet matches the face list; the Codex copies of the agent
  configuration match `.claude/`.
- `.claude/settings.json` hooks: `scripts/hooks/guard-generated.mjs` refuses
  edits to generated files and names the regenerating command;
  `scripts/hooks/guard-bash.mjs` refuses the shell commands that throw work
  away (a forced push, `git reset --hard`, `git checkout --`, `git restore`,
  `git clean`, `rm -r` outside the temp directory, `screenshots/`, `.next/`
  and `node_modules/`) and any `sed -i`, redirect, `tee`, `cp` or `mv` aimed
  at a generated file; `scripts/hooks/lint-changed.mjs` lints each written
  file and, before a turn
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

- `public/facts/daily/*.json` — 366 dated files and an index, all generated. Change
  `data/daily-fact-overrides.json` and run `npm run facts:generate` instead.
  See [docs/DAILY_FACTS.md](docs/DAILY_FACTS.md).
- `lib/transit.ts` stop names and `lib/transitous.ts` headsigns — these match
  a live provider's exact strings and fail closed when wrong. The two providers
  do not use the same destination strings; `docs/TRANSPORT.md` has the table.
- `public/fonts/clock/*.woff2` and `app/clock-fonts.css` — generated by
  `npm run fonts:clock` from the face list in `scripts/fetch-clock-fonts.mjs`.
  Edit the list and rerun. See [docs/CLOCK.md](docs/CLOCK.md).
- `app/horizon.css` — the outline of the painted sky and of the shed window's
  glass, traced off `public/scenes/*.webp` by `npm run horizon`. It is read
  pixels, not taste: change the paintings and rerun the tool. See
  [docs/CLOCK.md](docs/CLOCK.md).
- `public/maps/map-{water,lights,shadow}-*.webp` — the nine living-map sheets,
  cut out of the painted plates by
  `python3 assets/map-design/segment-map.py`. Their alpha is the coastline, the
  city's lamps and the cloud shadow; hand-editing one desynchronises it from the
  other two of its kind and the cross-fade stops summing flat. Change the
  plates or the script and rerun it. See
  [docs/FORECAST_MAP.md](docs/FORECAST_MAP.md).

- `render.yaml` — must stay in step with the live Render dashboard, which is
  the source of truth. Change the dashboard first.
- `package-lock.json` — written by npm. Change `package.json` and run
  `npm install`.
- `.codex/hooks.json` and `.agents/skills/source-command-*/SKILL.md` — the
  Codex copies of `.claude/settings.json` and `.claude/commands/*.md`, written
  by `npm run agents:sync`. Edit the `.claude/` original and rerun it.

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
forecast map is. When the change has several states, capture them in one
command with `--then`, one file each.
Check the reduced-motion path (`--reduced-motion`) when animation is touched.
**Test at 1280 x 720**, the Fire TV's actual and only supported resolution,
which is the script's default.

For documentation-only, test-only, or backend-only changes with no meaningful
rendered state, say in the final response that no relevant screenshot was
available rather than showing an unrelated screen.

## Delivering

The `/deliver` command walks this list.

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
