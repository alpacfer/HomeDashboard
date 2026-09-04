# Forecast map, and the DMI work that is parked

The forecast map draws DMI Harmonie precipitation over the next six hours,
requested through Open-Meteo. This file records why it is not requested from DMI
directly, exactly how far that investigation got, and what would finish it.

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
