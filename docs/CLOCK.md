# The clock, the woodland and the Tenant

The clock is a compact painted clockmaker's shed. The weather card below it
is the forest outside. Time and weather remain real UI text, while the pet
can jump from the indoor bench onto the outdoor clearing.

## Two painted scenes

At 1280 × 720, the clock is approximately 350 × 158 pixels and the weather
card 350 × 168. Their left and right edges align. Both paintings have their
supporting surface near 72% of the image height. The indoor tabletop reuses
a crop of its own painting, extended upward to give the raised numerals and
pet a deeper supporting plane; the window and date stay fixed.
Backgrounds stretch to the
same fixed widget rectangle across lighting variants; they never use a
changing cover crop. The clock's measured glyph baseline sits on the bench,
and the outdoor destination is measured from the `.weather-landing` marker.

Only `.clock-surface` and `.weather-surface` clip the artwork. The Tenant's
coordinate origin, `.clock-block`, has no stacking context or overflow clip,
so travel remains visible between cards. Geometry lives in
[app/globals.css](../app/globals.css).

The backgrounds are generated raster paintings, with independent lightweight
SVG props: a lamp, brass gears and pendulum indoors; a small evening campfire
outside. The shelf and window stay above or beside the numbers. The numerals
are flat cream ink -- no bevel, no contact shadow, no outline, no glow -- and
the padding alone stands them on the bench. The date is lettered directly over
the painted wooden apron; the weather headline sits over the ground, with a
feathered shade for contrast. Neither has a solid text plate. The clock and
the temperature share one Fraunces face.
No plant, precipitation or light filter crosses the text layer.

The exterior sky itself indicates the weather, with no separate weather icon.
The provider attribution is a linked monogram beside the forecast heading.

[public/scenes/README.md](../public/scenes/README.md) records the eight local
WebP assets, reference galleries, generation prompts and image sizes.
The complete set is about 145 KiB; only the active pair is selected by CSS.
No image-generation service or third-party image host is called at runtime.

## Where the paint stops

Two shapes in these paintings are facts about the artwork, and both are traced
off it by `npm run horizon` into [app/horizon.css](../app/horizon.css), which
is generated and must not be hand-edited. See
[docs/DEBUGGING.md](DEBUGGING.md#where-the-paint-stops-npm-run-horizon).

**The clearing's sky.** The underside of the framing tree's canopy, the far
ridge and the treeline, to the leaf, as a mask on `.exterior-sky`. Everything
drawn into that layer is cut to it — the disc, the high thin layer and the
cloud bank alike — so the sun sets *into* the treeline, one conifer at a time,
and a cloud passing the far ridge goes behind it. The same file carries the
four numbers the disc's arc is expressed in.

It is a mask and not a clip path because a painted leaf edge is soft. A clip
path can only say in or out: it renders the canopy as a staircase and cannot
hold a gap of sky between two leaves at all. The alpha is that edge as the
painter left it, so the sun is occluded gradually as it goes behind a treetop
rather than being cut in half by a polygon.

**The shed window's glass.** All four panes, as a mask on `.shed-window-sky`,
which is what leaves the painted frame and mullions standing in front of the
weather instead of under it. Both masks travel as inline PNGs — about 30 KB
together, no request, decoded once at load and nothing per frame. The cloud layer behind the glass wears a second mask
of its own, fading out at `--shed-sky-end`: below that the panes show painted
trees, and a cloud crossing a tree reads as a smear on the glass rather than as
weather beyond it.

The four plates of each scene are lit differently and framed identically, so
one shape describes all four and the tool reports how far they disagreed.

## The sun, and the moon

**Both are on the card, at every hour, each where it really is.**
[lib/sky-arc.ts](../lib/sky-arc.ts) turns the real sky into two fractions of one
per body — how far through its crossing it is, and how high it stands against
the highest it ever reaches at this latitude — and
[app/horizon.css](../app/horizon.css) turns those into a point on the painting.
`components/weather-panel.tsx` sets them once a minute, which is as often as
they change by half a pixel.

Two things fall out of that rather than being written:

- **The seasons.** `climb` is measured against a fixed peak, not against
  today's, so a midwinter noon reads about 0.19 and skims the ridge while a
  midsummer noon reads 1 and stands at the top of the sky.
- **Night.** A body below the horizon has a negative `climb`, which puts it
  under `--arc-low`, which the traced mask cuts away. Almost nothing hides
  either body by hand, and twilight comes free: for the half hour the sun is a
  degree or two down, the disc is behind the ridge and its bloom is not quite.
  The one exception is the sun at night, once it is a whole night's worth of
  degrees under and its bloom would clear the ridge again as a sunrise at two
  in the morning; `app/clock-hillside.css` §2 turns it off there, and says so.

There used to be **one** disc, handed to the sun by day and the moon after
dusk. That drew a moon that could not exist before dusk — the real one is up in
the afternoon rather more often than not — and a sun that stopped existing at
it. The stars were eight gradients on that same element, which is why they now
have a layer of their own: they are needed at exactly the hour the sun is not.

### The phase

`moonPhase()` reports two numbers from the same two series, so the drawn moon
and the drawn sun cannot disagree about where the sky is:

| | |
| --- | --- |
| `illuminated` | 0 at new, 1 at full: the fraction of the disc the sun is on. |
| `tilt` | Degrees to turn a moon drawn lit-on-the-right, clockwise on screen. |

The tilt is the half a picture usually gets wrong. The same crescent stands on
its horns rising and lies on its back at midnight, and at this latitude the
difference is most of a right angle over an evening. It also carries waxing and
waning, which are a half turn apart and so need no flag of their own.

**A phase is a shape, not a brightness**, so it is drawn rather than dimmed. The
terminator is the moon's own equator seen at an angle, which projects to a
half-ellipse |2k−1| of the disc wide, and the lit part is the right half of the
disc *minus* that ellipse below half phase and *plus* it above. Minus is an
intersection of masks and plus is a union; CSS nests for one and takes a second
element for the other, which is why there are three elements for two shapes.
`app/clock-hillside.css` §3 has the geometry.

Only `illuminated` reaches the stylesheet. Both halves of the shape are derived
from it there, so what is drawn cannot drift from what was computed — and
`?sky=full` pins it, because waiting a fortnight to see the other branch of that
rule is not a test.

## Light and weather

The default theme is `workshop`; `?clock=plain` retains a bare clock.
[lib/clock-theme.ts](../lib/clock-theme.ts) owns the theme list.
[components/use-scene-sky.ts](../components/use-scene-sky.ts) shares the existing
time and conditions with both scenes without adding a timer or request.

| Attribute | Values | Source |
| --- | --- | --- |
| `data-light` | night, dawn, day, dusk | Copenhagen solar elevation, including seasonal sunrise and sunset |
| `data-weather` | clear, partly, cloudy, overcast, fog, rain, sleet, snow | The weather card's current condition |
| `data-fall` | none, light, moderate, heavy | The current precipitation band |

[lib/clock-sky.ts](../lib/clock-sky.ts) derives these independent attributes.
Each light phase selects a separately generated painting with the same
composition. A translucent light pass then adds morning warmth, evening
shadows or blue night ambience. Night keeps the indoor lamp warm and the
exterior moonlit.

**Weather touches the clearing and never the room, and it says itself by
adding rather than by taking away.** Cloud, rain, a veil of fog: those are the
weather. There is a light static saturation and brightness filter on the
outdoor artwork under thick cloud, and it is deliberately small. It used to run
down to `saturate(.35)` and to name the clock widget too, so an overcast
hour — the commonest sky Copenhagen has — drained the shed's timber, its ferns,
its enamel jug and its digits along with the hillside, and the display spent
most of its life looking like a photocopy of itself. The room is indoors.
Nothing about the sky reaches it but the light through one painted window.

The exterior has an independent sun and moon, stars, four cloud layers,
precipitation, motes and fireflies. Rain speed and opacity follow intensity,
while snow drifts slowly. Snow adds a pale wash to the terrain, without claiming
measured snow accumulation. Rain is also visible through the shed window. Fire
appears on clear or partly cloudy evenings and nights, and disappears in wet
weather.

### Painted weather and a living clearing

The cloud artwork is in [public/weather/](../public/weather/README.md):
a transparent gouache cumulus bank and a continuous painted overcast ceiling.
The existing woodland day plate was the image-generation style reference.
Static filters tint the brushwork for dawn, dusk and night; no filter animates.

| Weather | Sky and foreground |
| --- | --- |
| clear | almost invisible high wisps, unobstructed sun and moon |
| partly | separate shaded cloud banks with open sky |
| cloudy | larger banks over a translucent ceiling |
| overcast | continuous textured ceiling with darker fragments underneath |
| rain | dark ceiling, two depths of fine drops, low vapour and ground ripples |
| sleet | the rainy ceiling and drops, with faster falling ice particles |
| snow | a pale ceiling, two depths of gently drifting flakes and a terrain wash |
| fog | a low-contrast ceiling and drifting mist across the distant trees |

The sky still wears the generated horizon mask, so every cloud and bird passes
behind the painted trees. Cumulus moves by exactly its repeat width. The closed
ceiling uses one oversized texture with a slow back-and-forth transform,
avoiding a visible tile seam. Overcast, fog and precipitation hide both celestial
discs and the stars.

Two feathered copies of the painting's canopy lean by less than half a degree.
They reuse the selected day/night plate and leave the trunks and horizon fixed.
Three small birds take occasional paths with different long periods; their
wings flap independently. These are irregular deterministic cycles, not a
random-number scheduler. Birds disappear at night and in fog or precipitation.
Each has its own line across the sky — one climbing away, one sagging and
recovering, one crossing the other way — rather than three passes along one
path. The flap is bounded: it flattens the drawn wings-up shape to a little
over a third and never mirrors it, because the largest bird is 13 px across
and the old `scaleY(1)` to `scaleY(-.45)` beat crossed zero twice a cycle,
leaving it a 13 x 0.03 px dash for about a quarter of every beat and inverted
for much of the rest. What reads as a wingbeat instead is the span
foreshortening as the wings rise, the body lifting on the power stroke, and an
asymmetric beat — quick down, slower recovery — four times before a glide.

The evening campfire has shaded logs and stones, two independently animated
painted flame sprites, five rising embers, two drifting smoke puffs, and separate
ground and air glows. It retains the clear/partly evening-and-night gate.
Flames emit their own light; the logs take the scene's ambient filter.

All effects use a fixed number of elements with CSS transform and opacity
animations. There are no new dependencies, fetches, timers or animation-frame
loops in the application. The three WebP assets total about 75 KB. Reduced
motion leaves the weather and lit fire still, and removes passing birds,
embers, smoke and ripples. The motion tool also accepts scenery selectors:
`npm run motion -- --offline --sky night,clear --selector .flame-front`.

**Fireflies** come out at dusk and hold the night, over the meadow and in the
trees outside the shed window, and wet weather and fog put them away. They are
the one piece of scenery that is an element per copy rather than gradients on
one layer: a firefly is defined by being out of step with the next one, being
out of step means an animation delay each, and a delay cannot vary within a
layer. Eight outside, four through the glass, two compositor-only animations
each — a wander that returns to where it began, and a slow blink that is dark
most of the time. They replaced four dots on one tiling layer that shared a
drift and a breath and read as fairy lights on a timer.

The paintings are static. Gear rotation, pendulum swing, lamplight,
cloud drift, rain and snow use CSS transforms and opacity. Tile travel equals
tile size for seamless weather loops. Reduced motion stops all these layers
and keeps a static resident at home without starting the behavior scheduler.

The implementation is divided between
[components/clock-workshop.tsx](../components/clock-workshop.tsx),
[components/weather-woodland.tsx](../components/weather-woodland.tsx),
[app/clock-workshop.css](../app/clock-workshop.css) for lighting and room props,
and [app/clock-hillside.css](../app/clock-hillside.css) for weather layers.
The layer primitives remain in [app/clock-theme.css](../app/clock-theme.css).

## Checking the scenes

`?sky=night,snow,heavy` pins light, condition and intensity for screenshots,
and `?sky=night,gibbous` pins the moon's phase — `new`, `crescent`, `half`,
`gibbous` or `full` — because the real one takes a fortnight to cross the
branch that draws it.
`npm run states -- --pair` captures both cards across twenty sky combinations.
Without `--pair`, it crops only the clock. Every capture is offline.
`--group light` isolates the four lighting variants; `--baseline` compares
against captures saved with `--save-baseline`. Baselines with different
crop dimensions are reported as incomparable. The seam scanner also reports
intentional straight edges such as the indoor bench.

Run `npm run audit` for layout, `npm run shot` for actual rendered appearance,
and `npm run motion` for the character and map frame cadence. The motion tool
does not prove scenery loops seamless; the weather tile rules are checked by
`npm run check:rules`. Run reduced-motion captures as well.
`npm run roll` captures the clock's existing mechanical digit roll.

## The digits and the date

The time is four digit cells and a colon on a fixed grid: two `.62em` columns,
a `.26em` colon, two more `.62em` columns. The cells never move, so nothing
about the time reflows. Only the digits that actually changed roll
(`changedDigits`), staggered from the right by `--roll-delay`; a first load, a
resumed screen or a clock correction snaps instead of rolling, and missed
minutes are never replayed. The colon pulses while the clock is live.

The workshop and plain clock use Fraunces at `opsz 144`, the same face and the
same axes as the weather card's temperature, so the display's two big numbers
are one voice. It is a subset face in `app/clock-fonts.css`, which
`npm run fonts:clock` generates from the list in
`scripts/fetch-clock-fonts.mjs`. `--digit-scale` fits its digits into the
`.62em` cells; the cells clip, so that number is measured, not chosen. Its
widest digit is a `0`, advancing `.613em` and inking `.578em`, so the scale
stays 1. Its figures are proportional rather than tabular -- a `1` is narrower
than the rest and is centred in its own cell, which is why nothing reflows. The
date is spelt out in full below the time — `Friday 5 September`, uppercased by
the stylesheet — from `clockDate()`, in `Europe/Copenhagen` like every other
formatter on the display.

Type is read through custom properties on `.clock-block` (`--digit-font`,
`--digit-scale`, `--digit-var`, the `--date-*` group, `--ink`, `--colon`,
`--date-ink`, `--glow`, `--colon-r`) rather than written into the rules. That
is deliberate: it is the seam the shelved wardrobe plugs back into.

## Shelved: outfits and set pieces

The clock used to dress itself in one of eighteen outfits every twenty to
forty minutes, crossfading between them, and play one of eight choreographed
set pieces on the digits every five to fifteen. Both are shelved in
[assets/clock-behavior/](../assets/clock-behavior/README.md), with the
stylesheets they animated, their tests, and instructions for putting them
back. The generated fonts were left alone, so nothing needs downloading again.

## The Tenant

An ivory forest pet inspired by the simple Chibi Totoro reference: a
pear-shaped body, slightly uneven ears, wide round eyes, tiny toes and a green
sprout. Its warm outline and flat cel colours are fixed. Its home is inside
the widget, to the right of the minutes with its feet on the digits' baseline.
The body, ears and retractable hand are **one closed SVG path**, defined by
`lib/tenant-drawing.ts`. Every pose has matching cubic segments, so CSS can
morph the contour during a short wave, ear twitch or sneeze without revealing
overlapping outlines. The hand disappears into the side at rest and emerges
only to wave or grasp the rain leaf. The static SVG path is the fallback for
browsers without CSS path animation. There are no filters, raster sprites, new
animation dependencies or per-frame JavaScript updates.

The sprout follows the existing secondary-motion layer (`.t-tail`); its sway
lags a jump and settles on landing. The eyes and mouth keep the original rig
inside a scaling `transform`, so the established gaze offsets still work.
A smile briefly closes the eyes into crescents and brings out soft cheeks;
the resting face leaves the mouth undrawn. A shelved big-Totoro drawing with
the same class names is kept in
[assets/tenant-skins/](../assets/tenant-skins/README.md). It is decoration
that knows where the numbers are, and what shape they are.

**Geometry.** After the fonts are ready, after every roll, and on resize,
`Clock` measures each digit: the cell's box from the DOM and the glyph's
metrics from a canvas `measureText` call in the face's computed font.
`inkBox()` turns those into the glyph's actual ink rectangle. Each digit is
also drawn once, at 96 px, on a small offscreen canvas, and `inkColumns()` reads
the top of the ink in every column; `topProfile()` classifies that top as a
**flat** bar wider than the Tenant (3 and 7 in Fraunces), a **ledge** narrower
than it (the stem of a 4), or a **round** arch (0, 1, 2, 5, 6, 8, 9), and finds
the apex: the centre of the highest flat run. `tenantTargets()` turns all of
that into one perch per digit, with `--perch-x/y` on the apex and the direction
in which an arch falls away. The
colon's top dot is measured too and is the fifth perch, a **ball**. That is why
it stands on the stem of a "1" rather than over its flag. Every measurement is
in `.clock-block`'s own coordinates, which is why the block stays the origin
however the widget around it is styled.

**Behaviour.** One sparse decision loop advances a tiny set of drives—energy,
curiosity, adventure and interest in the current panel—and chooses between
waiting, a gesture, perching and exploring (`lib/pet-behavior.ts`). It remembers
its recent activities, so expressive actions do not repeat like a playlist and
drive changes make an adventure more or less likely without locking it out.
Every free activity remains a candidate; energy, curiosity, recent memory and
the current surroundings only change their weights. Idle gestures include
natural and double blinks, layered eye/head glances, smiling, stretching,
wiggling, leaning, yawning, hopping, scratching, sneezing, waving, dozing and
listening. The small hop uses the same charged parabola as travel rather than
an inner-body shortcut. The cadence varies with energy rather than following
independent metronomes.

Every gesture that shuts the eyes — both blinks, the gaze blink, the sneeze,
the yawn, the stretch and the doze — draws the shut eye as a swap rather than
as a lid: the white, the pupils and the ring go out together and one filled
lens comes in, which is the same pattern the smile's crescents already used.
The lens is thickest in the middle and tapers to a corner at each end, so it
keeps roughly the weight the open eye had. It used to be a fur lid sliding
down while the stroked ring squashed to `scaleY(.06)`, and that squash is why
it is gone: the eye rig is scaled `.77` vertically, so six percent of a
26-unit ellipse lands under a pixel and anti-aliases into a broken hairline. A
blink was quick enough to hide it, a doze held it for 1.3 s. Nothing is scaled
now and there is no in-between drawing, so the gesture reads the same however
slowly it plays. The half-lids in the sprawled, teetering and falling poses are
a separate expression and still use the lid.

The Tenant is not confined to the widget. `Clock` measures five destination
landmarks and a network of safe landing pads from their real DOM boxes: the
weather card, rain ribbon, week days, active transport-board rules, fact image
and footer, forecast-map edges and the compact departures rule. A long route is
a chain of jumps through those pads; a nearby destination is one jump. Every hop
charges with an anticipation squash, follows a quadratic parabola and lands
fully before the next one begins, so it never glides diagonally through the UI
or bounces on an invented point in empty space. A scene change raises interest
in its new landmark; on some later decision the Tenant travels there and reacts
to what it finds—reading the week, waiting at departures, admiring a fact or
tracking the map. The preferred landmark is more likely, never mandatory, and
other measured destinations remain available. If that scene rotates away, it
routes home from its actual current position because its supporting surface is
leaving. Scene, minute, hour and weather changes adjust the mind's drives but do
not directly select an animation.

A minute boundary never summons the Tenant. If it is already perched on a
digit that rolls away, it loses its footing; otherwise the roll is merely a
stimulus that can influence some later free choice. When curiosity and
adventure make a perch appealing, it jumps onto a digit or the colon
(`pickPerch`, the minutes favoured) and stays 6 to 14
seconds, less on the colon. What it does up there depends on what it is
standing on (`pickPerchAction`): on a bar it sits with its feet out or peers
over the edge; on a ledge it teeters; on an
arch it sways all the while, slips down the curve and catches itself; on the
colon it balances hard, feet together, and the dots squash when it lands and
spring when it leaves (`tn-land`, `tn-spring` on the block). A digit that
rolls out from under it takes its footing with it: it stumbles, falls to the
baseline in front of the digit, lies there squashed and dazed for a moment,
then charges and jumps home. A roll elsewhere only changes its drives; it does
not dictate a glance or another reaction. Every ordinary departure from a
perch is also a charged jump. Between 23:00 and 06:00 its resting style sleeps
and the clock dims to 72 %. It
holds a broad leaf over its ears when the current hour is wet, wears sunglasses
above 25° and a scarf below 0°, using the same fields the weather card shows.

Nothing in the clock interrupts the Tenant any more. `busy` on `<Tenant>` is
what held it still while the clock dressed or played a set piece; it is passed
as `false` and kept as the seam those would plug back into. Digit rolls were
never postponed either way: they are part of the environment it encounters.

**Motion.** Every intentional position change uses one jump pipeline, including
getting onto and off a digit, the idle hop, dashboard travel and coming home.
`tenantHopArc()` solves ascent and descent under constant gravity; the apex
shifts along the flight when the landing pad is higher or lower. Horizontal
speed stays constant in the air. Height scales with distance and is capped by
the available viewport headroom, including the sprout. Charge lasts 330–560 ms
depending on effort; landing compression and recovery reflect impact speed.

`lib/tenant-motion.ts` samples the flight at 48 intervals plus the exact apex
and contact instant, then adds damped landing recovery. The browser plays these
transform-only tracks with the Web Animations API. Stage changes use actual
animation completion, so there is no timeout gap at takeoff or landing. A
scene change samples the current matrix before replacing the animation, and
the filled final frame is released only after the destination pose is in the
DOM. Animations and their finish callbacks are cancelled on teardown.

Balance uses a damped spring responding to small, uneven weight shifts rather
than looping left/right rotations. The surface controls their strength, from
a barely noticeable shift on a flat top to active corrections on a colon.
Peeking, teetering, idle leaning and investigating the weather/map use spring
tracks too. Observation time and lean depth vary; eyes acquire the subject
first, the torso follows, and the head and sprout lag at different rates.
The simulations run once per action and produce bounded keyframe arrays, with
no per-frame JavaScript, new polling loop or dependency.

The SVG layers compose: the root carries travel, `.t-figure` breathing,
`.t-balance` weight corrections, `.t-posture` the intentional lean, `.t-gest`
other gestures, and `.t-pose` sitting. Head/sprout counter-motion has separate
wrappers. Interrupting a spring track eases from its live transform instead of
snapping to neutral. Involuntary falls retain their separate animation.

## Reduced motion

Under `prefers-reduced-motion: reduce` the roll snaps, scenery stops, and a
static resident stays at home. The live Tenant scheduler is not mounted.

## Checking it

Everything about *which* and *when* is in `lib/` and covered by
`tests/clock.test.mjs`, `tests/clock-conditions.test.mjs`,
`tests/clock-tenant.test.mjs` and `tests/pet-behavior.test.mjs`, including the
top-shape classifier, which is tested against the measured column tops of the
Grotesk digits. `npm run audit` checks the card at 1280 x 720, and
`npm run shot -- --offline --clip .clock-widget` is the picture of it;
`--clip .clock-block` crops to the digits alone, without the card.

The Tenant's poses are classes on `.tenant` (`pose-perched on-round pa-slip`),
positioned by the custom properties the component sets on it. Add `?pet=weather`,
`week`, `transport`, `fact` or `map`
to hold it at a measured dashboard landmark for a reproducible visual check.
Prefix the value with `travel-` (for example `?pet=travel-map`) to replay the
real safe-spot route and hold only after it arrives. For procedural motion,
`?pet-motion=hop`, `balance` and `peek` replay actual motion on measured clock
surfaces without waiting for an autonomous choice; changing CSS classes alone
cannot start these tracks. These previews take precedence over the pet landmark
flags. Reload to replay. Use `--url` with the screenshot/motion tools and keep
`--offline --transit-demo` enabled.

`tests/tenant-motion.test.mjs` checks constant gravity, exact endpoints,
ceiling clearance, planted landing recovery, interpolation error, bounded
spring tracks and variation between seeds.

`tests/tenant-drawing.test.mjs` guards the single-contour morph topology and
the stable belly baseline. For the drawing itself, capture `.tenant` with
padding for the sprout, force `g-wave`, `g-listen`, `g-smile` or `mood-rain`,
and inspect a sequence as well as a still. Travel is checked with
`npm run motion -- --offline --transit-demo --time 14:24 --pet travel-transport --selector .tenant --wait 300 --seconds 12`.
