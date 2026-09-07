# Painted scene assets

Generated with the built-in image generation tool. The original compositions
were guided by Studio Ghibli's official
[Howl's Moving Castle gallery](https://www.ghibli.jp/works/howl/),
[Spirited Away gallery](https://www.ghibli.jp/works/chihiro/) and
[My Neighbor Totoro gallery](https://www.ghibli.jp/works/totoro/).
Reference stills are not shipped. These are new empty background paintings,
with application text, props and the resident composed above them.

All images are 700 pixels wide, displayed at about 350 pixels wide.
Production conversion only resizes and encodes WebP at quality 85.
Sun, moon, stars, rain and snow are lightweight independent gradient layers.
The layout fills a fixed rectangle, preserving the same relative landing
surfaces across all phases.

## The earlier cloud tiles

Nine hand-drawn silhouettes from the earlier weather implementation, preserved
as source artwork. The weather card now uses textured painted assets from
[public/weather/](../weather/README.md). These SVGs are no longer requested by
the card. The notes below describe their original construction.

| Tile | Genus | What it is for |
| --- | --- | --- |
| [cirrus](cloud-cirrus-v1.svg) | cirrus uncinus | high ice: a dense head and a long combed tail, nine of them, no two the same |
| [cirrostratus](cloud-cirrostratus-v1.svg) | cirrostratus | the milky veil a day ahead of the rain; a sheet, not clouds |
| [cumulus](cloud-cumulus-v1.svg) | cumulus humilis | fair weather: separate puffs, wide sky, every base on one condensation level |
| [stratocumulus](cloud-stratocumulus-v1.svg) | stratocumulus | the cumulus joined up into a deck, with two narrow tears |
| [overcast](cloud-overcast-v1.svg) | stratus | the lid: no gaps, no edges, ten uneven scallops of sag |
| [nimbostratus](cloud-nimbostratus-v1.svg) | nimbostratus | the raining lid, with eleven streaks of virga under it |
| [snowdeck](cloud-snowdeck-v1.svg) | snow-bearing stratus | level and rounded rather than pendulous, and wadding instead of virga |
| [scud](cloud-scud-v1.svg) | pannus | torn rags that race under a wet deck at rather more than twice its speed |
| [fogbank](cloud-fogbank-v1.svg) | fog | nine mist filaments in a depth ramp; no silhouette at all |

Three things are true of every one of them, and each replaced a version that
was wrong:

- **Both side edges match by arithmetic, not by eye**, and each tile says in
  its own header which of three methods it used. A continuous underside is a
  chain of relative quadratics whose widths sum to exactly the tile width and
  whose rises sum to zero, so the outline is at the same height at x=0 and x=W;
  a body that crosses the edge is drawn twice, the same path data translated by
  exactly one tile; a filament drawn as a stroke uses a wave whose period
  divides the tile, so it has the same height *and* the same tangent at both
  ends. The first cut walked the edges back by hand and left a diagonal seam in
  every deck.
- **Anything meant to merge is one closed outline at full alpha.** Alpha
  composites additively: two half-opaque lobes come out brighter where they
  overlap, which turns a deck back into a heap of circles. A *thinner* place has
  to be taken away with an SVG mask inside the file — painting a dark shape at
  low opacity over the cloud makes it thicker, not thinner.
- **Nothing has vertical structure.** The traced sky mask in `app/horizon.css`
  puts the framing canopy in both top corners at every height, so a tile with a
  cloud edge running up and down it is sliced into pieces that read as seams.

`cloud-bank-v1.svg`, the two-blob mask these replaced, is retired.

## The four lightings of each scene

| Scene | Day | Dawn | Dusk | Night |
| --- | --- | --- | --- | --- |
| Interior | [day](interior-day-v1.webp) | [dawn](interior-dawn-v1.webp) | [dusk](interior-dusk-v1.webp) | [night](interior-night-v1.webp) |
| Exterior | [day](exterior-day-v1.webp) | [dawn](exterior-dawn-v1.webp) | [dusk](exterior-dusk-v1.webp) | [night](exterior-night-v1.webp) |

## Base image specifications

Interior: a simple hand-painted cozy timber workshop, muted warm plaster,
dark timber beam and side posts, small arched forest window at the far
right, an empty horizontal workbench at 72% height and a dark wooden apron.
Quiet center for live digits; no text, characters, furniture or loose props.

Exterior: a simple hand-painted woodland clearing, one framing tree at the
left and foliage around the upper corners, a broad quiet sage sky,
soft blue-green forest in the distance, an earth clearing on the right at
72% height, and a dark green foreground. No text, characters, sun, moon,
clouds or precipitation baked into the image.

## Lighting edit prompts

Each edit used its scene's original day painting as the edit target.

### inside / dawn

Use case: lighting-weather. Edit the provided empty cozy timber workshop interior background for a small dashboard widget. Change ONLY illumination and colors. Early dawn: pale peach and dusty rose light at the horizon, soft lavender shadows, gentle low morning illumination. Restrained and readable. Preserve EXACT framing, aspect ratio, every tree/beam/window outline and the horizontal workbench top at 72% height. Do not move, resize, add or remove any objects or alter the perspective. Preserve simple hand-painted animation-background brushwork, quiet negative space, no extra detail. No text, numbers, people, creatures, furniture, props, sun, moon, clouds or precipitation. One complete image, no comparison sheet. This must align seamlessly with the original day image when switched.

### inside / dusk

Use case: lighting-weather. Edit the provided empty cozy timber workshop interior background for a small dashboard widget. Change ONLY illumination and colors. Late sunset twilight: muted amber light near the horizon, dusky blue and mauve shadows, warm edges, visibly evening rather than daytime. Preserve EXACT framing, aspect ratio, every tree/beam/window outline and the horizontal workbench top at 72% height. Do not move, resize, add or remove any objects or alter the perspective. Preserve simple hand-painted animation-background brushwork, quiet negative space, no extra detail. No text, numbers, people, creatures, furniture, props, sun, moon, clouds or precipitation. One complete image, no comparison sheet. This must align seamlessly with the original day image when switched.

### inside / night

Use case: lighting-weather. Edit the provided empty cozy timber workshop interior background for a small dashboard widget. Change ONLY illumination and colors. Night: the window shows a dark blue forest, subtle moonlight on its sill. Room remains cozy and readable in a small amber pool of lamplight centered at 70% width near the ceiling (the lamp itself will be overlaid later). Deep warm brown and blue shadows. Preserve EXACT framing, aspect ratio, every tree/beam/window outline and the horizontal workbench top at 72% height. Do not move, resize, add or remove any objects or alter the perspective. Preserve simple hand-painted animation-background brushwork, quiet negative space, no extra detail. No text, numbers, people, creatures, furniture, props, sun, moon, clouds or precipitation. One complete image, no comparison sheet. This must align seamlessly with the original day image when switched.

### outside / dawn

Use case: lighting-weather. Edit the provided empty forest clearing exterior background for a small dashboard widget. Change ONLY illumination and colors. Early dawn: pale peach and dusty rose light at the horizon, soft lavender shadows, gentle low morning illumination. Restrained and readable. Preserve EXACT framing, aspect ratio, every tree/beam/window outline and the horizontal earth clearing at 72% height. Do not move, resize, add or remove any objects or alter the perspective. Preserve simple hand-painted animation-background brushwork, quiet negative space, no extra detail. No text, numbers, people, creatures, furniture, props, sun, moon, clouds or precipitation. One complete image, no comparison sheet. This must align seamlessly with the original day image when switched.

### outside / dusk

Use case: lighting-weather. Edit the provided empty forest clearing exterior background for a small dashboard widget. Change ONLY illumination and colors. Late sunset twilight: muted amber light near the horizon, dusky blue and mauve shadows, warm edges, visibly evening rather than daytime. Preserve EXACT framing, aspect ratio, every tree/beam/window outline and the horizontal earth clearing at 72% height. Do not move, resize, add or remove any objects or alter the perspective. Preserve simple hand-painted animation-background brushwork, quiet negative space, no extra detail. No text, numbers, people, creatures, furniture, props, sun, moon, clouds or precipitation. One complete image, no comparison sheet. This must align seamlessly with the original day image when switched.

### outside / night

Use case: lighting-weather. Edit the provided empty forest clearing exterior background for a small dashboard widget. Change ONLY illumination and colors. Night: deep teal blue forest, soft silver moonlight on the clearing, blue distance, dark tree silhouettes with readable painted foliage. No moon or stars painted in; these will be overlaid later. Preserve EXACT framing, aspect ratio, every tree/beam/window outline and the horizontal earth clearing at 72% height. Do not move, resize, add or remove any objects or alter the perspective. Preserve simple hand-painted animation-background brushwork, quiet negative space, no extra detail. No text, numbers, people, creatures, furniture, props, sun, moon, clouds or precipitation. One complete image, no comparison sheet. This must align seamlessly with the original day image when switched.
