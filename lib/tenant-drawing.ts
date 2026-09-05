// One closed contour, including both ears and the retractable hand. Every
// drawing has identical cubic segments, so the browser can interpolate the
// points without ever exposing a joint, a second stroke, or a masking seam.
// Only the short gestures morph this small path; breathing and travel remain
// compositor transforms. The rest path also works without CSS path support.
function silhouette(ear: number, hand: 'hidden' | 'low' | 'high' | 'leaf' = 'hidden') {
  const arm = {
    hidden: 'C17 61 16 64 16 67 C16 70 16 73 16 76',
    low: 'C12 57 8 47 4 49 C-3 53 6 70 16 76',
    high: 'C12 54 11 39 5 39 C-4 39 -1 66 16 76',
    leaf: 'C13 56 13 50 8 51 C-1 52 4 70 16 76',
  }[hand];
  return `M50 95
    C69 96 80 94 82 84 C87 72 81 55 77 44
    C75 36 ${74 + ear} 24 ${73 + ear} ${10 - ear}
    C${73 + ear} ${5 - ear} ${70 + ear} ${4 - ear} ${68 + ear} ${9 - ear}
    C65 17 62 26 59 31 C53 29 46 29 41 31
    C35 25 ${30 - ear} 16 ${25 - ear} ${12 - ear}
    C${21 - ear} ${8 - ear} ${18 - ear} ${9 - ear} ${19 - ear} ${15 - ear}
    C19 26 23 37 23 44 C21 48 19 53 18 58
    ${arm}
    C16 88 19 94 31 95 C37 96 44 95 50 95 Z`.replace(/\s+/g, ' ').trim();
}

export const TENANT_SHAPES = {
  rest: silhouette(0),
  listen: silhouette(3),
  flinch: silhouette(-3),
  waveLow: silhouette(0, 'low'),
  waveHigh: silhouette(1, 'high'),
  rain: silhouette(0, 'leaf'),
};

export const TENANT_PATH_STYLES = Object.fromEntries(
  Object.entries(TENANT_SHAPES).map(([name, path]) => ['--pet-' + name, `path('${path}')`]),
);
