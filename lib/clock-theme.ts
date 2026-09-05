// Which environment the clock widget stands in.
//
// A theme is a class on `.clock-widget` and nothing else. It dresses the card
// through the custom properties the clock's rules already read
// (`--clock-surface`, `--clock-ring`, and the type group on `.clock-block`),
// paints scenery into the backdrop layers, and replaces the digit roll with a
// transition belonging to its own weather. No theme adds a timer or a fetch,
// so nothing here can leak on a display that runs for weeks.
//
//   hillside  A hill above the harbour, lit by the real sun and rained on by
//             the real forecast. What it is doing at any moment is decided by
//             lib/clock-sky.ts, not here.
//   plain     The card as it was before themes existed: a faint wash and a
//             hairline. Kept so the old look is one URL away.

export const CLOCK_THEMES = ['hillside', 'plain'] as const;

export type ClockTheme = (typeof CLOCK_THEMES)[number];

/** What each theme is called. */
export const CLOCK_THEME_NAMES: Readonly<Record<ClockTheme, string>> = {
  hillside: 'Hillside — a hill above the harbour, in the real weather',
  plain: 'Plain — the card before themes',
};

export const DEFAULT_CLOCK_THEME: ClockTheme = 'hillside';

/**
 * The theme pinned by `?clock=<id>` on the page URL, for looking at one
 * without changing the default. An unknown or missing value is the default,
 * so a mistyped URL can never leave the wall display in a state nobody chose.
 */
export function clockTheme(search: string): ClockTheme {
  const value = new URLSearchParams(search).get('clock');
  return isClockTheme(value) ? value : DEFAULT_CLOCK_THEME;
}

/** The class the stylesheet hangs a theme off. `plain` is the bare card. */
export function clockThemeClass(theme: ClockTheme): string {
  return theme === 'plain' ? '' : 'ct-' + theme;
}

/**
 * Whether a theme paints scenery. Only a themed card gets the backdrop layers,
 * the light pass and the flora; `plain` keeps the DOM it has always had.
 */
export function hasScenery(theme: ClockTheme): boolean {
  return theme !== 'plain';
}

function isClockTheme(value: string | null): value is ClockTheme {
  return value !== null && (CLOCK_THEMES as readonly string[]).includes(value);
}
