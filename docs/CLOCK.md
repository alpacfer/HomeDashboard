# The clock: outfits, set pieces and the Tenant

The clock is the one thing on the display that is always on screen, so it is
the one thing allowed to play. Three layers sit on the plain digits, and one
rule governs all of them: **nothing changes abruptly.** Every transition is a
fade, a move or a morph that starts from where the clock is and ends at rest.

```text
components/clock.tsx      timers, measurement, markup
components/tenant.tsx     the character's own timers and its SVG
lib/clock-wardrobe.ts     outfits: faces, colours, date formats, weighted pick
lib/clock-events.ts       set pieces: which fit, when the minute is quiet
lib/clock-tenant.ts       mood, idle life, glyph geometry
app/clock-fonts.css       generated @font-face rules (do not edit)
public/fonts/clock/       generated subset woff2 files (do not edit)
scripts/fetch-clock-fonts.mjs  regenerates both of the above
```

## Outfits

An outfit is one class on `.clock-block` (`o-<id>`) that sets custom
properties in `app/globals.css`: the digit face and a `--digit-scale` that fits
its digits into the fixed `.62em` grid cells, the date face, size, case and
colour, the colon colour and shape, and any glow. The date **format** belongs
to the outfit too (`Outfit.date` in `lib/clock-wardrobe.ts`): terminal shows
`2026-09-03 Thu`, editorial shows `Thursday, 3 September`, arcade shows
`Thu 03 Sep`.

There are nineteen. `outfitWeights()` decides which are likely right now from
the Copenhagen hour and weekday, the current temperature and whether the
current hour is wet. Weekday daytime leans on Grotesk, the home outfit; weekend
mornings on the serif; Friday and Saturday evenings on neon; night on terminal
and CRT with nothing loud. Rain adds weight to the dripping face, heat to the
burned one. 31 October and 24 to 26 December allow only their own outfit.
`pickOutfit()` never returns the outfit already worn.

One change every 20 to 40 minutes (`nextOutfitDelay`). The change itself is
a **crossfade**: the component first loads the new outfit's fonts through
`document.fonts.load`, then renders a ghost copy of the old outfit over the
block and fades it out while the new digits fade in, one digit after another,
the date last (`DRESS_MS`, one second). Colours, glyphs and glows all ride
inside those two fades. A change waits for a quiet part of the minute so it
never overlaps the roll.

Faces come from Google Fonts, subset to the digits, the Latin letters and the
date punctuation by asking the CSS API with `text=`, which works for variable
families too. `npm run fonts:clock` downloads them into `public/fonts/clock/`
and writes `app/clock-fonts.css`. To add an outfit: add the face to
`scripts/fetch-clock-fonts.mjs`, rerun the script, add the outfit to `OUTFITS`
with its fonts and date style, add its `.o-<id>` rule to `globals.css`, and
give it a weight in `outfitWeights()`. Check the digits at wall distance
before committing: 0 against 8, 1 against 7, 3 against 8.

## Set pieces

A set piece is one class on `.clock-block` (`sp-<id>`) whose keyframes live in
`globals.css`. Every keyframe set **starts and ends at identity**, so the class
is simply added and removed after `SetPiece.duration`. Pieces animate the digit
cells; the minute roll animates the faces inside them; the two never run at
once.

| Piece | Length | What happens |
| --- | --- | --- |
| `domino` | 2.4 s | The minutes lean into the hours one after another, hold, spring back. |
| `zerog` | 3.2 s | Everything lifts off, drifts, drops and lands with a squash. |
| `rubber` | 1.7 s | The last digit is pulled off to the right, snaps back, knocks through the row. |
| `cradle` | 2.0 s | The colon dots swing out and clack back; the digits they hit flinch. |
| `ink` | 2.8 s | Fill fades to outline, ink floods up from the baseline, outline fades under it. |
| `morph` | 3.2 s | The outfit's own variable axes move: weight, softness, casualness, bleed, pixel shape. |
| `quake` | 3.4 s | Hour only. The block shakes, a digit drops out and climbs back. |
| `flap` | 1.9 s | Hour only. Each digit flaps through three wrong numbers and lands on the right one. |

`morph` is only eligible on an outfit whose digit face is a variable font
(`Outfit.morph`), and each such outfit has its own choreography in
`globals.css`, so the face never switches, only its shape. `quake` and `flap`
briefly show a wrong or missing digit and are therefore reserved for the hour,
2.6 s after the roll (`HOUR_PIECE_DELAY_MS`), when the roll has already drawn
the eye.

One piece every 5 to 15 minutes. `delayToQuiet()` shifts the start so the whole
piece fits inside the current minute with a two-second margin at both ends,
and a piece never starts while an outfit is changing. The same piece never
plays twice in a row.

## The Tenant

A small round character in the outfit's colon colour, with white eyes, pupils
and lids, standing to the right of the minutes with its feet on the digits'
baseline. It is decoration that knows where the numbers are.

**Geometry.** After the fonts are ready, after every roll and outfit change,
and on resize, `Clock` measures each digit: the cell's box from the DOM and the
glyph's metrics from a canvas `measureText` call in the face's computed font.
`inkBox()` turns those into the glyph's actual ink rectangle, and
`tenantTargets()` into the translations the Tenant needs: `--push-x` to stand
against the last digit's ink edge, `--perch-x/y` to stand centred on any
digit's top. That is why it stands on the top of a "1" and shoves the edge of a
"7" rather than the edge of the cell.

**Behaviour.** Idle, it blinks and glances every 3 to 8 seconds. 1.6 s before
the minute boundary (`shouldApproach`) it walks over to the last digit and
holds a ready pose; when the roll actually arrives, which the one-second tick
can deliver up to a second late, it shoves, and the digit rolls out under its
push. If no roll follows, it walks back after 3.5 s. Every 25 to 45 seconds it
climbs onto a digit, sits for a while looking down, and comes back; a digit
that rolls under it makes it bounce. At the hour it jumps with a spin. Between
23:00 and 06:00 it sleeps and the clock dims to 72 %. It holds an umbrella
when the current hour is wet, wears sunglasses above 25° and a scarf below 0°,
using the same fields the weather card shows.

**Motion.** Walking poses are CSS transitions on `transform`, so a move
interrupted by a late roll continues from wherever the Tenant is. The climb,
the descent and the jump are keyframes whose first and last frames equal the
poses on either side of them. Idle breathing, blinking and accessories animate
the SVG's own groups, never the positioned element, so they never fight the
locomotion.

## Reduced motion

Under `prefers-reduced-motion: reduce` the roll snaps, no outfit crossfade or
set piece runs, and the Tenant is not rendered. Outfits still change, instantly.

## Checking it

Everything about *which* and *when* is in `lib/` and covered by
`tests/clock-wardrobe.test.mjs`, `tests/clock-events.test.mjs` and
`tests/clock-tenant.test.mjs`. To watch a piece without waiting for its timer,
add the class by hand in DevTools (`sp-domino`, `o-neon`) on `.clock-block`;
the CSS is the whole choreography.
