# The illustrated weather atlas

The [satellite reference](satellite-reference.png) is the dashboard's existing
map extent captured at a 1280 × 720 viewport on 6 September 2026, with Esri
World Imagery substituted for the street tiles. Weather requests were disabled.
The reference is north-up Web Mercator; its exact bounds are recorded in
[the artwork configuration](../../lib/forecast-map-art.ts).

Reference imagery: Esri World Imagery, sources Esri, Vantor, Earthstar
Geographics, and the GIS User Community. See the
[source service](https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer).
This source is also credited on the live map.

The built-in image generation tool produced the map using the
[saved prompt](prompt.txt) and that satellite reference. The selected result
is [the local WebP plate](../../public/maps/north-zealand-storybook.webp),
encoded at quality 85 without changing its composition. It is an artistic
interpretation of the geography, not survey imagery. The coastline, lakes and
towns were visually compared to the reference before integration.

Leaflet positions the plate, location markers, and live forecast in the same
geographic coordinate system. The view covers the frame with the painting,
cropping its sides slightly when the departure strip leaves a taller panel.
The painting is never stretched to the panel's aspect ratio. Its imagery is
static: rainfall, forecast time, location labels and status captions are live UI.
No map tile requests, added dependencies, server work, or polling accompany it.

The paper labels, small cottage at Home and terracotta playhead belong to the
UI. The forecast journey occupies a separate full-width strip above the map;
it cannot cover geographic tags. There is no title card, compass or rainfall
key. The rain ramp still matches the weather ribbon.
Loading, failure, dry and expired forecasts leave the artwork visible.

The [dawn](../../public/maps/north-zealand-dawn.webp),
[dusk](../../public/maps/north-zealand-dusk.webp), and
[night](../../public/maps/north-zealand-night.webp) lighting plates were made
with the built-in image generation tool using the day painting as the exact
reference. Their prompts are [dawn](prompt-dawn.txt), [dusk](prompt-dusk.txt),
and [night](prompt-night.txt). All four plates are 1501 × 1048, share the same
geographic bounds, and are encoded as WebP at quality 85, each below 600 KB.

The shared dashboard clock selects the same solar-elevation phase as the clock
and weather widgets, including the existing Copenhagen time and sky debug
flags. It follows the current time, not the animated forecast playhead. Only
the current phase loads; a new phase loads behind the previous plate and
replaces it when ready. The old Leaflet layer is removed immediately after
the swap, so at most two plates are held during a transition. No extra timer,
weather request, or map/grid rebuild is involved.
