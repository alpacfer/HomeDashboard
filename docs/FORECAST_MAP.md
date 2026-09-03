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
