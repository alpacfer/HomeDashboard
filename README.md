# HomeDashboard

A home display with a clock, local weather, a Windy map, daily facts, and local departures. Migrated from Clock on ChatGPT Sites to a standalone Next.js application.

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

Weather and the Windy map require internet access. The clock and bundled daily facts are local. The display retains the original configured location and transit stops. No ChatGPT Sites account or Cloudflare runtime is required.

## Checks

```sh
npm test
npm run build
```

## Migration

Source copied from Clock version 20, commit `9df3ec6d45271c01e65d9bf3ddd163e87b2c1e63`. The original source is backed up separately on the owner's computer. This repository removes the Sites deployment configuration and uses Node.js for the departures endpoint and its in-memory cache.

Copying the source does not unpublish the original ChatGPT Site. The original hosting must be disabled separately.
