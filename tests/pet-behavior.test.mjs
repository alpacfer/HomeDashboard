import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  advancePetMind, choosePetActivity, commitPetActivity, initialPetMind, noticePetScene, noticePetStimulus, petDecisionDelay,
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

test('clock and weather stimuli change drives without choosing a fixed behavior', () => {
  const initial = initialPetMind('transport');
  const minute = noticePetStimulus(initial, 'minute');
  const hour = noticePetStimulus(initial, 'hour');
  const weather = noticePetStimulus(initial, 'weather');
  assert.ok(minute.curiosity > initial.curiosity);
  assert.ok(hour.adventure > initial.adventure);
  assert.ok(weather.sceneInterest > initial.sceneInterest);
  assert.deepEqual(minute.recent, initial.recent, 'a stimulus is not an activity');
});

test('adventures stay possible at low motivation and prefer, but do not lock to, the active scene', () => {
  const calm = initialPetMind('transport');
  const calmDecisions = Array.from({ length: 1000 }, (_, i) => choosePetActivity(calm, {
    mood: 'awake', scene: 'map', spots: ['weather', 'map'], canAdventure: true,
  }, i / 1000));
  assert.ok(calmDecisions.some(decision => decision.kind === 'perch'));
  assert.ok(calmDecisions.some(decision => decision.kind === 'roam'));
  assert.ok(calmDecisions.filter(decision => decision.kind === 'idle').length > 500);
  const eager = { ...calm, adventure: 0.95, curiosity: 0.9, sceneInterest: 1, focus: 'map', recent: ['idle'] };
  const decisions = Array.from({ length: 1000 }, (_, i) => choosePetActivity(eager, {
    mood: 'awake', scene: 'map', spots: ['weather', 'map'], canAdventure: true,
  }, i / 1000));
  const roaming = decisions.filter(decision => decision.kind === 'roam');
  assert.ok(roaming.length > 300, 'a curious rested pet should often explore: ' + roaming.length);
  const map = roaming.filter(decision => decision.spot === 'map').length;
  const weather = roaming.filter(decision => decision.spot === 'weather').length;
  assert.ok(map > weather, 'the current scene should be interesting without becoming mandatory');
  assert.ok(weather > 0, 'other destinations remain available');
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
