// Turning provider service messages into English, for the panel.
//
// Rejseplanen and the Transitous fallback both write their disruptions in
// Danish, which is the language of the network but not of everybody reading
// the wall. DeepL translates them.
//
// Everything here is pure: building the request, reading the answer, choosing
// what is worth sending, and putting the results back. The `fetch` itself lives
// in app/api/departures/route.ts, because lib/ may not reach the network.
//
// The key is `DEEPL_API_KEY`, read only by that route. It is a credential: it
// belongs in the ignored .env.local and in Render's environment, never in a
// NEXT_PUBLIC_ variable and never in the repository. Nothing translated here is
// personal: alert text is a public service message and the only thing sent.

import { ALERT_TEXT_LIMIT, alertText, type TransitData } from '@/lib/transit';

// A free-tier key ends in `:fx` and is served from a different host. Sending a
// free key to the pro host answers 403, which is a confusing way to discover a
// one-character difference.
export const DEEPL_FREE = 'https://api-free.deepl.com/v2/translate';
export const DEEPL_PRO = 'https://api.deepl.com/v2/translate';
export const deeplEndpoint = (key: string) => key.trim().endsWith(':fx') ? DEEPL_FREE : DEEPL_PRO;

// DeepL bills by character and the free tier allows 500,000 a month. Alert text
// is already capped at ALERT_TEXT_LIMIT before it gets here, and repeats across
// every departure of a disrupted line, so only distinct strings are ever sent.
// This cap is the last guard: a provider that suddenly attaches a different
// message to every departure cannot spend the month's quota in one refresh.
export const TRANSLATION_BATCH_LIMIT = 12;
export const TARGET_LANGUAGE = 'EN-GB';

/** Every distinct alert text on the boards, in a stable order, capped. */
export function translatableTexts(data: TransitData | null): string[] {
  if (data?.status !== 'ready') return [];
  const seen = new Set<string>();
  for (const board of Object.values(data.boards)) {
    for (const departure of board) for (const alert of departure.alerts) {
      if (alert.text) seen.add(alert.text);
    }
  }
  return [...seen].slice(0, TRANSLATION_BATCH_LIMIT);
}

/** The DeepL request body. Source language is detected, not asserted: a Danish
 *  network still carries the occasional English or German message. */
export function translationRequest(texts: string[]) {
  return { text: texts, target_lang: TARGET_LANGUAGE };
}

/**
 * The translated strings, or null if the answer is not one usable translation
 * per text. Partial answers are refused outright rather than half-applied,
 * because a board half in Danish and half in English reads as a bug.
 */
export function parseTranslations(payload: unknown, expected: number): string[] | null {
  const body = payload as { translations?: { text?: unknown }[] } | null;
  if (!body || !Array.isArray(body.translations) || body.translations.length !== expected) return null;
  const texts = body.translations.map(entry => typeof entry?.text === 'string' ? alertText(entry.text) : '');
  return texts.every(text => text.length > 0 && text.length <= ALERT_TEXT_LIMIT) ? texts : null;
}

/**
 * The same boards with every alert text replaced by its translation.
 *
 * Fails open, per string: anything the map does not cover keeps its original
 * wording. A translator that is down, throttled or out of quota must cost the
 * display its English, never its departures.
 */
export function applyTranslations(data: TransitData, translations: Map<string, string>): TransitData {
  if (!translations.size) return data;
  const boards = Object.fromEntries(Object.entries(data.boards).map(([key, board]) => [
    key,
    board.map(departure => departure.alerts.length === 0 ? departure : {
      ...departure,
      alerts: departure.alerts.map(alert => {
        const translated = translations.get(alert.text);
        return translated ? { ...alert, text: translated } : alert;
      }),
    }),
  ]));
  return { ...data, boards };
}
