# HomeDashboard

A home display with a clock, local weather, an animated precipitation forecast map,
daily facts, and local departures. It runs on a Render free-plan web service and
is shown continuously in the browser on a Fire TV Stick HD.

## Project map

The implementation and operational notes are split by responsibility:

- [Architecture and route map](docs/ARCHITECTURE.md) — app composition, data flow, time-zone rules, and where to make common changes.
- [Deployment and target environment](docs/DEPLOYMENT.md) — Render free-plan settings, Fire TV Stick limits, and the constraints they place on every change.
- [Transit integration](docs/TRANSPORT.md) — Rejseplanen credentials, stop matching, caching, quota, and verification notes.
- [Daily facts](docs/DAILY_FACTS.md) — generated data format, editorial overrides, attribution, and regeneration workflow.
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

## Configuration

Copy `.env.example` to `.env.local` if you need to configure the optional
Rejseplanen access ID. Keep the key server-side and never commit `.env.local`.
Without it, departures show dashes. See [docs/TRANSPORT.md](docs/TRANSPORT.md).

Weather and the precipitation forecast map require internet access. The clock and
bundled daily facts are local.

## Checks

```sh
npm run check
```

That runs lint, typecheck, tests, the documentation check, and the production
build, in that order. The same command runs in CI on every push and pull
request, so a green local run means a green pipeline.

The individual stages are `npm run lint`, `npm run typecheck`, `npm test`,
`npm run docs:check`, and `npm run build`. Tests mirror the pure modules in
`lib/` and need no renderer or network. `npm run docs:check` fails when a
Markdown file links to or names a path that no longer exists, which is what
keeps these documents honest.

## Migration

Source copied from Clock version 20, commit
`9df3ec6d45271c01e65d9bf3ddd163e87b2c1e63`. The original source is backed up
separately on the owner's computer. This repository removes the Sites
deployment configuration and uses Node.js for the departures endpoint and its
in-memory cache.

Copying the source does not unpublish the original ChatGPT Site. The original
hosting must be disabled separately.
