# Clock behaviour, shelved

Everything the clock did besides tell the time: eighteen outfits it changed
into every twenty to forty minutes, the crossfade between them, and eight set
pieces it played on the digits. Shelved 5 September 2026 so the clock could
become an enclosed widget with a background of its own; the display now shows
one face, the digit roll and the Tenant.

Nothing here is imported, typechecked, linted or tested. `assets/` is excluded
in `tsconfig.json` and ignored in `eslint.config.mjs`, and the two suites are
outside the `tests/*.test.mjs` glob that `npm test` runs. The files are exactly
as they left the live tree, imports and all, so putting them back is a move
rather than a rewrite.

| File | Was | Goes back to |
| --- | --- | --- |
| `clock-wardrobe.ts` | Outfits, context weights, the weighted pick, per-outfit date formats. | `lib/` |
| `clock-events.ts` | The eight set pieces, and the quiet moments they fit in. | `lib/` |
| `outfits.css` | The `.o-<id>` rules and the dressing crossfade. | `app/globals.css` |
| `set-pieces.css` | The `.sp-<id>` rules, their keyframes, and the flap piece's own rules. | `app/globals.css` |
| `clock-wardrobe.test.mjs` | Which outfit, when, and what its date says. | `tests/` |
| `clock-events.test.mjs` | Which piece, when, and the quiet-moment arithmetic. | `tests/` |

The two suites are in the `tests/` subfolder here, and keep their original
`../lib/...` imports, so they run again as soon as they and their modules are
back where the table says.

## What stayed behind

- **The fonts.** `app/clock-fonts.css`, `public/fonts/clock/` and the face list
  in `scripts/fetch-clock-fonts.mjs` are untouched. The clock's own face,
  Clock Grotesk, is one of them, so the generated stylesheet is still live and
  `npm run fonts:clock` still regenerates the whole set. Nothing needs
  downloading again to bring the outfits back.
- **The custom properties.** `.clock-block` in `app/globals.css` still sets
  `--digit-font`, `--digit-scale`, `--digit-var`, the `--date-*` group,
  `--ink`, `--colon`, `--date-ink`, `--glow` and `--colon-r`, and the rules
  still read them rather than hardcoding the values. That is the seam
  `outfits.css` plugs into: an `.o-<id>` class overrides them and the clock
  is dressed.
- **`data-d` on each digit face**, which the `ink` piece draws its flood from.
- **`busy` on `<Tenant>`**, passed as `false`. It is what held the character
  still while the clock dressed or played a piece.

## Putting it back

1. Move the six files to the paths in the table; the two stylesheets are
   pasted back into `app/globals.css`.
2. In `components/clock.tsx`: restore the `outfit`, `ghost`, `piece` and
   `flap` state, the scheduling effect that drives them, the `--d`, `--rd`,
   `--r`, `--kd` and `--kx` per-digit stagger variables, the ghost markup, and
   `busy={ghost !== null || piece !== null}` with the `onHome` callback that
   postponed a piece while the Tenant was away from its rest spot.
3. The date came from `outfitDate(outfit, now)`, not `clockDate(now)`: the
   format belongs to the outfit. `clockDate` now spells out the same weekday,
   day and month the Grotesk outfit did, so it is the `caps` case of
   `outfitDate` and can be dropped again or kept as the fallback.
4. `Conditions` and the Copenhagen hour moved to `lib/clock-conditions.ts`,
   because the Tenant still reads the weather. `clock-wardrobe.ts` here still
   declares its own copy of both; delete one of the two rather than shipping
   the pair.
5. Add the two suites back and run `npm run check`. They have not been run
   since the shelving, and neither has the type checker seen these files.

`git log -- lib/clock-wardrobe.ts lib/clock-events.ts` has the history; the
commit that shelved them is where the wiring is visible in full.
