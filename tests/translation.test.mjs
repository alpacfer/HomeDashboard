import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyTranslations, DEEPL_FREE, DEEPL_PRO, deeplEndpoint, parseTranslations, TARGET_LANGUAGE, TRANSLATION_BATCH_LIMIT, translatableTexts, translationRequest } from '../lib/translation.ts';
import { ALERT_TEXT_LIMIT } from '../lib/transit.ts';

const now = 1_800_000_000_000;
const departure = (id, alerts = []) => ({ id, scheduled: now, expected: now, cancelled: false, realtime: true, delay: 0, track: null, scheduledTrack: null, alerts });
const alert = text => ({ severity: 'warning', text });
const ready = boards => ({ status: 'ready', generatedAt: now, boards });

test('a free-tier key goes to the free host, everything else to the pro one', () => {
  assert.equal(deeplEndpoint('00000000-0000-0000-0000-000000000000:fx'), DEEPL_FREE);
  assert.equal(deeplEndpoint('  00000000-0000-0000-0000-000000000000:fx  '), DEEPL_FREE, 'a stray newline in .env.local must not change hosts');
  assert.equal(deeplEndpoint('00000000-0000-0000-0000-000000000000'), DEEPL_PRO);
});

test('only distinct alert text is ever sent, and never unbounded', () => {
  const repeated = ready({
    '184:north': [departure('a', [alert('Omkørsel')]), departure('b', [alert('Omkørsel')])],
    '184:south': [departure('c', [alert('Sporarbejde')]), departure('d')],
  });
  // The same sentence rides on every departure of a disrupted line; it is one
  // translation, not four.
  assert.deepEqual(translatableTexts(repeated), ['Omkørsel', 'Sporarbejde']);
  assert.deepEqual(translatableTexts(ready({ '184:north': [departure('a')] })), []);
  assert.deepEqual(translatableTexts(null), []);
  assert.deepEqual(translatableTexts({ status: 'unavailable', generatedAt: now, boards: {} }), []);

  const flood = ready({ '184:north': Array.from({ length: 40 }, (_, i) => departure('d' + i, [alert('message ' + i)])) });
  assert.equal(translatableTexts(flood).length, TRANSLATION_BATCH_LIMIT, 'a provider cannot spend the month in one refresh');
});

test('the request asks for English and lets the source language be detected', () => {
  const body = translationRequest(['Omkørsel']);
  assert.deepEqual(body, { text: ['Omkørsel'], target_lang: TARGET_LANGUAGE });
  // Asserting Danish would mangle the occasional English or German message.
  assert.equal('source_lang' in body, false);
});

test('a translation is accepted only when it covers every text asked for', () => {
  assert.deepEqual(parseTranslations({ translations: [{ text: 'Diversion' }, { text: 'Track works' }] }, 2), ['Diversion', 'Track works']);
  // A board half in Danish and half in English reads as a bug, so a partial
  // answer is refused outright rather than half-applied.
  assert.equal(parseTranslations({ translations: [{ text: 'Diversion' }] }, 2), null);
  assert.equal(parseTranslations({ translations: [{ text: 'a' }, { text: 'b' }, { text: 'c' }] }, 2), null);
  assert.equal(parseTranslations({ translations: [{ text: '' }] }, 1), null);
  assert.equal(parseTranslations({ translations: [{ text: 42 }] }, 1), null);
  assert.equal(parseTranslations({ translations: 'nonsense' }, 1), null);
  assert.equal(parseTranslations({ message: 'Quota exceeded' }, 1), null);
  assert.equal(parseTranslations(null, 1), null);
  assert.equal(parseTranslations('<html>', 1), null);
  // Translated text is external input like any other, so it is capped too.
  assert.equal(parseTranslations({ translations: [{ text: 'x'.repeat(400) }] }, 1)[0].length, ALERT_TEXT_LIMIT);
  assert.deepEqual(parseTranslations({ translations: [{ text: '  spaced   out ' }] }, 1), ['spaced out']);
});

test('translations replace alert text and leave everything else alone', () => {
  const data = ready({
    '184:north': [departure('a', [alert('Omkørsel')]), departure('b')],
    '184:south': [departure('c', [alert('Sporarbejde')])],
  });
  const translated = applyTranslations(data, new Map([['Omkørsel', 'Diversion']]));
  assert.equal(translated.boards['184:north'][0].alerts[0].text, 'Diversion');
  assert.equal(translated.boards['184:north'][0].alerts[0].severity, 'warning', 'severity survives translation');
  assert.equal(translated.boards['184:north'][1].alerts.length, 0);
  // Fails open per string: an untranslated message keeps its Danish rather
  // than vanishing from a board that is still correct.
  assert.equal(translated.boards['184:south'][0].alerts[0].text, 'Sporarbejde');
  assert.equal(translated.generatedAt, data.generatedAt);
  assert.equal(translated.status, 'ready');
  // The original is not mutated: the route caches what the providers returned.
  assert.equal(data.boards['184:north'][0].alerts[0].text, 'Omkørsel');
  assert.equal(applyTranslations(data, new Map()), data, 'nothing to do is not a rebuild');
});
