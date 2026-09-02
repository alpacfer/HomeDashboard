---
description: Run the full verification suite and report what passed or failed
allowed-tools: Bash(npm run check), Bash(npm run lint), Bash(npm run typecheck), Bash(npm test), Bash(npm run docs:check), Bash(npm run build)
---

Run `npm run check`.

Report the result for each stage: lint, typecheck, test, docs, build. If a
stage fails, show the relevant output and diagnose the cause before suggesting
a fix. Do not report success unless every stage passed.
