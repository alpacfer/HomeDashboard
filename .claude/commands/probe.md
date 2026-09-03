---
description: Ask every forecast provider as the browser would and report which ones answer
allowed-tools: Bash(npm run probe), Bash(npm run probe:*)
---

Run `npm run probe` (add `-- --grid` only if the forecast map itself is the
question: that request costs about three hundred Open-Meteo calls).

Report, per provider: HTTP status, latency, whether the payload parsed, and
the reason it did not. Then say what the display is doing about it: which
provider the weather card is on, whether the card is muted (data older than
45 minutes) or only showing the dot (last refresh failed), and whether the
week strip and the forecast map have a source. Quote the quota line at the
end of the output when Open-Meteo answers 429. See docs/DEBUGGING.md.
