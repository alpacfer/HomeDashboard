// What the sky is doing this hour, as the clock reads it.
//
// The weather panel is the only thing that asks a provider for a forecast. It
// reports the current hour up to the page, which hands it to the clock, so the
// Tenant's mood and the theme's weather both follow the sky without a second
// request. This module is that contract: the shape the panel reports, and the
// Copenhagen hour that decides when the character sleeps.
//
// It used to live in the wardrobe, which also chose the clock's typeface from
// the same context. The wardrobe is shelved in assets/clock-behavior/; this
// half stayed because the character still reads the weather.
//
// `kind` and `band` are the panel's own classification of the hour, passed
// through untouched. The character only ever needed `wet`; the hillside theme
// needs to know the difference between drizzle and a blizzard, and inventing a
// second classifier for it would be a way for the card and the clock to
// disagree about the same hour. lib/clock-sky.ts turns them into scenery.

import type { MoodContext } from './clock-tenant';
import type { Band, ConditionKind } from './weather';

export type Conditions = {
  temperature: number | null;
  wet: boolean;
  kind: ConditionKind | null;
  band: Band | null;
};

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Copenhagen', hour: 'numeric', hourCycle: 'h23',
});

export function moodContext(now: Date, conditions: Conditions | null): MoodContext {
  const parts = Object.fromEntries(partsFormatter.formatToParts(now).map(part => [part.type, part.value]));
  return {
    hour: Number(parts.hour) % 24,
    temperature: conditions?.temperature ?? null,
    wet: conditions?.wet ?? false,
  };
}
