import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MAP_ART_BOUNDS, MAP_ART_PLATES } from '../lib/forecast-map-art.ts';
import { SKY_LIGHTS } from '../lib/clock-sky.ts';
import { MAP_BOUNDS, coversView } from '../lib/precipitation-grid.ts';

test('the illustrated extent contains the whole forecast area', () => {
  assert.ok(coversView(MAP_ART_BOUNDS, MAP_BOUNDS));
  // All three labels must remain inside the painting with room for a caption.
  for (const [lat, lon] of [[55.73825, 12.53836], [55.6761, 12.5683], [55.9279, 12.3008]]) {
    assert.ok(lat > MAP_ART_BOUNDS.south && lat < MAP_ART_BOUNDS.north);
    assert.ok(lon > MAP_ART_BOUNDS.west && lon < MAP_ART_BOUNDS.east);
  }
});

test('the basemap is a local compressed WebP within the display asset budget', () => {
  assert.deepEqual(Object.keys(MAP_ART_PLATES).sort(), [...SKY_LIGHTS].sort());
  for (const url of Object.values(MAP_ART_PLATES)) {
    const bytes = readFileSync(new URL('../public' + url, import.meta.url));
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
    assert.ok(bytes.length < 600_000, 'Each static plate should stay below 600 KB');
  }
});
