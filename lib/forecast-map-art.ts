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
