// The Tenant's drawing: a static SVG whose layers the stylesheet and the
// motion tracks animate by class. It has no props and no state of its own;
// components/tenant.tsx positions it and decides what it is doing.
//
// The layering is what lets animations compose instead of fighting:
//   .t-figure   the whole figure: breathing and balance on a top
//   .t-balance  the balance track (body), .t-posture the posture track (body)
//   .t-gest     body gestures and perch actions: stretch, wiggle, teeter, slip
//   .t-pose     sticky body state with a transition: sitting
// Each layer animates only its own transform, so a slip on a round top runs
// over the sway underneath it and hands back to it without a jump.

import { TENANT_SHAPES } from '@/lib/tenant-drawing';

export function TenantFigure() {
  return <svg viewBox="0 0 100 100">
    <defs>
      <clipPath id="tenant-eye-mask"><ellipse cx="34" cy="54" rx="11" ry="13" /><ellipse cx="66" cy="54" rx="11" ry="13" /></clipPath>
    </defs>
    <g className="t-figure">
    <g className="t-balance"><g className="t-posture">
    <g className="t-rain-drops">
      <rect className="t-drop" x="10" y="0" width="3" height="10" rx="1.5" />
      <rect className="t-drop" x="50" y="0" width="3" height="10" rx="1.5" />
      <rect className="t-drop" x="88" y="0" width="3" height="10" rx="1.5" />
    </g>
    <text className="t-zz" x="80" y="26">z</text>
    <text className="t-zz" x="89" y="16">z</text>
    <g className="t-gest">
    {/* Feet sit behind the body and peek out below it, toes first, the way
        the reference draws them: the belly line runs over them. */}
    <path className="t-foot" d="M31 93 L30 99 M36 94 L36 100 M41 94 L42 99" />
    <path className="t-foot t-foot-b" d="M59 94 L58 99 M64 94 L64 100 M69 93 L70 99" />
    <g className="t-pose">
    {/* The sprout reuses the old tail's secondary-motion layer. It sits
        behind the head and follows a wave, a bounce or a delighted wiggle. */}
    <g className="t-balance-sprout"><g className="t-posture-sprout"><g className="t-tail t-sprout">
      <path className="t-sprout-stem" d="M50 32 Q48 18 46 5" />
      <path className="t-sprout-leaf" d="M46 7 C35 10 29 3 31 -1 C34 -6 44 -2 46 7 Z" />
      <path className="t-sprout-leaf t-sprout-leaf-b" d="M46 7 C45 -2 53 -9 59 -6 C65 -2 57 7 46 7 Z" />
    </g></g></g>
    <path className="t-body" d={TENANT_SHAPES.rest} />
    <path className="t-belly-wash" d="M22 66 C22 83 33 91 51 91 C64 91 74 88 79 83 C76 94 64 93 50 93 C30 94 18 92 20 77 Z" />
    <g className="t-balance-head"><g className="t-posture-head"><g className="t-face">
    {/* The eye rig is the original Tenant geometry scaled into round eyes,
        so every lid, pupil and glance offset in the CSS lands proportionally. */}
    <g transform="translate(4.5 6.5) scale(.91 .77)">
    <ellipse className="t-eye" cx="34" cy="54" rx="11" ry="13" />
    <ellipse className="t-eye" cx="66" cy="54" rx="11" ry="13" />
    <g className="t-pupils">
      <circle className="t-pupil" cx="35" cy="54" r="4.5" />
      <circle className="t-pupil" cx="67" cy="54" r="4.5" />
    </g>
    <g clipPath="url(#tenant-eye-mask)"><rect className="t-lid" x="22" y="40" width="24" height="28" rx="11" /><rect className="t-lid" x="54" y="40" width="24" height="28" rx="11" /></g>
    <ellipse className="t-eye-ring" cx="34" cy="54" rx="11" ry="13" />
    <ellipse className="t-eye-ring" cx="66" cy="54" rx="11" ry="13" />
    <path className="t-eye-happy" d="M27 56 Q34 44 41 56 M59 56 Q66 44 73 56" />
    {/* A shut eye is a drawn shape, not a stroke: a lens that is thickest in
        the middle and tapers to a point at each corner, so it keeps roughly
        the weight the ring and pupil had and cannot thin into a hairline at
        any size. It sits narrower than the open eye and low in the socket,
        which is what reads as heavy-lidded rather than merely closed.
        app/tenant.css fills it and says which gestures show it. */}
    <path className="t-eye-sleep" d="M26 52 Q34 66 42 52 Q34 58 26 52 Z M58 52 Q66 66 74 52 Q66 58 58 52 Z" />
    <g className="t-shades"><rect x="21" y="46" width="26" height="14" rx="5" /><rect x="53" y="46" width="26" height="14" rx="5" /><rect x="47" y="51" width="6" height="3" /></g>
    </g>
    <g className="t-cheeks"><ellipse cx="24" cy="61" rx="4.5" ry="2" /><ellipse cx="76" cy="61" rx="4.5" ry="2" /></g>
    {/* The mouth rig is the original mouth, smaller and lower; the CSS
        d:path() shapes for every mood still apply. */}
    <g transform="translate(17 17) scale(.66)">
    <path className="t-mouth" d="M43 75 Q50 79 57 75" />
    </g>
    <ellipse className="t-sweat" cx="80" cy="38" rx="3" ry="4.5" />
    </g></g></g>
    <g className="t-scarf"><path d="M22 52 C36 62 64 62 78 52 C64 57 36 57 22 52 Z" /><path d="M66 56 L74 72 L62 68 Z" /></g>
    <g>
    <g className="t-leaf">
      <path className="t-leaf-blade" d="M10 18 C29 -6 66 -11 94 6 C75 25 39 30 10 18 Z" />
      <path className="t-leaf-vein" d="M88 7 Q52 10 12 18 M65 10 L73 1 M47 13 L57 22" />
      <path className="t-leaf-stem-outline" d="M12 18 C1 29 5 41 8 54" />
      <path className="t-leaf-stem" d="M12 18 C1 29 5 41 8 54" />
    </g>
    </g>
    <path className="t-grip" d="M6 53 Q9 55 12 54" />
    </g>
    </g>
    </g>
    </g></g>
  </svg>;
}
