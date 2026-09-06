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
The small [cloud mask](cloud-bank-v1.svg) is original vector artwork, with
asymmetric wispy silhouettes. CSS sets its color, coverage and drift; sun,
moon, stars, rain and snow are lightweight independent gradient layers.
The layout fills a fixed rectangle, preserving the same relative landing
surfaces across all phases.

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
