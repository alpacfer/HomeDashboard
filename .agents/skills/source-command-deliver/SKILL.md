---
name: "source-command-deliver"
description: "Finish a change the way AGENTS.md asks: check, audit, motion when animated, screenshots, honest report"
---

# source-command-deliver

Use this skill when the user asks to run the migrated source command `deliver`.

## Command Template

Deliver the pending change. Arguments: $ARGUMENTS (what changed, in a phrase)

1. Run `npm run check`. On any failure, fix the cause and rerun; never report
   success without a green run, and never disable a rule to get one.
2. If anything rendered changed, run `npm run audit`. If a baseline was saved
   before the change, add `--baseline` and read what moved against intent.
   If anything animates, run `npm run motion` on the element or scene.
3. Capture every state the change has in one `npm run shot` command, one
   `--then` group per state: `--offline` unless the weather is the subject,
   `--demo` when the forecast map is, `--clip` to the smallest element that
   shows the change, `--reduced-motion` as a further group when animation
   was touched. The dev server on port 3000 serves this working tree
   whichever session started it.
4. Report: the changed files as links, what each check said (quote a
   failure), and every screenshot shown, not linked. Say plainly if a step
   was skipped and why. Do not commit unless asked.
