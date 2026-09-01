# Rejseplanen connection

The dashboard uses the official Rejseplanen API 2.0. Live access is not yet
verified: the owner must obtain an approved access ID from Rejseplanen Labs.
Configure REJSEPLANEN_ACCESS_ID in the ignored .env.local file. Never use a NEXT_PUBLIC variable for this key.

Only the server route app/api/departures/route.ts calls Rejseplanen.
The browser receives filtered, normalized public departure information, not
the access ID. With no key, the route returns needs_key and the UI shows dashes.
There are no simulated departure times in the production dashboard.

Two departure boards are requested at most once per two-minute cache window,
with a one-day stop lookup cache. One continuously running display uses roughly
44,640 board requests in 31 days, plus location lookups; additional server processes
can increase usage. Recheck the provider's quota before sharing.

Stops are resolved by exact name through location.name, using returned main
mast identifiers for opposing platforms. Ambiguous matches fail closed.
After obtaining a key, verify these matches and real responses before calling
the integration fully tested:

- Kildegårds Plads (Lyngbyvej): 184 north to Holte St. or Lyngby St. (label Lyngby), south to Nørreport St.
- Kildegårds Plads (Lyngbyvej): 150S north to Kokkedal St., south to Nørreport St.
- Lyngby St.: S-train A to Hillerød St.

Realtime departures override scheduled times. Cancellations and delays remain
visible. Entries older than five minutes are hidden after a connection failure.
The API retains twelve upcoming matches per line and direction; the browser displays three in each direction column.
Board keys combine the line and direction (e.g. 184:north, 184:south).
The missing-key state intentionally has no visible connection prompt; dashes
remain until real departure information is available.

Official references:
- https://labs.rejseplanen.dk/hc/da/articles/21553113674909-Adgang-til-data-fra-Labs
- https://www.rejseplanen.dk/api/departureBoard?wadl
- https://www.rejseplanen.dk/api/location.name?wadl
- https://www.rejseplanen.dk/api/xsd/rest.xsd
