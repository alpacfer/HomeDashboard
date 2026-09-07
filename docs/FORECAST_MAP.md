# Forecast map, and the DMI work that is parked

The forecast map draws DMI Harmonie precipitation over the next six hours,
requested through Open-Meteo. This file records why it is not requested from DMI
directly, exactly how far that investigation got, and what would finish it.

## The illustrated basemap

The weather atlas uses a local hand-painted map made with image generation
from a satellite capture of this same view. The
[reference and generation notes](../assets/map-design/README.md) record its
source, prompt and framing. [The artwork bounds](../lib/forecast-map-art.ts)
place it in Web Mercator with Leaflet's image overlay; the markers and rain
use that same projection. The plate covers the frame without stretching,
including the taller layout when there are no transit service messages.
There are no basemap tile requests. Forecast fetching and its quota limits
remain the same, and the live rain colours still agree with the weather ribbon.

Parchment labels and a cottage at Home remain on the map. The painting runs the
full height of the card and the timeline is a frosted bar laid across the top of
it: the countdown ring sits at the right-hand end of the same row, on the
track's own axis, so the whole thing is one row deep. The frosting is the only
`backdrop-filter` on the display, and it is affordable because the bar is about
1280 x 44 and the blur radius is small; do not spread it to the rest of the
card. Nothing may cover a place name, blurred or not — that is `npm run audit`'s
overlap rule, and it is what keeps the tags out from under the bar now that the
map is no longer clipped to the space below it.
Loading, dry, expired and unavailable captions sit on small paper panels so
the map remains visible in every state. Four lighting plates follow the same
solar-elevation dawn/day/dusk/night phases as the other widgets, supplied by
the shared dashboard clock. The map loads only the current phase and retains
the old plate until the next is ready; swapping plates does not rebuild the
map, restart the rain, or request a forecast.

## The map is alive, and none of it is drawn per frame

Three effects sit between the painting and the rain, and each one exists because
a still map of a place you live in looks like a photograph of it.

**The water moves.** Three sheets whose alpha is the coastline itself — cut off
the four plates by [assets/map-design/segment-map.py](../assets/map-design/segment-map.py) —
carrying the swell up the sound, the painter's own wave marks, a sparse glitter
and a fringe in the shallows. Each holds the same pattern a third of a
wavelength further on.

**The city scintillates after dark.** Three more sheets of the lights the night
plate already paints, under three different district-scale mottles, with a
different half of the two hundred town centres turned up in each. Whole districts come
up and go down while single lights wink, which is what a city does seen from a
plane. They exist only while `data-light` is `night`: the effect keys on that,
so for sixteen hours a day three images are unfetched and three textures
unrasterised.

**The sun goes in and out by day.** Three sheets of soft cloud shadow — the same
field rolled a third of the plate's width each time, so it crosses the county
one way and the lap closes, at about a pixel a second. It is a sheet like the
others rather than a gradient laid over the card: a layer over the card falls on
the place names, the cottage and the forecast rain as well as on the land. There
is no sun to cast a shadow at three in the morning and no dark for the lights to
show against at noon, so the two share the same three slots and exactly six
sheets exist at any hour.

### Why all of it is opacity

A `mask-image` over a moving child forces the browser to re-apply the mask,
every frame, over about half a million pixels — on a stick whose most expensive
job is already the precipitation canvas. Cross-fading pre-cut sheets rasterises
each one once and then only fades it, which the compositor carries for nothing.
The measured cadence of the precipitation canvas is unchanged with all six
sheets on screen: 20 paints a second, gaps of 49.3 to 50.8 ms.

Three sheets and not two, because two can only pulse. Two pieces of arithmetic
make three work, and this shipped wrong on both of them before the numbers were
checked.

**The hat is two thirds of a cycle wide.** Three hats a *third* of a cycle wide,
spaced a third apart, tile the cycle rather than overlapping it: the sum is a
triangle wave from zero to the peak, and the water went fully off and back three
times a lap. Measured ripple 2.003 of the mean. At two thirds wide, neighbours
overlap and something is always coming up as something else goes down.

**The ramp is exponential.** Three sheets stacked do not add, they composite, so
a pair at half strength shows `1-(1-a/2)²`, not `a` — a linear ramp still dips
about a fifth below its peak twice a cycle. Sampling `1-(1-a)^u` makes the two
active sheets multiply out to exactly `1-a` at every moment. Measured ripple
falls from 0.231 to 0.084, and to 0.009 at the `a=0.6` the stops are calibrated
for. `tests/forecast-map-art.test.mjs` reads the real keyframes and simulates
the stack, because nothing else in the repository can see a cross-fade at all:
`npm run motion` samples draw cadence and element position and never reads
opacity, and a screenshot cannot see a blink.

### What it measures, on screen

Frozen at a ladder of animation times covering exactly one cycle, at 1280 x 720
with `?scene=map&weather=dry`:

| | Measured |
| --- | --- |
| Whole-card luminance swing over a cycle | 0.12% of the mean by day, 0.64% by night — the map does not breathe |
| Water travel | 3.086 CSS px a second, one wavelength (64.8 px) a cycle, monotone, no reversal |
| Cloud shadow travel | 1.12 CSS px a second, one plate width a lap, the same way as the water |
| Night lamp modulation, by brightness band | 0.119 at the dimmest, **0.313 at the brightest** — the town centres the eye goes to are the most modulated, and nothing clips |
| Cloud drift wrap, 13 layer/weather combinations | mean and max difference 0.000 luminance units |
| Precipitation canvas, with and against the sheets removed at runtime | 400 draws in 10 s either way, gap p90 50.1 ms either way |
| Pixels under the frosted bar that the cross-fade changes | none: every sheet's alpha is zero for its first 50 rows, which puts the first lit row six pixels below the bar |

Two things the cross-fade does that are worth knowing before they are
re-diagnosed as faults. The composite of three phases is exact in level but not
in contrast: the swell's amplitude falls to 61% of its peak at each handover and
its instantaneous speed swings between 1.8 and 4.1 px a second about that 3.086
mean, three times a cycle. Net travel is exactly one wavelength and the direction
never reverses. A fourth sheet would lift the contrast floor to 71% at the cost
of a fourth decode, and at these alphas it is not worth it.

And the ramp is a fixed approximation. Its stops sample `1-(1-a)^u` at `a=0.6`,
so the fit is exact only there; across the strengths the stylesheet declares the
composited total swings between 0.006 and 0.079 of alpha, against 0.010 to 0.176
for a linear ramp. At card scale that residual is under one RGB unit.

### What it costs

Nine sheets, 388 KB on the wire in all, of which a day loads 287 KB (water and
shadow) and a night 314 KB (water and lights), once, on top of the 1.7 MB of
plates. Six are live at any hour: decoded, six 751 x 524 RGBA bitmaps are about
9.4 MB resident, and each is displayed at roughly 737 x 514 with an opacity
animation, which normally earns its own compositor texture — about 9.1 MB of GPU
memory. **That number has not been measured on the Fire TV**, only on a headless
Chrome running software compositing, which is the wrong renderer for the
question. If it turns out to be tight there, the three cloud-shadow sheets are
the first thing to drop: they are the only effect of the three that is
decoration rather than information.

**What travels and what does not** is the other half. A cross-fade turns a
difference between sheets into apparent movement and a sameness into stillness,
so the waterline and the painter's own wave marks are identical in all three and
composite to a constant. The first cut grew the shore fringe with the sheet
index and the whole coastline pulsed. And three phases can carry a wave
unambiguously only if the step is under half a wavelength, and loop only if
three steps make a whole one — so there is exactly **one** travelling
wavelength, stepped a third of itself per sheet. A second, shorter one read as
travelling backwards.

The sheets are `imageOverlay`s in the plate's own extent, so Leaflet
georeferences them exactly as it georeferences the painting and a refit needs no
code. Their `zIndex` is passed as an option, never written in CSS: Leaflet writes
z-index inline and inline beats a rule. The band is 2 to 99. The plate sits at
Leaflet's default of 1, and the precipitation canvas computes to **100**, not the
400 its own rule asks for, because `leaflet.css`'s `.leaflet-map-pane canvas` is
the more specific selector. Rain must stay above the water.

**Nothing that moves may cross under the timeline**, which frosts its backdrop:
a static backdrop is blurred once and a moving one is re-blurred every frame.
The sheets are cut to nothing over the top 9.5% of the plate and the shadow
layer starts below the bar.

Under `prefers-reduced-motion` the cross-fades stop on their middle phase, so the
water is still, the lights are on and a cloud shadow is holding where it was. While the scene is off
screen every animation is paused: `visibility: hidden` does not stop one.

## Knowing when a new run exists without asking for it

Open-Meteo serves a static metadata file per model, and it is what decides
when the grid is refetched (`lib/forecast-refresh.ts`):

```
https://api.open-meteo.com/data/dmi_harmonie_arome_europe/static/meta.json
```

It is under a kilobyte, CDN-cached with an ETag, and answers with
`access-control-allow-origin: *`, so the browser reads it directly. The fields
used are `last_run_initialisation_time`, `last_run_availability_time` and
`update_interval_seconds` (all seconds since the epoch, interval 10800). On 3
September 2026 the 12:00Z run became available at 14:45:49Z, a delay of about
2 h 46 min, and that delay is what the scheduler aims at: two minutes past
availability plus interval. The `dmi_seamless` alias has no metadata file
(`500`), which is why the grid names the Harmonie model outright.

## The fifteen-minute steps are hourly data

Open-Meteo's `minutely_15` precipitation is not sub-hourly output for any model
that covers Denmark. Asked for both series from the same DMI Harmonie run at
one point, the four quarters of every hour carry that hour's total divided by
four:

```text
hourly 07:00  0.2     quarters 06:15 06:30 06:45 07:00   0.1 0.1 0.1 0.1
hourly 08:00  0.7     quarters 07:15 07:30 07:45 08:00   0.2 0.2 0.2 0.2
hourly 09:00  0.3     quarters 08:15 08:30 08:45 09:00   0.1 0.1 0.1 0.1
```

Eight hours were checked and not one varied inside the hour. `temperature_2m`
from the same request gives the mechanism away: every quarter sits on the
straight line between the hourly values, to within its own rounding. So the
map's twenty-four frames hold six distinct states, three frames in four are a
hold and the fourth is a cut, which is what made the animation read as a
slideshow.

Asking for more steps would not have helped and would not have cost anything
either: Open-Meteo weighs a request by **coordinates, never by steps**
(`lib/open-meteo-quota.ts`), confirmed at 48, 96 and 192 steps. Space is what
costs. Going from 3 km to 2 km would need about 780 points, over both
`MAX_GRID_POINTS` and the URL cap, so the one axis that could buy real detail
is the one that is closed.

Checked at the same point on the same day:

| Model | Hours varying inside the hour |
| --- | --- |
| `dmi_harmonie_arome_europe` | 0 of 8 |
| `knmi_harmonie_arome_europe` | 0 of 8 |
| `metno_seamless` | 0 of 8 |
| `ecmwf_ifs025` | 0 of 8 |
| `icon_d2` | **5 of 8** |

ICON-D2 is the only one with genuine fifteen-minute precipitation, it covers
the whole framed area including Hillerød with no gaps, and it would cost the
same. It is not used because its metadata file answers `500` on every try,
which would cost the run-aware refresh in `lib/forecast-refresh.ts` and drop the
grid back to a blind three-hour cadence; because it is a German model over
Denmark where DMI's own is available; and because the map would then disagree
with the DMI-based card beside it. If the metadata ever starts answering, this
is the first thing to reconsider.

## What is drawn between the states

Since the steps cost nothing and say nothing, the frames between are made in
the browser instead, in `lib/precipitation-flow.ts`. Runs of identical frames
collapse to the state they came from, each consecutive pair is matched for the
displacement between them, and the moments between are sampled along it.

Blending values alone would not have done. The field was measured crossing this
frame at about 14 km/h and at 34 km/h at its fastest, which over an hour is five
of the map's three-kilometre cells and sometimes eleven; a blend over that
distance fades rain out of one place and into another instead of moving it.

Two things learned building it, both measured rather than guessed:

1. **Scoring a match on the cells two states still share lets the search hide a
   mismatch instead of explaining it**, because sliding the wet part out of the
   compared region scores a perfect zero. A shower moving three cells east was
   confidently reported as moving seven west. The score covers the union now,
   with anything off the lattice read as dry.
2. **Four hard colour bands were what made the map twinkle.** The animation
   draws far more moments than there are states, and a cell drifting across
   0.3 mm between two of them jumped a whole colour over a patch the size a
   3 km cell is scaled up to. Over one pass, 191 of 345 cells crossed a
   threshold and crossed back. The overlay reads the same four colours as a
   continuous ramp now, which is what the legend already promised, and the
   remaining changes are 1.1 per cell per pass: one rain band arriving and
   leaving.

The animation is driven by animation frames from the clock rather than by an
interval counting ticks, so a frame that arrives late lands where it belongs
instead of behind.

## Why not DMI's own API

DMI publishes **no map imagery of any kind**. The whole free-data catalogue is
Observations, Radar, Lightning, Forecast and Climate: no WMS, no WMTS, no tile
service, no rendered images, and **no nowcast product**. Radar is ODIM HDF5
volume and composite files, observation only, 500 m pixels, 180 days of history,
which is not something a Fire TV browser can open. So any DMI-based map means
pulling numbers and drawing them.

Their forecast EDR API does have a `cube` query that returns a grid over a
bounding box, which is the right shape for this. Two things stopped it being
used:

1. **`cube` rejects `crs84`.** The API answers `crs=crs84 can only be used for
   /position queries on HARMONIE DINI/IG models`, so the grid arrives in
   Harmonie's native Lambert projection.
2. **A latitude/longitude rectangle is a rotated quadrilateral in that
   projection.** The map's own box sits at **−16.6°** to Lambert grid north, so
   every cell would be reprojected and then drawn rotated against the basemap.

Asking Open-Meteo in latitude and longitude avoids both: it accepts many
coordinates in one call, snaps each to the nearest Harmonie cell, and returns
axis-aligned cells needing no projection code. It is the same model run, checked
field by field against a direct DMI capture.

## What was solved, and is worth keeping

The projection itself is not the hard part any more. The grid definition was
read straight from a GRIB header on DMI's public AWS mirror
(`s3://dmi-opendata/forecastdata/HARMONIE_DINI_SF/`) with a 4 KB HTTP range
request, no API calls at all:

| Property | Value |
| --- | --- |
| Grid template | 30, Lambert conformal |
| Earth | Sphere, radius 6371229 m (`shape of earth = 6`) |
| Standard parallels | `Latin1 = Latin2 = LaD = 55.5°`, so a tangent case |
| Central meridian | `LoV = 352°`, that is −8° |
| First grid point | 39.671°N, −25.422°E |
| Size and spacing | 1906 × 1606 at Dx = Dy = 2000 m |

A tangent Lambert on a sphere has a short closed form, so **no `proj4`
dependency is needed**. A forward and inverse pair written from those parameters
round-trips the map corners exactly, and its nearest-cell centre for Home lands
within about two metres of what DMI's own `position` query returns
(55.74243, 12.52958 against 55.74245, 12.52955). That is independent
confirmation of both the projection and the grid origin.

## What is still open

The `cube` bounding box was never confirmed. `bbox` in the native CRS is in
**kilometres**, from DMI's own documented example
`bbox=-1165,1464,-1163,1466&crs=native`; the corresponding box for this map is
`1238,198,1279,242`. The one request made to confirm it returned `429`, so it is
untested. Also unmeasured: the cube response's axis layout, and how many
timesteps fit before the API returns `413 Request Entity Too Large` (the limit
is real but undocumented).

Three requests were spent guessing that `bbox` format before reading DMI's EDR
documentation, which had the answer. Read the docs first.

## If this is picked up again

1. Confirm the kilometre `bbox` with **one** request, not a loop. DMI's fair-use
   limit is shared across all callers and answers `429` when busy.
2. Establish how many timesteps a 15 × 18 cell cube returns before `413`.
3. Only then consider swapping the transport. The gain is directness, not better
   data, and it costs a reprojection plus a rotated overlay. It is not obviously
   worth it, which is why this is a note rather than a branch.

Their supercomputer maintenance ran 31 August to 10 September 2026 and every
request during that period returned `429`, so any reliability judgement made
then is not representative.
