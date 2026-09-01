# HomeDashboard

A home display with a clock, local weather, an animated precipitation radar, daily facts, and local departures. Migrated from Clock on ChatGPT Sites to a standalone Next.js application.

## Project map

The implementation and operational notes are split by responsibility:

- [Architecture and route map](docs/ARCHITECTURE.md) — app composition, data flow, time-zone rules, and where to make common changes.
- [Transit integration](TRANSPORT.md) — Rejseplanen credentials, stop matching, caching, quota, and verification notes.
- [Daily facts](docs/DAILY_FACTS.md) — generated data format, editorial overrides, attribution, and regeneration workflow.

The dashboard has one page route (`/`), one server API route (`/api/departures`), and static daily-fact assets under `/facts/daily/`. There is no client-side router.

## Run on your computer

Requires Node.js 22.13 or newer and npm.

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

The server listens on this computer only. To deliberately make it available to other devices on your network, run `npm run start -- --hostname 0.0.0.0` after building.

## Configuration

Copy `.env.example` to `.env.local` if you need to configure the optional Rejseplanen access ID. Keep the key server-side and never commit `.env.local`. Without it, departures show dashes. See [TRANSPORT.md](TRANSPORT.md).

Weather and the precipitation radar require internet access. The clock and bundled daily facts are local. The display retains the original configured location and transit stops. No ChatGPT Sites account or Cloudflare runtime is required.

## Checks

```sh
npm test
npm run lint
npm run build
```

Run the checks after changes to UI, pure data logic, or route handlers. The test files mirror the pure modules they cover, while the production build catches Next.js and TypeScript integration errors.

## Migration

Source copied from Clock version 20, commit `9df3ec6d45271c01e65d9bf3ddd163e87b2c1e63`. The original source is backed up separately on the owner's computer. This repository removes the Sites deployment configuration and uses Node.js for the departures endpoint and its in-memory cache.

Copying the source does not unpublish the original ChatGPT Site. The original hosting must be disabled separately.
