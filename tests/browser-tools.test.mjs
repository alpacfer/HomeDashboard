import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nearestSelectors, pageUrl, parsePhase, splitGroups, takeUrlFlag, URL_FLAGS } from '../scripts/lib/browser.mjs';

// The browser tools share one URL builder so that a screenshot and a motion
// measurement of "the same" scene are of the same scene. These are the pure
// parts of that plumbing; the tools themselves need Chrome and a dev server.

test('every URL flag is taken, and an unknown one is refused', () => {
  for (const flag of URL_FLAGS) {
    const options = {};
    assert.equal(takeUrlFlag(flag, options, () => 'x', flag), true, flag + ' should be a URL flag');
  }
  assert.equal(takeUrlFlag('--clip', {}, () => 'x'), false);
});

test('the page URL ranks the weather flags: none over dry over demo over off', () => {
  assert.equal(new URL(pageUrl({ offline: true })).searchParams.get('weather'), 'off');
  assert.equal(new URL(pageUrl({ offline: true, demo: true })).searchParams.get('weather'), 'demo');
  assert.equal(new URL(pageUrl({ demo: true, dry: true })).searchParams.get('weather'), 'dry');
  assert.equal(new URL(pageUrl({ dry: true, noWeather: true })).searchParams.get('weather'), 'none');
  const url = new URL(pageUrl({ scene: 'map', time: '08:46', sky: 'night,clear', transit: 'stale' }));
  assert.equal(url.searchParams.get('scene'), 'map');
  assert.equal(url.searchParams.get('time'), '08:46');
  assert.equal(url.searchParams.get('sky'), 'night,clear');
  assert.equal(url.searchParams.get('transit'), 'stale');
});

test('a pose phase is a percentage of the cycle or a time', () => {
  assert.deepEqual(parsePhase('7%'), { percent: 7 });
  assert.deepEqual(parsePhase('9.8%'), { percent: 9.8 });
  assert.deepEqual(parsePhase('350ms'), { ms: 350 });
  assert.deepEqual(parsePhase('350'), { ms: 350 });
  assert.deepEqual(parsePhase('1.2s'), { ms: 1200 });
  assert.throws(() => parsePhase('half'), /percentage|time/);
  assert.throws(() => parsePhase(''), /percentage|time/);
});

test('--then splits one command line into capture groups', () => {
  assert.deepEqual(splitGroups(['--offline', '--time', '08:46']), [['--offline', '--time', '08:46']]);
  assert.deepEqual(
    splitGroups(['--offline', '--then', '--sky', 'night,clear', '--then', '--sky', 'day,snow']),
    [['--offline'], ['--sky', 'night,clear'], ['--sky', 'day,snow']],
  );
  // A leading or doubled separator makes an empty group, which is a capture
  // of the base as it is, not an error.
  assert.deepEqual(splitGroups(['--then', '--sky', 'dusk']), [[], ['--sky', 'dusk']]);
});

test('a missed selector is answered with the class names that come close', () => {
  const onPage = ['forecast-map-frame', 'forecast-map-canvas', 'forecast-map-overlay', 'transport-panel', 'clock-block', 'tenant', 'week-strip'];
  // The wrong guesses that actually happened, and what each should have been.
  assert.ok(nearestSelectors('.forecast-map-panel', onPage).includes('.forecast-map-frame'));
  assert.ok(nearestSelectors('.transport-scene', onPage).includes('.transport-panel'));
  assert.equal(nearestSelectors('.clock-block', onPage)[0], '.clock-block');
  // Nothing in common is nothing suggested, not five random names.
  assert.deepEqual(nearestSelectors('.zzz', onPage), []);
  assert.ok(nearestSelectors('.forecast-map-panel', onPage).length <= 5);
});
