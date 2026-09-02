import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRadarTimelineStale, parseRadarTimeline, radarApiUrl, radarFrameAgeMinutes, radarTileUrl } from '../lib/radar.ts';

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

test('a successful but stalled feed is stale even if its metadata was just generated', () => {
  const now = 1_000_000;
  const timeline = parseRadarTimeline({
    generated: now,
    host: 'https://tilecache.rainviewer.com',
    radar: { past: [{ time: now - 3600, path: '/v2/radar/old' }] },
  }, now);
  assert.ok(timeline);
  assert.equal(isRadarTimelineStale(timeline, now), true);
});

test('historical replay does not make a current feed stale, but the feed ages without a new request', () => {
  const now = 1_000_000;
  const timeline = parseRadarTimeline({
    host: 'https://tilecache.rainviewer.com',
    radar: { past: [
      { time: now - 600, path: '/v2/radar/latest' },
      { time: now - 7800, path: '/v2/radar/history' },
    ] },
  }, now);
  assert.equal(radarFrameAgeMinutes(timeline.frames[0], now), 130);
  assert.equal(isRadarTimelineStale(timeline, now), false);
  assert.equal(isRadarTimelineStale(timeline, now + 1200), false);
  assert.equal(isRadarTimelineStale(timeline, now + 1201), true);
});

test('frame age stays meaningful across midnight and small clock differences', () => {
  const now = Date.parse('2026-09-02T00:05:00+02:00') / 1000;
  assert.equal(radarFrameAgeMinutes({ time: now - 900, path: '/v2/radar/yesterday' }, now), 15);
  assert.equal(radarFrameAgeMinutes({ time: now - 86400, path: '/v2/radar/old' }, now), 1440);
  assert.equal(radarFrameAgeMinutes({ time: now + 60, path: '/v2/radar/ahead' }, now), 0);
});
