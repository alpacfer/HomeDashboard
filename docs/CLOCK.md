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

There are eighteen. `outfitWeights()` decides which are likely right now from
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
never overlaps the roll. The fade-in runs on the digit **cells**, not the
faces: a face keeps its own roll animation, so the digit that rolled out
earlier in the minute stays gone instead of fading back in over the new one.

Faces come from Google Fonts, subset to the digits, the Latin letters and the
date punctuation by asking the CSS API with `text=`, which works for variable
families too. `npm run fonts:clock` downloads them into `public/fonts/clock/`
and writes `app/clock-fonts.css`. To add an outfit: add the face to
`scripts/fetch-clock-fonts.mjs`, rerun the script, add the outfit to `OUTFITS`
with its fonts and date style, add its `.o-<id>` rule to `globals.css`, and
give it a weight in `outfitWeights()`. The cells clip, so `--digit-scale` is
not a taste: measure the face's ink for 0 to 9 with canvas `measureText`
(`actualBoundingBox*`, the way `Clock` measures for the Tenant), and set the
scale to about 95 % of the largest that keeps every digit inside .62em by
1.12em. Shadows, drips and slices count as ink. A face that only fits at half
the size of the others does not belong here; that is why Rubik Glitch went.
Then look at it: `npm run shot -- --offline --time 08:46 --clip .clock-block
--class ".clock-block=clock-block o-<id>"` shows the four widest digits, and
`--class ".clock-block=clock-block o-<id> sp-morph" --freeze 1600` the widest
point of its morph, if it has one. Check the digits at wall distance before
committing: 0 against 8, 1 against 7, 3 against 8.

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
baseline. It is decoration that knows where the numbers are, and what shape
they are.

**Geometry.** After the fonts are ready, after every roll and outfit change,
and on resize, `Clock` measures each digit: the cell's box from the DOM and the
glyph's metrics from a canvas `measureText` call in the face's computed font.
`inkBox()` turns those into the glyph's actual ink rectangle. Each digit is
also drawn once, at 96 px, on a small offscreen canvas, and `inkColumns()` reads
the top of the ink in every column; `topProfile()` classifies that top as a
**flat** bar wider than the Tenant (3, 5, 7 in Grotesk), a **ledge** narrower
than it (the stem of a 1 or a 4), or a **round** arch (0, 2, 6, 8, 9), and finds
the apex: the centre of the highest flat run. `tenantTargets()` turns all of
that into the translations the Tenant needs: `--push-x` to stand against the
last digit's ink edge, and one perch per digit with `--perch-x/y` on the apex,
how far it can pace along a flat top, and which way an arch falls away. The
colon's top dot is measured too and is the fifth perch, a **ball**. That is why
it stands on the stem of a "1" rather than over its flag, and shoves the edge
of a "7" rather than the edge of the cell.

**Behaviour.** One sparse decision loop advances a tiny set of drives—energy,
curiosity, adventure and interest in the current panel—and chooses between
waiting, a gesture, climbing and exploring (`lib/pet-behavior.ts`). It remembers
its recent activities, so expressive actions do not repeat like a playlist and
an adventure must build up before another can happen. Idle gestures include
natural and double blinks, layered eye/head glances, smiling, stretching,
wiggling, leaning, yawning, hopping, scratching, sneezing, waving, dozing and
listening. The cadence varies with energy rather than following independent
metronomes.

The Tenant is no longer confined to the clock. `Clock` measures five destination
landmarks and a network of safe landing pads from their real DOM boxes: the
weather card, rain ribbon, week days, active transport-board rules, fact image
and footer, forecast-map edges and the compact departures rule. A long route is
a chain of jumps through those pads; a nearby destination is one jump. Every hop
charges with an anticipation squash, follows a quadratic parabola and lands
fully before the next one begins, so it never glides diagonally through the UI
or bounces on an invented point in empty space. A scene change raises interest
in its new landmark; on some later decision the Tenant travels there and reacts
to what it finds—reading the week, waiting at departures, admiring a fact or
tracking the map. If that scene rotates away, it routes home from its actual
current position. The weather itself also prompts a sneeze, drowsy slump,
listening pose or wiggle when the mood changes. Its small arm sits opposite the
tail and lifts for waves and weather props.

1.6 s before the minute boundary (`shouldApproach`) it makes a short charged
jump to the last digit and holds a ready pose; when
the roll actually arrives, which the one-second tick can deliver up to a second
late, it strikes (`pickStrike`: a shove, a kick with the front foot, or a
headbutt) and the digit rolls out under the blow; then it jumps back. If no
roll follows, it returns after 3.5 s. Every 25 to 45 seconds it climbs onto
a digit or the colon (`pickPerch`, the minutes favoured) and stays 6 to 14
seconds, less on the colon. What it does up there depends on what it is
standing on (`pickPerchAction`): on a bar it paces a few steps each way, sits
down with its feet out, or peers over the edge; on a ledge it teeters; on an
arch it sways all the while, slips down the curve and catches itself; on the
colon it balances hard, feet together, and the dots squash when it lands and
spring when it leaves (`tn-land`, `tn-spring` on the block). A digit that
rolls out from under it takes its footing with it: it stumbles, falls to the
baseline in front of the digit, lies there squashed and dazed for a moment,
then gets up and walks home. A digit that rolls elsewhere makes it start and
look that way. Otherwise it comes down by climbing, by hopping off, or, from
an arch or the colon, by sliding off it (`pickDescent`). At the hour it jumps with a
spin or does two hops (`pickHourAction`), after walking home if it struck the
roll first. Between 23:00 and 06:00 it sleeps and the clock dims to 72 %. It
holds a broad leaf over its ears when the current hour is wet, wears sunglasses
above 25° and a scarf below 0°, using the same fields the weather card shows.

While the Tenant is off its resting spot, `Clock` postpones set pieces, so the
digit it is standing on does not fly away under it; the hour pieces are the
exception, since they follow the roll it has just struck.

**Motion.** Voluntary movement uses compositor-only jump keyframes. Pure route
logic selects measured landing pads and samples each parabola at its quarters;
the component advances one charge and flight timer at a time. A trip interrupted
by a scene change reads the current transform and plans home from that exact
point. The perch remains a transition: when the digit under it rolls or changes
face, the remeasured apex carries it smoothly to the new top, and its stance
changes with the shape. The climb, descents, fall and hour are keyframes whose
first and last frames equal the poses on either side of them. Every descent and
the fall start from `--from-x/y`, the element's actual translation read from its
computed transform at that instant. The SVG is layered so nothing fights: the positioned
element carries poses, `.t-figure` breathing, the walk bob and the balance for
the top's shape, `.t-gest` gestures and perch actions, `.t-pose` the sticky
sitting squash, and each animates only its own transform.

## Reduced motion

Under `prefers-reduced-motion: reduce` the roll snaps, no outfit crossfade or
set piece runs, and the Tenant is not rendered. Outfits still change, instantly.

## Checking it

Everything about *which* and *when* is in `lib/` and covered by
`tests/clock-wardrobe.test.mjs`, `tests/clock-events.test.mjs`,
`tests/clock-tenant.test.mjs` and `tests/pet-behavior.test.mjs`, including the top-shape classifier, which is
tested against the measured column tops of the Grotesk digits. To watch a piece
without waiting for its timer, add the class by hand in DevTools (`sp-domino`,
`o-neon`) on `.clock-block`; the CSS is the whole choreography. The Tenant's
poses are classes on `.tenant` in the same way (`pose-perched on-round
pa-slip`, `pose-strike s-kick`), positioned by the custom properties the
component sets on it. Add `?pet=weather`, `week`, `transport`, `fact` or `map`
to hold it at a measured dashboard landmark for a reproducible visual check.
Prefix the value with `travel-` (for example `?pet=travel-map`) to replay the
real safe-spot route and hold only after it arrives.
