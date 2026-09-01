import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forecastMapUrl } from '../app/radar.ts';

test('uses a future rain forecast map centered on home', () => {
  const url = new URL(forecastMapUrl());
  assert.equal(url.origin, 'https://embed.windy.com');
  assert.equal(url.searchParams.get('overlay'), 'rain');
  assert.equal(url.searchParams.get('product'), 'ecmwf');
  assert.equal(url.searchParams.get('calendar'), 'now');
  assert.equal(url.searchParams.get('play'), '1');
  assert.equal(url.searchParams.get('detailLat'), '55.73825');
  assert.equal(url.searchParams.get('detailLon'), '12.53836');
  assert.equal(url.searchParams.get('radarRange'), '-1');
});
