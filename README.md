# HomeDashboard

A home display with a clock, local weather with the week ahead, an animated precipitation forecast map,
daily facts, and local departures. It runs on a Render free-plan web service and
is shown continuously in the browser on a Fire TV Stick HD.

## Project map

The implementation and operational notes are split by responsibility:

- [Architecture and route map](docs/ARCHITECTURE.md) — app composition, data flow, time-zone rules, and where to make common changes.
- [Deployment and target environment](docs/DEPLOYMENT.md) — Render free-plan settings, Fire TV Stick limits, and the constraints they place on every change.
- [Transit integration](docs/TRANSPORT.md) — the two providers and why, credentials, stop and headsign matching, how delays and incidents are marked, caching and quota.
- [Daily facts](docs/DAILY_FACTS.md) — what counts as a fact worth showing, how the calendar is selected, editorial overrides, attribution, and the regeneration workflow.
- [Debugging](docs/DEBUGGING.md) — the screenshot and provider-probe tools, the URL flags, provider quotas, and why a card is muted.
- [AGENTS.md](AGENTS.md) — the working contract for AI coding agents. `CLAUDE.md` imports it.

The dashboard has one page route (`/`), one server API route
(`/api/departures`), and static daily-fact assets under `/facts/daily/`. There
is no client-side router.

## Repository layout

Dependencies point inward: `app/` → `components/` → `lib/`, and nothing points
back. `lib/` may not import React, the DOM, `fetch`, or Next.js, which is
enforced by `eslint.config.mjs` rather than left to convention.

```text
app/         route entry points only (layout, page, globals.css, api/departures)
components/  React components that own browser effects
lib/         pure logic: parsing, validation, time conversion, selection
tests/       one node:test suite per lib/ module
scripts/     maintenance tooling, plain Node with no dependencies
docs/        the documents listed above
```

Cross-directory imports use the `@/` alias, for example `@/lib/weather`.

## Run on your computer

The repository is developed on both Ubuntu and macOS. `.nvmrc` pins the Node
version that local machines, CI, and Render all use; with `nvm` or `fnm`
installed, `nvm use` picks it up.

```sh
npm ci
npm run dev
```

Open http://localhost:3000. Stop the server with Ctrl+C.

For a production build:

```sh
npm run build
npm start
```

`npm start` listens on this computer only. To deliberately expose it on your
network, run `npm start -- --hostname 0.0.0.0` after building. Render uses
`npm run start:render`, which binds `0.0.0.0` by default. See
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

### Pin a scene

The right-hand panel rotates through transport, a daily fact and the forecast
map on a one-minute cycle. To hold one scene on screen, name it in the URL:

```text
http://localhost:3000/?scene=map
http://localhost:3000/?scene=transport
http://localhost:3000/?scene=fact&fact=1
```

`scene` is `transport`, `fact` or `map`. `fact` is the zero-based index of the
daily fact and wraps. Add `&date=MM-DD` to show another calendar date's facts
instead of today's, which is the only way to look at a fact that is not
today's. A pinned display shows a `Pinned` badge where the
rotation ring normally is, schedules nothing, and never leaves the scene. An
unrecognised value is ignored and the panel rotates as usual, so a mistyped
URL cannot leave the wall display stuck. This is the standard way to reach a
scene when checking a change, and it works against the deployed site too. The
parsing lives in `lib/panel-rotation.ts`.

### Switch the weather off

`/?weather=off` makes no weather, week or forecast-map request at all; the card
shows its unavailable state and everything else works. Use it for any check that
is not about the weather: Open-Meteo counts one load of the forecast map as
about three hundred calls against a daily quota that the display shares with
every machine on the same connection.

`/?weather=demo` makes no request either, but draws a synthetic forecast on the
map, which is the only way to look at its animation without buying a grid.

`/?time=08:46` pins the clock to a Copenhagen time, for checking an outfit
against chosen digits. All three are parsed in `lib/debug-flags.ts`.

### Capture and diagnose

```sh
npm run shot -- --scene transport --offline   # 1280 x 720 PNG under screenshots/
npm run probe                                 # which forecast provider is answering, and why not
npm run probe:transit                         # which departure provider is answering, and what it shows
npm run audit                                 # every scene at 1280 x 720, checked for layout faults
```

All four are plain Node scripts and are described in [docs/DEBUGGING.md](docs/DEBUGGING.md).

## Configuration

Copy `.env.example` to `.env.local` if you need to configure the optional
Rejseplanen access ID. Keep the key server-side and never commit `.env.local`.
Without it, departures fall back to Transitous, which needs no credential and
serves Rejseplanen's own realtime feed. See [docs/TRANSPORT.md](docs/TRANSPORT.md).

Weather and the precipitation forecast map require internet access. The clock and
bundled daily facts are local.

## Checks

```sh
npm run check
```

That runs lint, typecheck, tests, the documentation check, the project rules
check, and the production build, in that order. The same command runs in CI on every push and pull
request, so a green local run means a green pipeline.

The individual stages are `npm run lint`, `npm run typecheck`, `npm test`,
`npm run docs:check`, `npm run check:rules`, and `npm run build`. Tests mirror
the pure modules in `lib/` and need no renderer or network. `npm run docs:check`
fails when a Markdown file links to or names a path that no longer exists, and
`npm run check:rules` fails on the project rules a script can check (hover
styles, an untested `lib/` module, a timer without its cleanup, a public
credential name), which is what keeps these documents and rules honest.

## Migration

Source copied from Clock version 20, commit
`9df3ec6d45271c01e65d9bf3ddd163e87b2c1e63`. The original source is backed up
separately on the owner's computer. This repository removes the Sites
deployment configuration and uses Node.js for the departures endpoint and its
in-memory cache.

Copying the source does not unpublish the original ChatGPT Site. The original
hosting must be disabled separately.
