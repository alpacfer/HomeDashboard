# Agent workflow

## Visual confirmation

For every user-requested change that affects rendered behavior, run the dashboard and capture a screenshot of the relevant state before delivery. Show that screenshot in the final response so the user can confirm the result visually.

Use the smallest screenshot that demonstrates the change: for example, the clock/date and forecast area for display changes, or the relevant panel for a rotating-panel change. Recheck both the normal 16:9 layout and the narrow layout when responsive CSS is affected.

For documentation-only, test-only, or backend-only changes with no meaningful rendered state, state in the final response that no relevant visual screenshot was available instead of showing an unrelated screen.

## Delivery checklist

1. Implement the requested change.
2. Run the relevant tests, lint, and build checks.
3. Capture and show the relevant visual state when the change affects the UI.
4. Link the changed files and summarize verification results.
