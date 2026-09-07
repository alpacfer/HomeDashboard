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

## The living map

Three things move on the finished painting, and none of them is drawn at
runtime. [segment-map.py](segment-map.py) cuts nine sheets out of the four
plates and writes them beside them; the tool is run by hand, roughly never —
only when the paintings change — and its output is committed. It is the one
Python file in the repository, and its own header says why.

```sh
python3 -m pip install numpy scipy pillow
python3 assets/map-design/segment-map.py
```

It is deterministic: a rerun on unchanged plates produces the same nine files
byte for byte.

| Sheet | What its alpha holds |
| --- | --- |
| `map-water-1..3.webp` | the swell running up the sound, the painter's own wave marks lit, a sparse glitter where the sun is on the water, and a fringe in the shallows along every shore |
| `map-lights-1..3.webp` | the settlements the night plate already paints, under three different district-scale mottles, with a different half of the two hundred town centres turned up in each |
| `map-shadow-1..3.webp` | one field of soft cloud shadow, periodic in x, rolled a third of the plate's width each time |

**The water is found on blue minus red.** This painting's sea is a desaturated
teal and its land is green and ochre, so that one difference runs about −0.09
over water and −0.28 over farmland. It is measured on all four plates and
averaged, because the four are the same painting relit and a threshold that
suits the day plate alone has nothing checking it. Two more features settle the
marginal cases: local variance, since water is smooth where fields are textured,
and blue minus green per component, which is the one number that reliably tells
a dark conifer plantation from a small lake. Components are kept or dropped
whole, on their own means, rather than pixel by pixel — a lake is a lake all
over. The result is ten bodies of water covering 28% of the plate: the Øresund,
Roskilde Fjord, Arresø, the Furesø chain, the Lyngby lakes and the harbour.

**Only the light travels.** A cross-fade turns a difference between sheets into
apparent movement and a sameness into stillness, so everything that should sit
still — the waterline, the painter's own wave marks — is byte-identical in all
three sheets and composites to a constant. An early version grew the shore
fringe with the sheet index and the whole coastline pulsed in and out twice a
minute. And because three phases can carry a wave unambiguously only if the step
is under half a wavelength, and can loop only if three steps make a whole one,
there is exactly one travelling wavelength (132 plate px, stepped 44) with two
differently warped copies of it for variety. A second, shorter component stepped
more than half of itself and read as travelling backwards.

**The lamps are modulated, not brightened.** The wink is a factor rather than a
term, and the field is held below 0.74 so the brightest lamp still has room to
move in both directions. An additive version saturated at exactly the town
centres — the only lamps the eye goes to were the only ones perfectly frozen.

**The night lights are a road network, not a field of points.** Most bright
pixels on that plate belong to roads, and winking a road grid reads as a
rendering fault. The individual winks are therefore placed on local maxima of
the blurred warm channel with a minimum separation — about two hundred town
centres and junction knots — while the district mottle carries everything else.

**Nothing moves under the timeline.** `.forecast-map-timeline` frosts its
backdrop, and the Øresund runs straight under it. A static backdrop is blurred
once; a moving one is re-blurred every frame, for ever, on a stick that is
already spending its budget on the precipitation canvas. Every sheet — the
cloud shadow included — is cut to nothing over the top 9.5% of the plate by
`BAR_STOP`, which is the only thing standing between this effect and a
permanent re-blur.

The sheets are cross-faded, never moved. See
[lib/forecast-map-art.ts](../../lib/forecast-map-art.ts) for why, and
[docs/FORECAST_MAP.md](../../docs/FORECAST_MAP.md) for how they are laid on the
map.
