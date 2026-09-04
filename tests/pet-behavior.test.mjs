import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  advancePetMind, choosePetActivity, commitPetActivity, initialPetMind, noticePetScene, petDecisionDelay,
} from '../lib/pet-behavior.ts';

test('the pet mind builds drives slowly and notices a new screen without forcing an action', () => {
  const initial = initialPetMind('transport');
  const noticed = noticePetScene(initial, 'map');
  assert.equal(noticed.focus, 'map');
  assert.ok(noticed.sceneInterest >= 0.72);
  const advanced = advancePetMind(noticed, 30_000, 'awake');
  assert.ok(advanced.curiosity > noticed.curiosity);
  assert.ok(advanced.adventure > noticed.adventure);
  assert.equal(noticePetScene(advanced, 'map'), advanced, 'seeing the same scene is not a new stimulus');
});

test('adventures need motivation and prefer the landmark for the active scene', () => {
  const calm = initialPetMind('transport');
  for (let i = 0; i < 100; i++) {
    const decision = choosePetActivity(calm, { mood: 'awake', scene: 'map', spots: ['map'], canAdventure: true }, i / 100);
    assert.notEqual(decision.kind, 'roam');
    assert.notEqual(decision.kind, 'climb');
  }
  const eager = { ...calm, adventure: 0.95, curiosity: 0.9, sceneInterest: 1, focus: 'map', recent: ['idle'] };
  const decisions = Array.from({ length: 1000 }, (_, i) => choosePetActivity(eager, {
    mood: 'awake', scene: 'map', spots: ['weather', 'map'], canAdventure: true,
  }, i / 1000));
  const roaming = decisions.filter(decision => decision.kind === 'roam');
  assert.ok(roaming.length > 400, 'a curious rested pet should often explore: ' + roaming.length);
  assert.ok(roaming.every(decision => decision.spot === 'map'));
});

test('memory suppresses repetition and adventures spend their drives', () => {
  const eager = { ...initialPetMind(), energy: 0.8, curiosity: 0.9, adventure: 1, sceneInterest: 1, recent: [] };
  const roamed = commitPetActivity(eager, { kind: 'roam', spot: 'fact' });
  assert.equal(roamed.adventure, 0);
  assert.equal(roamed.sceneInterest, 0);
  assert.ok(roamed.energy < eager.energy);
  assert.deepEqual(roamed.recent, ['roam:fact']);
  const paused = commitPetActivity(roamed, { kind: 'pause' });
  assert.ok(paused.energy > roamed.energy);
});

test('decision cadence stays sparse and slows with low energy', () => {
  assert.equal(petDecisionDelay(0, 1), 2800);
  assert.ok(petDecisionDelay(0.999, 1) < 7000);
  assert.ok(petDecisionDelay(0, 0) > petDecisionDelay(0, 1));
});
