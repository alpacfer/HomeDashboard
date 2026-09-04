---
name: "source-command-check"
description: "Run the full verification suite and report what passed or failed"
---

# source-command-check

Use this skill when the user asks to run the migrated source command `check`.

## Command Template

Run `npm run check`.

Report the result for each stage: lint, typecheck, test, docs, rules, build.
If a stage fails, show the relevant output and diagnose the cause before
suggesting a fix. Do not report success unless every stage passed.
