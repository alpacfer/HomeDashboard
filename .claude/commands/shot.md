---
description: Capture the running dashboard at 1280 x 720 with scripts/screenshot.mjs
allowed-tools: Bash(npm run shot:*), Bash(node scripts/screenshot.mjs:*), Read, Grep, Glob, SendUserFile, mcp__Claude_Browser__preview_start, mcp__Claude_Browser__preview_list
---

Capture the dashboard for visual confirmation. Arguments: $ARGUMENTS

1. Make sure a dev server answers on http://127.0.0.1:3000 (start it with the
   preview tool if not; never with a bare Bash `npm run dev`).
2. Run `npm run shot -- <options>` with the arguments given, or choose them
   from the change being checked (see docs/DEBUGGING.md):
   - `--scene transport|fact|map` pins the rotating panel;
   - `--offline` when the capture is not about the weather, so it spends no
     provider quota;
   - `--reduced-motion` when animation was touched;
   - `--clip <selector>` for the smallest image that shows the change, e.g.
     `--clip .clock-block` or `--clip .weather-band`;
   - `--class "<sel>=<names>"` to force an element's class list, e.g.
     `--class ".tenant=tenant pose-perched on-round pa-slip"` for a Tenant
     pose. It replaces the *whole* list, so name the element's own class too
     or its styling goes with it.
3. Send the PNG(s) to the user with SendUserFile and state what each shows.
   If `--console` reports warnings, read them before deciding the change works.
