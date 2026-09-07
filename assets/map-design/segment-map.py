#!/usr/bin/env python3
"""Cut the living-map sheets out of the four painted plates.

    python3 assets/map-design/segment-map.py [--out public/maps]

Reads public/maps/north-zealand-{storybook,dawn,dusk,night}.webp and writes nine
sheets beside them: three of water, three of the city's lights at night, and
three of cloud shadow crossing the county by day.
Each sheet's ALPHA is the shape — there is no mask at runtime — and the three
of a kind are the same pattern a third of a cycle apart, so cross-fading them
in turn reads as movement without anything being repositioned. See
components/forecast-map-panel.tsx and app/globals.css for the other half.

WHY THIS ONE IS PYTHON. AGENTS.md says scripts stay in Node, and everything in
scripts/ still does: those are the tools npm runs, on two operating systems, in
CI. This is not one of them. It runs by hand, roughly never — only when the
paintings change — and its output is committed. What it does is connected-
component segmentation with morphology, a distance transform and anisotropic
noise, which in Node means either a new dependency in a repository that guards
its dependency list carefully, or several hundred lines of image code nobody
would maintain. It lives here, beside the paintings and the prompts that made
them, rather than in scripts/, precisely so it is not mistaken for part of the
build.

    python3 -m pip install numpy scipy pillow

HOW THE WATER IS FOUND. Blue minus red separates this painting's sea from its
land almost by itself: the sea is a desaturated teal and the land is green and
ochre, so b-r runs about -0.09 over water and -0.28 over farmland. It is
measured on all four plates and averaged, because the four are the same
painting relit and a threshold that suits the day plate alone has nothing
checking it. Two more features decide the marginal cases: local variance, since
water is smooth where fields are textured, and blue-minus-green per component,
which is the one number that reliably tells a dark conifer plantation from a
small lake. Components are then kept or dropped whole, on their own means,
rather than pixel by pixel — a lake is a lake all over.

NOTHING MOVES UNDER THE TIMELINE. .forecast-map-timeline frosts its backdrop,
and the Oresund runs under it. A static backdrop is blurred once; a moving one
is re-blurred every frame for ever. Every sheet is therefore cut to nothing over
the top of the plate. See BAR_STOP.
"""

import argparse
import pathlib

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

PLATES = ('storybook', 'dawn', 'dusk', 'night')
SHEET = (751, 524)              # half the plate, which is about 1:1 on screen
SEED = 20260906                 # so a rerun produces the same nine files
# How much of the plate the frosted timeline covers, and how far the ramp back
# up runs. The plate always covers the frame's height exactly, and the bar is
# 3.45vw of a frame between 514 and 634 px tall, so the strip is 7% to 9% deep.
BAR_STOP, BAR_RAMP = 0.095, 0.04
# A component smaller than this is noise, and one whose colour or texture is
# not unmistakable is a dark wood rather than a pond.
MIN_BODY = 700
MIN_BLUE, MIN_SCORE, MAX_TEXTURE = -0.15, 0.80, 0.30
# The one travelling wavelength, in plate pixels, and the fixed width of the
# shallows. See water_sheets for why there can only be one of the first.
SWELL, SHORE = 132.0, 24.0
# How bright the brightest lamp is allowed to get before the district and wink
# factors are applied. It is not merely "below 1": the two factors reach 1.12
# and 1.55, so anything above 1/(1.12 x 1.55) = 0.576 clips at the town centres
# and freezes exactly the lamps the eye goes to. The stylesheet takes the
# brightness back with --sheet-a.
LAMP_PEAK = 0.56


def load(root, name):
    return np.asarray(Image.open(root / f'north-zealand-{name}.webp').convert('RGB'), np.float32) / 255


def water_mask(plates):
    """The coastline, as a boolean, from all four plates at once."""
    colours, textures = [], []
    for plate in plates.values():
        r, g, b = plate[..., 0], plate[..., 1], plate[..., 2]
        blue = b - r
        low, high = np.percentile(blue, [2, 98])
        colours.append(np.clip((blue - low) / (high - low + 1e-6), 0, 1))
        luma = 0.299 * r + 0.587 * g + 0.114 * b
        mean = ndi.uniform_filter(luma, 9)
        textures.append(np.sqrt(np.maximum(ndi.uniform_filter(luma * luma, 9) - mean * mean, 0)))
    colour = np.mean(colours, 0)
    texture = np.mean(textures, 0)
    low, high = np.percentile(texture, [2, 98])
    texture = np.clip((texture - low) / (high - low + 1e-6), 0, 1)
    score = 0.62 * colour + 0.38 * (1 - texture)

    # Hysteresis: seed on the unmistakable water and grow into the merely
    # plausible. A single threshold either loses the shallows or eats the woods.
    labels, count = ndi.label(score > 0.74)
    seeded = np.zeros(count + 1, bool)
    seeded[np.unique(labels[score > 0.86])] = True
    seeded[0] = False
    mask = seeded[labels]

    day = plates['storybook']
    blue_green = day[..., 2] - day[..., 1]
    labels, count = ndi.label(mask)
    index = np.arange(1, count + 1)
    sizes = ndi.sum(mask, labels, index)
    scores = ndi.mean(score, labels, index)
    textures = ndi.mean(texture, labels, index)
    blues = ndi.mean(blue_green, labels, index)
    keep = [i for i, size, mean, rough, blue in zip(index, sizes, scores, textures, blues)
            if size >= MIN_BODY and blue > MIN_BLUE and mean > MIN_SCORE and rough < MAX_TEXTURE]
    mask = np.isin(labels, keep)
    print(f'  {len(keep)} bodies of water, {100 * mask.mean():.1f}% of the plate')

    # Islands stay; the painter's wave marks and the odd bright ripple do not.
    filled = ndi.binary_fill_holes(mask)
    holes, count = ndi.label(filled & ~mask)
    if count:
        small = ndi.sum(filled & ~mask, holes, range(1, count + 1)) < 4000
        mask = mask | np.isin(holes, np.nonzero(small)[0] + 1)
    square = ndi.generate_binary_structure(2, 2)
    return ndi.binary_opening(ndi.binary_closing(mask, square, iterations=3), square, iterations=2)


def smooth_field(shape, seed, scale):
    """A smooth random field, one value every `scale` pixels."""
    height, width = shape
    rng = np.random.default_rng(seed)
    coarse = rng.standard_normal((max(2, int(height / scale)), max(2, int(width / scale)))).astype(np.float32)
    field = np.asarray(Image.fromarray(coarse).resize((width, height), Image.BICUBIC), np.float32)
    return field / (np.abs(field).max() + 1e-6)


def water_sheets(plates, mask):
    """Three phases of one swell, with the painter's own caps lit on top.

    WHAT TRAVELS AND WHAT DOES NOT is the whole design. A cross-fade turns a
    difference between sheets into apparent movement and a sameness into
    stillness, so anything that should sit still — the waterline, the painted
    wave marks — is IDENTICAL in all three and composites to a constant, and
    only the swell and the glitter differ. The first cut grew the shore fringe
    with the sheet index, which made the whole coastline pulse in and out twice
    a minute; that was one line, and it was the loudest thing on the map.

    ONE TRAVELLING WAVELENGTH, and that is arithmetic rather than taste. Three
    phases can carry a wave unambiguously only if the step is under half a
    wavelength, and can loop only if three steps make a whole one. Both at once
    means step = L/3 and every travelling component at exactly L: a second,
    shorter wavelength would step more than half of itself and read as
    travelling backwards, which is what the first cut's 61 px component did
    against the 118 px one. Variety comes from two differently warped copies of
    the same wavelength instead.
    """
    height, width = mask.shape
    soft = ndi.gaussian_filter(mask.astype(np.float32), 2.0)
    distance = ndi.distance_transform_edt(mask)
    rows, columns = np.mgrid[0:height, 0:width].astype(np.float32)

    # The swell runs up the sound, roughly along the coast.
    lean = np.radians(18.0)
    along = columns * np.cos(lean) + rows * np.sin(lean)
    warp_a = 46.0 * smooth_field(mask.shape, 12, 150)        # crests are not straight
    warp_b = 38.0 * smooth_field(mask.shape, 15, 210)
    amp_a = 0.35 + 0.65 * (0.5 + 0.5 * smooth_field(mask.shape, 11, 230))
    amp_b = 0.30 + 0.70 * (0.5 + 0.5 * smooth_field(mask.shape, 16, 180))
    glitter = 0.25 + 0.95 * np.clip(0.5 + 0.6 * smooth_field(mask.shape, 14, 260), 0, 1)

    def swell(step):
        ahead = along + step * SWELL / 3
        crest = (0.62 * amp_a * np.sin(2 * np.pi * (ahead + warp_a) / SWELL)
                 + 0.38 * amp_b * np.sin(2 * np.pi * (ahead + warp_b) / SWELL + 2.1))
        return np.clip(crest, 0, None) ** 1.6

    def sparkle(seed, count=2600):
        rng = np.random.default_rng(seed)
        out = np.zeros(mask.shape, np.float32)
        ys, xs = rng.integers(0, height, count), rng.integers(0, width, count)
        on = mask[ys, xs]
        out[ys[on], xs[on]] = rng.uniform(.5, 1.0, int(on.sum()))
        out = ndi.gaussian_filter(out, 1.6)
        return out / (out.max() + 1e-6)

    # The painter drew the wave marks himself. A high pass inside the water
    # finds exactly those ticks and chevrons, and lighting HIS marks reads as
    # water far better than any sparkle invented here -- which, over an already
    # rainy map, came out looking like drizzle. The same in every sheet: they
    # are the surface, not the light on it.
    day = plates['storybook']
    luma = 0.299 * day[..., 0] + 0.587 * day[..., 1] + 0.114 * day[..., 2]
    caps = np.clip(luma - ndi.gaussian_filter(luma, 3.5), 0, None) * 8.0
    caps = ndi.gaussian_filter(np.clip(caps, 0, 1) * ndi.binary_erosion(mask, iterations=4), 0.6)
    caps /= caps.max() + 1e-6
    # The shallows. One radius, for ever.
    shallows = np.clip(1.0 - distance / SHORE, 0, 1) ** 1.5 * mask

    for phase in range(3):
        alpha = (0.44 * swell(phase)
                 + 0.58 * caps
                 + 0.34 * sparkle(SEED + phase) * glitter
                 + 0.32 * shallows)
        yield np.clip(alpha, 0, 1) * soft


def light_sheets(night):
    """Three scintillations of the lights the night plate already paints.

    MULTIPLICATIVE, NOT ADDITIVE, and that is the whole of it. Adding a wink to
    a lamp that is already at full alpha does nothing: the first cut clipped
    about 250 pixels per sheet at alpha 1, and those pixels were exactly the
    town centres — the only lamps the eye goes to were the only ones perfectly
    frozen. Here the field is held below LAMP_PEAK so the brightest lamp can
    still be modulated in both directions, and everything is a factor.
    """
    r, g, b = night[..., 0], night[..., 1], night[..., 2]
    # Sodium and LED against a cold blue ground: red is the only channel the
    # lights own.
    lit = np.clip(r - 0.5 * (g + b) + 0.10, 0, None)
    low, high = np.percentile(lit, [93.5, 99.6])
    lights = np.clip((lit - low) / (high - low + 1e-9), 0, 1) ** 1.25 * LAMP_PEAK

    # Where the towns are, rather than where the pixels are bright. Most bright
    # pixels on this plate belong to the road network, and a winking road grid
    # reads as a rendering fault; a winking town centre reads as a town.
    blurred = ndi.gaussian_filter(lit, 2.0)
    centres = np.argwhere((blurred == ndi.maximum_filter(blurred, 15))
                          & (blurred > np.percentile(blurred, 99.2)))
    print(f'  {len(centres)} town centres to wink')

    for phase in range(3):
        rng = np.random.default_rng(SEED + 90 + phase)
        winks = np.zeros(night.shape[:2], np.float32)
        # A DIFFERENT HALF of them each time. Choosing all of them and varying
        # only the amplitudes lights every town in every sheet, which averages
        # out to a static field with a little noise on it; choosing a subset is
        # what makes a town go out and come back.
        for y, x in centres[rng.choice(len(centres), size=len(centres) // 2, replace=False)]:
            winks[y, x] = rng.uniform(0.5, 1.0)
        winks = np.clip(ndi.gaussian_filter(winks, 2.4) * 30.0, 0, 1)
        # Districts breathe together; individual towns wink on top of that.
        districts = 0.62 + 0.5 * (0.5 + 0.5 * smooth_field(night.shape[:2], 40 + phase, 260))
        yield np.clip(lights * districts * (1.0 + 0.55 * winks), 0, 1)


def shadow_sheets(shape):
    """Three phases of cloud shadow crossing the county.

    Periodic in x by construction: the coarse noise is tiled three times before
    it is smoothed, so the middle copy joins itself, and each sheet is the same
    field rolled a third of the plate's width. Three rolls make one lap, so the
    dissolve travels one way and the loop closes.

    THE ROLL IS NEGATIVE so the shadow crosses the county the same way the swell
    does. Nothing forces that -- the two are separate fields with separate
    generators -- and the first cut had them going opposite ways, which is one
    map with two winds on it. The water's phase offset moves its pattern along
    +along, right and eighteen degrees down; rolling the shadow the other way
    is what makes the two agree.

    Not masked to the land. A shadow falls on the sound too, and cutting it at
    the waterline would draw the coastline a second time.
    """
    height, width = shape
    rng = np.random.default_rng(SEED + 300)
    cells_y, cells_x = 5, 7
    coarse = rng.standard_normal((cells_y, cells_x)).astype(np.float32)
    wide = np.asarray(Image.fromarray(np.tile(coarse, (1, 3)))
                      .resize((width * 3, height), Image.BICUBIC), np.float32)
    field = wide[:, width:2 * width]
    # THE BLUR HAS TO WRAP TOO. Tiling the coarse noise makes the middle copy
    # continue into itself, but a plain gaussian over the crop does not know
    # that, and the field stops being periodic at its own edges -- so rolling it
    # put a hard vertical seam 35 times the median gradient down sheets 2 and 3.
    # Wrapping on x is what makes "periodic by construction" true.
    field = ndi.gaussian_filter(field, 26, mode=['reflect', 'wrap'])
    field /= np.abs(field).max() + 1e-6
    # Soft blobs with real gaps between them: a sky with no gaps is the weather
    # card's job, not the map's.
    blobs = np.clip((field - 0.06) / 0.7, 0, 1) ** 1.4
    for phase in range(3):
        yield np.roll(blobs, -phase * width // 3, axis=1)


def write(alpha, rgb, path):
    small = np.asarray(Image.fromarray((np.clip(alpha, 0, 1) * 255).astype(np.uint8))
                       .resize(SHEET, Image.LANCZOS), np.uint8)
    body = np.dstack([np.full(small.shape, channel, np.uint8) for channel in rgb] + [small])
    Image.fromarray(body, 'RGBA').save(path, quality=88, method=6)
    print(f'  {path.name}  {path.stat().st_size:,} bytes')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', default='public/maps', help='where the sheets are written')
    options = parser.parse_args()
    root = pathlib.Path(__file__).resolve().parents[2]
    plates = {name: load(root / 'public' / 'maps', name) for name in PLATES}
    out = root / options.out

    print('water')
    mask = water_mask(plates)
    # The strip the frosted timeline covers. Nothing that moves may live here.
    height = mask.shape[0]
    bar = np.clip((np.arange(height, dtype=np.float32) / height - BAR_STOP) / BAR_RAMP, 0, 1)[:, None]
    for index, alpha in enumerate(water_sheets(plates, mask), 1):
        write(alpha * bar, (232, 244, 250), out / f'map-water-{index}.webp')

    print('lights')
    for index, alpha in enumerate(light_sheets(plates['night']), 1):
        write(alpha * bar, (255, 223, 168), out / f'map-lights-{index}.webp')

    print('cloud shadow')
    for index, alpha in enumerate(shadow_sheets(mask.shape), 1):
        write(alpha * bar, (24, 36, 28), out / f'map-shadow-{index}.webp')


if __name__ == '__main__':
    main()
