---
name: "source-command-target-review"
description: "Review the pending changes against the Render free plan and Fire TV Stick limits"
---

# source-command-target-review

Use this skill when the user asks to run the migrated source command `target-review`.

## Command Template

Read `docs/DEPLOYMENT.md`, then review the current diff (`git diff` plus any
untracked files) specifically against the deployment target. Ignore ordinary
code-quality issues; another review covers those.

Check for:

1. New dependencies, or existing ones pulled into the client bundle. Compare
   the route table from `npm run build` against `main` if the diff touches
   imports.
2. Timers, event listeners, observers, or Leaflet layers created without a
   matching cleanup. The display runs for weeks without a reload.
3. Animation on properties other than `transform` and `opacity`.
4. Anything that depends on hover, pointer, or keyboard input.
5. Work moved to the server that the browser could do itself.
6. Layout that assumes a viewport other than 1280 x 720.
7. Polling added or made more frequent, and its effect on Render free instance
   hours.

Report findings most severe first, each naming the file and line. If the diff
is clean against all seven, say so plainly rather than inventing concerns.
