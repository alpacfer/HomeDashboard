import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANDMARKS, landmarksFor } from '../lib/clock-tenant.ts';

// The landmark table is where the Tenant may land beyond the clock. It is
// data, so the things a wrong entry breaks can be checked without a browser.

const WORLD_SPOTS = ['weather', 'week', 'transport', 'fact', 'map'];

test('every destination the Tenant can visit is a landmark exactly once', () => {
  const ids = LANDMARKS.filter(spec => spec.kind === 'world').map(spec => spec.id).sort();
  assert.deepEqual(ids, [...WORLD_SPOTS].sort());
});

test('landing pad keys are unique, so a route cannot confuse two pads', () => {
  const keys = LANDMARKS.filter(spec => spec.kind === 'safe').map(spec => spec.key);
  assert.equal(new Set(keys).size, keys.length, keys.join(', '));
  // A key with a placeholder is numbered per element, so it must say so.
  for (const spec of LANDMARKS) if (spec.kind === 'safe' && spec.key.includes('*')) assert.equal(spec.each, true, spec.key);
});

test('every landmark stands somewhere on its surface', () => {
  for (const spec of LANDMARKS) {
    assert.ok(spec.align >= 0 && spec.align <= 1, spec.selector);
    assert.ok(spec.edge === 'top' || spec.edge === 'bottom', spec.selector);
    assert.ok(spec.selector.trim().length > 0);
  }
});

test('a scene only offers its own panel, plus the landmarks that are always on screen', () => {
  const shared = LANDMARKS.filter(spec => !spec.scene);
  for (const scene of ['transport', 'fact', 'map']) {
    const offered = landmarksFor(scene);
    assert.ok(shared.every(spec => offered.includes(spec)), scene + ' keeps the shared landmarks');
    assert.ok(offered.every(spec => !spec.scene || spec.scene === scene), scene + ' offers no other panel');
    assert.equal(offered.filter(spec => spec.kind === 'world' && spec.id === scene).length, 1, scene + ' has its own destination');
  }
  // The right-hand panel is the only thing that comes and goes: its selectors
  // say which scene they belong to, so a stale scene cannot be landed on.
  for (const spec of LANDMARKS) if (spec.scene) assert.ok(/is-active|transport-mini/.test(spec.selector), spec.selector);
});
