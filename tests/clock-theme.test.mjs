import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLOCK_THEMES, CLOCK_THEME_NAMES, DEFAULT_CLOCK_THEME, clockTheme, clockThemeClass, hasScenery,
} from '../lib/clock-theme.ts';

test('an unnamed or misspelt theme falls back to the default, so a typo cannot undress the display', () => {
  assert.equal(clockTheme(''), DEFAULT_CLOCK_THEME);
  assert.equal(clockTheme('?weather=off'), DEFAULT_CLOCK_THEME);
  assert.equal(clockTheme('?clock='), DEFAULT_CLOCK_THEME);
  assert.equal(clockTheme('?clock=hillsid'), DEFAULT_CLOCK_THEME);
  assert.equal(clockTheme('?clock=HILLSIDE'), DEFAULT_CLOCK_THEME);
  assert.equal(clockTheme('?clock=woodland'), DEFAULT_CLOCK_THEME);
});

test('every declared theme survives a round trip through the URL', () => {
  for (const theme of CLOCK_THEMES) assert.equal(clockTheme('?clock=' + theme), theme);
  assert.equal(clockTheme('?weather=off&time=10:09&clock=plain'), 'plain');
});

test('the old bare card is still reachable, and is the only theme without scenery', () => {
  assert.equal(clockTheme('?clock=plain'), 'plain');
  assert.equal(clockThemeClass('plain'), '');
  assert.equal(hasScenery('plain'), false);
  for (const theme of CLOCK_THEMES.filter(id => id !== 'plain')) {
    assert.equal(clockThemeClass(theme), 'ct-' + theme);
    assert.equal(hasScenery(theme), true);
  }
});

test('the default is a real theme, and every theme has a name', () => {
  assert.ok(CLOCK_THEMES.includes(DEFAULT_CLOCK_THEME));
  assert.notEqual(DEFAULT_CLOCK_THEME, 'plain');
  for (const theme of CLOCK_THEMES) assert.match(CLOCK_THEME_NAMES[theme], /\S/);
  assert.equal(Object.keys(CLOCK_THEME_NAMES).length, CLOCK_THEMES.length);
});
