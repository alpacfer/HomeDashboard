# The clock: the widget, and the Tenant

The clock is the one thing on the display that is always on screen. It is one
enclosed widget holding three things: the time, the date, and the home of a
small resident character. One rule governs everything in it: **nothing changes
abruptly.** Every transition is a fade, a move or a morph that starts from
where the clock is and ends at rest.

```text
components/clock.tsx      timers, measurement, markup
components/tenant.tsx     the character's own timers and its SVG
lib/clock-motion.ts       Copenhagen time, the date, which digits roll
lib/clock-conditions.ts   the hour and the sky the character reads
lib/clock-tenant.ts       mood, idle life, glyph geometry
app/clock-fonts.css       generated @font-face rules (do not edit)
public/fonts/clock/       generated subset woff2 files (do not edit)
scripts/fetch-clock-fonts.mjs  regenerates both of the above
```

## The widget

`.clock-widget` is the frame: a rounded card that spans the shell's width, in
the same family as the weather card under it. `.clock-surface` is its
background, on a layer of its own, and `.clock-block` sits above that with the
digits, the date and the character.

The background is a separate layer rather than a `background` on the frame
because the Tenant leaves the card. A frame that clipped its own backdrop to
its rounded corners would clip the character with it, so the frame stays
unclipped and only the surface layer is rounded and hidden. For the same
reason `.clock-block` carries no `z-index`: that would make it a stacking
context and trap a travelling character inside the card. Being the later
positioned sibling is what puts it above the surface.

Two custom properties on `.clock-widget` are the whole of the styling seam:

| Property | Is | Default |
| --- | --- | --- |
| `--clock-surface` | Passed straight to `background`, so it takes a colour, a gradient or a `url()`. | `rgba(243,242,238,.035)` |
| `--clock-ring` | The hairline around the card, drawn as an inset shadow. | `rgba(243,242,238,.09)` |

The card's padding is vertical only. The horizontal inset stays on `.clock`
and `.clock-date` as `--panel-inset`, so the digits sit exactly where they
always did and the surface reaches the shell's edges the way the weather
card's does.

## The theme

A theme is a class on `.clock-widget` and nothing else. It dresses the card
through the properties above and the type group below, paints scenery into the
backdrop layers, and replaces the digit roll with a transition of its own.
[lib/clock-theme.ts](../lib/clock-theme.ts) holds the list; `?clock=<id>` pins
one, and `?clock=plain` is the bare card as it was before themes existed.

```text
app/clock-theme.css     The framework: the layer primitives, the shared
                        keyframes, the reduced-motion kill switch. Knows that
                        a theme has layers and that layers move; knows nothing
                        about hills or weather.
app/clock-hillside.css  One theme, in seven numbered sections.
lib/clock-theme.ts      The list of ids, and the `?clock=` pin.
lib/clock-sky.ts        What the hillside's sky is doing, and the `?sky=` pin.
```

Adding a theme is a new `app/clock-<id>.css`, an import in
[app/layout.tsx](../app/layout.tsx), and an id in `CLOCK_THEMES`. Nothing in
the framework or in `components/clock.tsx` changes. Adding a *layer* is a span
in the component and a name in the primitives rule.

**Hillside** is the default: a hill above the harbour, lit by the real sun and
rained on by the real forecast. [lib/clock-sky.ts](../lib/clock-sky.ts) turns
the hour and the weather panel's report into three attributes on the widget,
and every rule that paints weather is an attribute selector on one of them.

| Attribute | Is | From |
| --- | --- | --- |
| `data-light` | `night`, `dawn`, `day`, `dusk` | `solarElevation()`, not the wall clock. Copenhagen's sunset moves by six hours across the year. |
| `data-weather` | `clear`, `partly`, `cloudy`, `overcast`, `fog`, `rain`, `sleet`, `snow` | The same `describeHour()` classification the weather card draws its own icon from. |
| `data-fall` | `none`, `light`, `moderate`, `heavy` | The precipitation band, and only for a kind that can fall. |

The three are independent, so snow at dawn and rain at night are already drawn
without a rule of their own. `Conditions` carries `kind` and `band` up from
the panel untouched: a second classifier would be a way for the card and the
clock to disagree about the same hour.

Scenery is gradients, not images. A tree line is a row of circles of four
different radii above a solid band; a cloud bank is the same trick in soft
white; rain is elongated radial streaks on a rotated, oversized layer. Two
colours are switches rather than colours — `--star` and `--cap` are transparent
almost always, and the star and snow-cap gradients are painted at every hour,
which is what keeps "night" and "snow" to one declaration each instead of a
second copy of every layer.

Motion is a transform on a whole layer, never a `background-position`, so the
compositor carries it and the card is never repainted. A drifting layer keeps
every gradient on one `background-size` and places them inside that tile,
because a layer only loops seamlessly when it is shifted by exactly one tile.

`.cs-flora` is what grows on the clock: a vine up the left frame and a tuft in
the corner the Tenant does not stand in. It is outside the clipped surface and
in front of the block, so a leaf sits on the frame and overhangs the edge, and
it leans from its base in the same wind that moves the canopy. It is a path
rather than a gradient because a stem is a curve, and it is inline, so it costs
no request and no decode.

`?sky=night,snow,heavy` pins any of the three, in any order, which is the only
way to photograph a sky the real weather is not currently offering. It is read
in `lib/clock-sky.ts` rather than `lib/debug-flags.ts` for the same reason
`?date=` is read in `lib/daily-facts.ts`: that is where the value is derived.

`npm run states` drives twenty of those pins through one browser and lays them
on one sheet, which is how the theme is actually looked at — a fault in this
kind of scenery is invisible in one tile and obvious in twenty.
`npm run states -- --seams` then reads the captures back and names rows where
the image changes sharply across most of its width. That is what a gradient
clipped at a box edge leaves behind, and what a hill or a cloud never does. It
is worth trusting: it found the snow caps being cut into a bright line across
the card at the canopy's band edge, after four rounds of looking had not.

`npm run states -- --save-baseline` remembers the twenty, and `--baseline`
then reports what moved since — per state, as a share of pixels and the rows
they sit in. That is the half that is easy to skip: a change to one layer is
meant to move some states and leave the rest alone, and twice while this theme
was built a cloud adjustment quietly moved the ridge as well.

`npm run roll` catches the digit transition. It happens on the minute boundary
and lasts 840 ms plus stagger, and it is the only thing on the display that
cannot be pinned or replayed — but `?time=` shifts the clock by whole minutes
and keeps the seconds, so the boundary is always at :00 of the real clock. The
tool waits for the page's own clock to reach :58.7 and then captures a fast
strip across it. `--sky day,rain,heavy` shows the wash instead of the breeze.
All three transitions shipped once before anyone had seen one move.

Two invariants about the scenery are checked without a browser, by
`npm run check:rules`: a `cs-drift` layer must write its tile width as
`var(--tile)`, and a `cs-rain` or `cs-snow` layer's `background-size` height
must equal the distance its keyframe travels. Both decide whether a loop is
seamless, and both fail so rarely — once per cycle, and the slowest cycle here
is nearly eight minutes — that no amount of watching would catch them.

`npm run audit` covers two of the skies as well (`clock-bright` is snow on a
lit midday canopy, `clock-dark` a clear night), because the type crosses the
canopy and the canopy is repainted by the weather. Auditing whichever sky the
forecast happens to be showing checks the one state that is not at risk.
`--sky` is a URL flag on `shot`, `motion` and `audit` alike.

## The digits and the date

The time is four digit cells and a colon on a fixed grid: two `.62em` columns,
a `.26em` colon, two more `.62em` columns. The cells never move, so nothing
about the time reflows. Only the digits that actually changed roll
(`changedDigits`), staggered from the right by `--roll-delay`; a first load, a
resumed screen or a clock correction snaps instead of rolling, and missed
minutes are never replayed. The colon pulses while the clock is live.

The face is Clock Grotesk, one of the subset faces in `app/clock-fonts.css`,
which `npm run fonts:clock` generates from the list in
`scripts/fetch-clock-fonts.mjs`. `--digit-scale` fits its digits into the
`.62em` cells; the cells clip, so that number is measured, not chosen. The
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
**flat** bar wider than the Tenant (3, 5, 7 in Grotesk), a **ledge** narrower
than it (the stem of a 1 or a 4), or a **round** arch (0, 2, 6, 8, 9), and finds
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

Under `prefers-reduced-motion: reduce` the roll snaps and the Tenant is not
rendered.

## Checking it

Everything about *which* and *when* is in `lib/` and covered by
`tests/clock.test.mjs`, `tests/clock-conditions.test.mjs`,
`tests/clock-tenant.test.mjs` and `tests/pet-behavior.test.mjs`, including the
top-shape classifier, which is tested against the measured column tops of the
Grotesk digits. `npm run audit` checks the card at both layouts, and
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
