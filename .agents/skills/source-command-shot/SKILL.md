---
name: "source-command-shot"
description: "Capture the running dashboard at 1280 x 720 with scripts/screenshot.mjs"
---

# source-command-shot

Use this skill when the user asks to run the migrated source command `shot`.

## Command Template

Capture the dashboard for visual confirmation. Arguments: $ARGUMENTS

1. Make sure a dev server answers on http://127.0.0.1:3000. If it does not,
   start one with the preview tool (`homedashboard`); never with a bare Bash
   `npm run dev`. If it already does, that is another session's server for
   this same folder and it serves this working tree: use it. Attach the pane
   with the `homedashboard-attach` configuration if the pane is needed at
   all; the script only needs the URL.
2. Run `npm run shot -- <options>` with the arguments given, or choose them
   from the change being checked (`npm run shot -- --help` lists every flag;
   docs/DEBUGGING.md says why):
   - `--scene transport|fact|map` pins the rotating panel;
   - `--offline` when the capture is not about the weather, so it spends no
     provider quota; `--demo` when the forecast map is the subject;
   - `--reduced-motion` when animation was touched;
   - `--clip <selector>` for the smallest image that shows the change, e.g.
     `--clip .clock-block` or `--clip .weather-band`. A selector that matches
     nothing fails and names the nearest class names; use one of those;
   - `--class "<sel>=<names>"` to force an element's class list, e.g.
     `--class ".tenant=tenant pose-perched on-round pa-slip"` for a Tenant
     pose. It replaces the *whole* list, so name the element's own class too
     or its styling goes with it;
   - `--pose "<sel>=<phase>"` to hold a moving element at a moment of its own
     animation (`7%`, `350ms`); `--freeze <ms>` to pause the whole page;
   - `--then` to capture several states in one browser: flags before the
     first `--then` are the base, each group after it is the base plus its
     changes, one file each. Never loop `npm run shot` in a shell.
3. Send the PNG(s) to the user with SendUserFile and state what each shows.
   If `--console` reports warnings, read them before deciding the change works.
