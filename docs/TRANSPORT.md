# Transit connection

The dashboard asks two providers for departures, in order. Rejseplanen's own
API 2.0 is the primary source; Transitous is the keyless fallback, and it is
what answers today, because no access ID has been granted yet.

Only the server route `app/api/departures/route.ts` talks to either provider.
The browser receives filtered, normalized public departure information, never a
credential. There are no simulated departure times in the production dashboard.

## Why these two, and not an official keyless one

There is no official Danish source that answers a departure-board request over
plain HTTP without credentials. This was checked against Rejseplanen Labs'
own inventory of published data and Vejdirektoratet's Dataudveksleren:

| Official source | Realtime | Delivered as | Access |
| --- | --- | --- | --- |
| Rejseplanen API 2.0 | yes | REST, JSON or XML | access ID, free for non-commercial use up to 50,000 calls a month, granted on request |
| GTFS Schedule/Static | no | ZIP, updated about every 14 days | free after a Labs request |
| Stop data | no | CSV | free after a Labs request |
| NeTEx | no | XML | NemLog-in on Dataudveksleren |
| SIRI-ET | **yes** | **AMQP event subscription**, XML, CC BY | registration on Dataudveksleren |

SIRI-ET is the interesting one: it is genuinely open data, published per
operator ("Realtime data for Movia", "Realtime data for DSB S-trains") by
Rejsekort & Rejseplan A/S through the National Access Point, and it carries
exactly the disruptions, time deviations and cancellations this panel wants.
It is unusable here anyway. The NAP records it as `distributionServiceType:
Events`, `adapterType: GenericAmqpEvent`: a consumer must hold a persistent
AMQP subscription to an operator-wide stream of journey updates and match each
one against a full Danish GTFS timetable it keeps in memory. A Render free
instance sleeps when idle and has 512 MB. It can hold neither.

Movia and DSB publish no separate public departure API of their own; both route
through Rejseplanen. The old keyless `xmlopen.rejseplanen.dk` returns a
deprecation notice: API 1.0 is closed.

**Transitous** is a community-run MOTIS instance, and what it serves for
Denmark is the official data: Rejseplanen's GTFS, plus that same Rejsekart &
Rejseplan A/S SIRI feed, converted from the event queue. So the departures,
delays and cancellations below originate first-party even though the endpoint
does not. Realtime coverage is thinner than Rejseplanen's — roughly half of
events carry a live time against nearly all of them — which is why the panel
prints `Live times via Transitous` while the fallback is answering.

Transitous asks for open-source, non-commercial use, an identifying
`User-Agent`, and contact before heavy use. All three live in
`lib/transitous.ts`, the only file that talks to them. Two stop requests every
two minutes is about 115 MB a day; if the display ever asks for more, write to
them first.

**The primary is still worth having.** Request an access ID at
<https://labs.rejseplanen.dk>; it is free for non-commercial use at 50,000
calls a month, and this display uses about 44,640. Set
`REJSEPLANEN_ACCESS_ID` in the ignored `.env.local` and the route prefers it
automatically, with no other change. Never use a `NEXT_PUBLIC_` variable for
this key.

## Stops and directions

Stops are configured in `lib/transit.ts` and resolved differently per provider.

Rejseplanen resolves them by exact name through `location.name`, using returned
main mast identifiers for opposing platforms; ambiguous matches fail closed.

Transitous uses hardcoded stop ids in `lib/transitous.ts`, in the namespace it
gives the Danish feed — a geocode call before every board would double the
requests for an answer that does not change. The response must name the stop
that was asked for or the whole board is refused, so a renumbered stop shows
dashes rather than another platform's times.

**The two providers do not use the same destination strings**, which is why
`TRANSITOUS_HEADSIGNS` exists separately from `termini` rather than reusing it:

| Board | Rejseplanen `DestinationStop` | GTFS `trip_headsign` |
| --- | --- | --- |
| 184 north (labelled Lyngby) | Holte St., Lyngby St. | Vedbæk St. |
| 184 south | Nørreport St. | Nørreport St. |
| 150S north (labelled Kokkedal) | Kokkedal St. | Kokkedal St., Gl. Holte Øverødvej, Søhuset Forskerparken, Rævehøjvej DTU |
| 150S south | Nørreport St. | Nørreport St. |
| A north (Lyngby St.) | Hillerød St. | Hillerød St. |

150S runs to four different termini up the same corridor and the fallback lists
all of them, because they are all northbound departures a passenger can board.
An unknown headsign is dropped rather than filed under a guessed direction, so
a new short-turn goes missing rather than wrong. `npm run probe:transit
--headsigns` lists what each stop is actually signing today and marks the ones
the configuration does not know.

The Rejseplanen strings above have never been checked against a live response,
because no key has been granted. After obtaining one, verify each row before
calling that path tested.

## Delays and incidents

Both providers feed the same `Departure` shape, and `departureIncidents` in
`lib/transit.ts` turns one into the marks the panel draws, most severe first:

| Mark | Condition | Severity |
| --- | --- | --- |
| `Cancelled` | `cancelled`, or the whole trip is | severe |
| service message | provider alert text | its own grade, raised for `NO_SERVICE` and `SIGNIFICANT_DELAYS` |
| `+N min` | expected later than scheduled | warning, severe from 10 minutes |
| `Track N (was M)` | realtime platform differs from the planned one | warning |
| `-N min` | expected earlier than scheduled | info |

A departure with nothing wrong is left unmarked. Saying "Live" under each of
the fifteen ordinary times on screen spent a row of height to tell the reader
nothing, so whether a time is being tracked is carried instead by a small green
dot before it: **a dot means a live feed is reporting that journey**, and an
unmarked time is the timetable's, which may already be running late without
anyone knowing. It rides on the line the time already occupies, so it costs no
height. There is no legend on a wall, so the meaning is in the `aria-label`.

Expect fewer dots on the fallback: Transitous carries realtime on about half of
events against nearly all of Rejseplanen's.

**A cancelled departure shows no countdown.** Minutes until a bus that is not
coming is the one number on the board that can send somebody to the stop for
nothing, so the slot holds a cross, the scheduled time below it is struck
through, and `Cancelled` says why. The cross is `aria-hidden`; the whole cell is
announced as "The 09:02 is cancelled". An earlier version struck the countdown
itself through, which sat low across the tabular digits and read as a rendering
fault rather than as a cancellation.

A cancellation outranks its own delay. A departure that is not on time colours
its own countdown, because the number is the only part legible from across the
room, and prints the time it should have left struck through beside the time it
now will — the minutes alone do not say which of two printed times to trust.
Cancellations and service messages also collect into a summary line above the
boards, deduplicated, capped at two, and dropped as soon as the affected
departure has gone.

Alert text is external input: it is collapsed, trimmed and capped at 90
characters in `lib/transit.ts` before it can reach React state, and at most two
alerts ride with a departure. The Danish realtime feed currently carries no
alerts at all, so that path is exercised by tests and `?transit=demo` rather
than by the wall.

## Translating service messages

Both providers write their disruptions in Danish. DeepL turns them into English
before they reach the browser: `lib/translation.ts` holds the pure part
(choosing what to send, building the request, reading the answer, putting the
results back) and `app/api/departures/route.ts` makes the call, because `lib/`
may not reach the network.

`DEEPL_API_KEY` is a credential. It goes in the ignored `.env.local` and in
Render's environment, never in a `NEXT_PUBLIC_` variable and never in the
repository. A key ending `:fx` is free-tier and is sent to `api-free.deepl.com`;
anything else goes to `api.deepl.com`. **With no key set, alerts simply stay in
Danish** — nothing else changes.

Everything about it fails open. A translator that is down, throttled, out of
quota or answering something unexpected costs the display its English and never
its departures, and a partial answer is refused outright rather than
half-applied, because a board half in Danish and half in English reads as a bug.

The free tier allows 500,000 characters a month, and three guards keep the
display far under it: alert text is already capped at 90 characters, only
*distinct* strings are sent (one disruption repeats across every departure of
the line), and a successful translation is cached for a day. At most twelve
strings go in one request, so a provider that attaches a different message to
every departure cannot spend the month in a single refresh. Only public service
messages are ever sent; nothing personal passes through.

## How often a line runs

Each direction heading prints `every N min`, from `serviceHeadway` in
`lib/transit.ts`. It is the median gap between the next six scheduled
departures **in that one direction**.

It belongs to the direction, not to the stop or the line: a stop is served by
several lines and a line by two directions, so anything wider answers a
question nobody asked. 184 runs every twenty minutes each way, and counting
both directions at Kildegårds Plads would have called it ten. It reads
`scheduled` rather than `expected`, because "every twenty minutes" is a property
of the timetable and one late bus should not restate it, and takes a median,
because the last gap on a 24-hour board runs to the end of service.

It is deliberately approximate: rounded to the minute below ten and to the
nearest five above, and withheld entirely when there are fewer than three
upcoming departures in every direction or the gap exceeds an hour. It describes
the line, it does not promise it.

## Requests and caching

Two departure boards are requested at most once per two-minute cache window.
One continuously running display uses roughly 44,640 board requests in 31 days,
plus location lookups for Rejseplanen; additional server processes increase
that. Recheck the provider's quota before sharing.

Both providers are tried inside the twelve seconds the browser waits: six
seconds for Rejseplanen, five for Transitous, each request with its own
`AbortController`. A shared deadline would let one slow board spend the whole
budget and leave nothing for the fallback.

**Live times are requested by name, not inherited.** The fallback's query is
built once, in `stopTimesQuery` in `lib/transitous.ts`, and it names
`realtimeMode=REALTIME` even though that is currently MOTIS's own default. The
live time of the *next* departure is the most valuable field on the board, and
a provider default is the wrong place to keep it: `realtimeMode=OFF` returns
the same events with every live flag cleared, which would cost the display
every dot and every delay while still looking like a working board. The route
and `npm run probe:transit` both build the query there, so the probe's claim to
ask "exactly as the route would" stays true.

The events come back sorted by realtime departure and every board is read from
the front, so a later departure can never crowd out the next one. What the
budget is spent on, if it ever has to shrink, is board *depth* — never refresh
rate, which is what keeps the next departure's live time current.

Rejseplanen's `rtMode` is still `SERVER_DEFAULT`, which is the same
inherited-default shape. It is deliberately left alone: no access ID has been
granted, so the value cannot be checked against a live response, and a wrong
HAFAS enum would fail the primary over to the fallback. Set it explicitly when
verifying that path after a key arrives.

Realtime departures override scheduled times. Cancellations, delays and
platform changes stay visible. Entries older than five minutes are hidden after
a connection failure. Each provider retains twelve upcoming matches per line
and direction; the browser displays three in each direction column. Board keys
combine the line and direction (for example `184:north`, `184:south`).

`status: needs_key` is still handled by the browser, for a payload from an
older deployment during a rolling restart, but the route no longer returns it:
without a key it serves the fallback instead.

## Checking it

```sh
npm run probe:transit               # which provider answers, and what each board would show
npm run probe:transit -- --headsigns  # every headsign each stop is signing today
```

The probe confirms the hardcoded Transitous stop ids against the geocoder,
prints delays, cancellations, platform changes and alerts as the display would
mark them, and says plainly when `REJSEPLANEN_ACCESS_ID` is unset. It never
prints the key.

Official references:

- <https://labs.rejseplanen.dk/hc/da/articles/24750139021341-Oversigt-over-udstillede-data>
- <https://labs.rejseplanen.dk/hc/da/articles/21553113674909-Adgang-til-API-GTFS-og-stoppestedsdata>
- <https://du-portal-ui.dataudveksler.app.vd.dk/data> — Dataudveksleren, the National Access Point
- <https://www.rejseplanen.dk/api/departureBoard?wadl>
- <https://www.rejseplanen.dk/api/location.name?wadl>
- <https://transitous.org/api/> — the fallback's API and usage policy
