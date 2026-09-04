# Tenant skins

Alternative drawings for the character in `components/tenant.tsx`, kept for
later. Each keeps the Tenant's layer and class names (`.t-figure`, `.t-gest`,
`.t-pose`, `.t-face`, `.t-eye`, `.t-lid`, `.t-pupils`, `.t-mouth`, `.t-arm`,
`.t-leaf`, `.t-foot`, `.t-foot-b`, `.t-tail`, `.t-ears`, `.t-scarf`,
`.t-shades`, `.t-sweat`, `.t-zz`, `.t-drop`), so the choreography in
`app/globals.css` applies unchanged. A skin is pasted into the component's
`<svg>`, and the comment at the top of each file lists the CSS values
(transform origins, colours) that go with it.

| File | What | Status |
| --- | --- | --- |
| `totoro.svg` | Big Totoro: grey fur, cream belly with seven chevrons, whiskers, claws, a grin with teeth on `.g-smile`. | Shelved 4 Sep 2026: too much detail at the Tenant's 47 px. The display shows Chibi Totoro instead. |

Open one in a browser to see it at rest. The eye and mouth groups are the
Tenant's original rigs wrapped in a scaling `transform`, which is how every
lid, pupil and `d:path()` offset in the CSS stays proportional to a new face.
