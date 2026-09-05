import test from 'node:test';
import assert from 'node:assert/strict';
import { TENANT_SHAPES } from '../lib/tenant-drawing.ts';

test('every expression morphs the same single closed contour', () => {
  const commands = path => path.match(/[A-Za-z]/g).join('');
  for (const path of Object.values(TENANT_SHAPES)) {
    assert.equal(commands(path), commands(TENANT_SHAPES.rest));
    assert.equal((path.match(/M/g) ?? []).length, 1);
    assert.equal((path.match(/Z/g) ?? []).length, 1);
    assert.ok(path.match(/-?\d+(?:\.\d+)?/g).every(value => Number.isFinite(Number(value))));
  }
});

test('hands retract into the side, and gestures never move the belly baseline', () => {
  const segments = path => path.split(' C');
  const rest = segments(TENANT_SHAPES.rest);
  for (const [name, path] of Object.entries(TENANT_SHAPES)) {
    const curves = segments(path);
    assert.deepEqual(curves.slice(-2), rest.slice(-2), name + ' keeps its feet on the same ground');
    if (['rest', 'listen', 'flinch'].includes(name)) {
      assert.deepEqual(curves.slice(11, 13), rest.slice(11, 13), name + ' has no protruding hand');
    }
  }
  assert.notEqual(TENANT_SHAPES.waveLow, TENANT_SHAPES.rest);
  assert.notEqual(TENANT_SHAPES.waveHigh, TENANT_SHAPES.waveLow);
});
