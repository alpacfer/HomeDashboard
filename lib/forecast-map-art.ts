import type { MapBounds } from './precipitation-grid';
import type { SkyLight } from './clock-sky';

// The exact Web Mercator extent of the satellite reference, captured from
// the dashboard at 1280 × 720. The painting keeps that reference's framing.
// It must be an imageOverlay in this extent, never a stretched CSS background:
// labels and precipitation use the same projection as the artwork.
export const MAP_ART_BOUNDS: MapBounds = {
  west: 11.949455738067627,
  east: 12.902519702911377,
  north: 55.989308283304226,
  south: 55.61573444170693,
};
export const MAP_ART_URL = '/maps/north-zealand-storybook.webp';
export const MAP_ART_PLATES: Record<SkyLight, string> = {
  day: MAP_ART_URL,
  dawn: '/maps/north-zealand-dawn.webp',
  dusk: '/maps/north-zealand-dusk.webp',
  night: '/maps/north-zealand-night.webp',
};

// The living map, as three sheets of water and three of the city's lights.
//
// Each sheet is a pre-cut WebP whose ALPHA already carries the shape: the
// water's coastline, or the settlements the night plate paints in amber. They
// are laid over the plate as image overlays in the same extent, so Leaflet
// georeferences them exactly as it georeferences the painting, and the browser
// never has to apply a mask at runtime.
//
// THEY ARE CROSS-FADED, NEVER MOVED, and that is the whole performance story.
// A mask over a moving child forces the browser to re-apply the mask every
// frame over a rectangle of about half a million pixels, on a stick whose most
// expensive job is already the precipitation canvas. Opacity is the one
// property the compositor can carry for free: each sheet is rasterised once and
// then only faded. Three phases of one travelling pattern, dissolved in turn,
// read as water glinting and as a city scintillating — which is what they
// actually do — without a single repaint.
//
// Written by assets/map-design/segment-map.py, which segments the plates. See
// docs/FORECAST_MAP.md.
export const MAP_WATER_SHEETS = [
  '/maps/map-water-1.webp', '/maps/map-water-2.webp', '/maps/map-water-3.webp',
] as const;
export const MAP_LIGHT_SHEETS = [
  '/maps/map-lights-1.webp', '/maps/map-lights-2.webp', '/maps/map-lights-3.webp',
] as const;
export const MAP_SHADOW_SHEETS = [
  '/maps/map-shadow-1.webp', '/maps/map-shadow-2.webp', '/maps/map-shadow-3.webp',
] as const;

// Where the sheets sit inside Leaflet's overlay pane. The band is 2..99: the
// plate is at Leaflet's ImageOverlay default of 1, and the precipitation canvas
// computes to 100 rather than the 400 its own rule asks for, because
// leaflet.css's `.leaflet-map-pane canvas` is the more specific selector. Rain
// must stay above the water and the lights, so nothing here may reach it.
export const MAP_WATER_Z = 10;
export const MAP_LIGHTS_Z = 20;
export const MAP_SHADOW_Z = 30;
