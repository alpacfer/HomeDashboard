import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRadarTimeline, radarApiUrl, radarTileUrl } from '../app/radar.ts';

test('uses the public precipitation radar feed', () => {
  const url = new URL(radarApiUrl());
  assert.equal(url.origin, 'https://api.rainviewer.com');
  assert.equal(url.pathname, '/public/weather-maps.json');
});

test('parses recent radar frames and creates precipitation-only tile URLs', () => {
  const now = 1_000_000;
  const data = {
    host: 'https://tilecache.rainviewer.com/',
    radar: { past: [
      { time: now - 1800, path: '/v2/radar/998200' },
      { time: now - 1200, path: '/v2/radar/998800' },
      { time: now + 1200, path: '/v2/radar/future' },
    ] },
  };
  const timeline = parseRadarTimeline(data, now, 2);
  assert.deepEqual(timeline.frames.map(frame => frame.time), [now - 1800, now - 1200]);
  assert.match(radarTileUrl(timeline.host, timeline.frames[0]), /\/v2\/radar\/998200\/512\/\{z\}\/\{x\}\/\{y\}\/2\/1_1\.png$/);
});

test('rejects incomplete radar metadata', () => {
  assert.equal(parseRadarTimeline({ host: 'https://tilecache.rainviewer.com', radar: { past: [] } }), null);
  assert.equal(parseRadarTimeline({ host: 'http://tilecache.rainviewer.com', radar: { past: [{ time: 1, path: '/v2/radar/1' }] } }), null);
});
