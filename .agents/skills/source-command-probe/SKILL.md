---
name: "source-command-probe"
description: "Ask every forecast provider as the browser would and report which ones answer"
---

# source-command-probe

Use this skill when the user asks to run the migrated source command `probe`.

## Command Template

Run `npm run probe` (add `-- --grid` only if the forecast map itself is the
question: that request costs about three hundred Open-Meteo calls).

Report, per provider: HTTP status, latency, whether the payload parsed, and
the reason it did not. Then say what the display is doing about it: which
provider the weather card is on, whether the card is muted (data older than
45 minutes) or only showing the dot (last refresh failed), and whether the
week strip and the forecast map have a source. Quote the quota line at the
end of the output when Open-Meteo answers 429. See docs/DEBUGGING.md.
