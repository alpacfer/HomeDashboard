// Check what a screenshot shows but nobody notices, across every scene at once.
//
// `npm run shot` proves what a moment looks like, and `npm run motion` proves
// what it does over time. Neither says whether the layout is *correct*, and
// faults have shipped through a green check, a passing suite and screenshots
// that were looked at, including grey-on-black text nobody had ever measured.
//
// Every one is mechanical, and every one is invisible in a PNG unless you are
// already looking for it. This loads each scene in a real rendering browser and
// asks the page about itself. Text out, so a whole matrix costs less to read
// than one screenshot, and one Chrome launch for all of it rather than one per
// capture.
//
// Run with `npm run audit -- [options]`. The dev server must be running, the
// same as for `npm run shot`.
//
//   --scene <name>         Audit one scene from the matrix below, not all of
//                          them. Repeatable.
//   --shots                Also write a PNG per scene under screenshots/audit/,
//                          from the same page loads. This is the fast way to
//                          re-capture everything after a layout change.
//   --min-font <px>        Legibility floor. Default 11.
//   --contrast <ratio>     Contrast floor for ordinary text. Default 4.5;
//                          large text is held to 3, as WCAG does.
//   --all                  Report notes as well as warnings and errors.
//   --url <url>            Page to audit. Default http://127.0.0.1:3000/
//   --scene, --fact, --offline, --demo, --transit-demo, --time, --pet
//                          The usual debug flags, applied to a one-off audit
//                          instead of the matrix. See scripts/lib/browser.mjs.
//   --width, --height      Viewport in CSS pixels. Default 1280 x 720.
//   --reduced-motion       Emulate prefers-reduced-motion: reduce.
//   --wait <ms>            Settle time after load. Default 4000.
//   --console              Print everything each page logged.
//   --chrome <path>        Chrome binary. Also read from $CHROME_PATH.
//
// Exit code is 1 if anything is reported at error level, so this can gate a
// change the way the other checks do.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome, launchChrome, openPage, pageUrl, waitForServer } from './lib/browser.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The states worth checking, and why each one is here rather than another.
// Every scene is checked at the Fire TV's fixed 1280 x 720 viewport.
const MATRIX = [
  { name: 'transport', why: 'the boards, with real departures', args: { scene: 'transport', offline: true } },
  { name: 'transport-marked', why: 'every delay, cancellation and service message at once', args: { scene: 'transport', offline: true, transitDemo: true } },
  { name: 'fact', why: 'the daily fact, and the compact departure strip under it', args: { scene: 'fact', fact: 0, offline: true, transitDemo: true } },
  { name: 'map', why: 'the forecast map, on the synthetic run', args: { scene: 'map', demo: true } },
];

// Things that must render on one line. A contract, not a guess: text is
// supposed to wrap, so an automatic "did this wrap?" would be all false
// positives. These are the places where a second line means the layout broke —
// a marker stranded above its digits, a countdown split from its unit.
const SINGLE_LINE = [
  '.departure > span',
  '.departure strong',
  '.mini-time',
  '.direction-column h2 .headway',
  '.clock',
  '.week-day strong',
];

// Furniture: required attribution, licence lines and debug chrome. It is
// deliberately small and quiet, nobody reads it from the sofa, and the display
// would not be wrong without it, so it is held to neither the legibility floor
// nor the contrast one. Everything else on the wall is content and is.
const FURNITURE = [
  '.scene-pin',
  '.fact-illustration figcaption',
  '.fact-footer',
  '.forecast-map-credit',
  '.weather-credit',
  '.leaflet-control-attribution',
];

function parseArgs(argv) {
  const options = { scenes: [], console: false, demo: false, offline: false, reducedMotion: false, transitDemo: false, shots: false, all: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => { index += 1; return argv[index]; };
    const [flag, inline] = arg.includes('=') && arg.startsWith('--') && !arg.startsWith('--url') ? arg.split(/=(.*)/s) : [arg, undefined];
    const value = () => inline ?? next();
    switch (flag) {
      case '--url': options.url = arg.includes('=') ? arg.slice('--url='.length) : next(); break;
      case '--scene': options.scenes.push(value()); break;
      case '--fact': options.fact = value(); break;
      case '--offline': options.offline = true; break;
      case '--demo': options.demo = true; break;
      case '--transit-demo': options.transitDemo = true; break;
      case '--time': options.time = value(); break;
      case '--pet': options.pet = value(); break;
      case '--date': options.date = value(); break;
      case '--width': options.width = Number(value()); break;
      case '--height': options.height = Number(value()); break;
      case '--min-font': options.minFont = Number(value()); break;
      case '--contrast': options.contrast = Number(value()); break;
      case '--reduced-motion': options.reducedMotion = true; break;
      case '--wait': options.wait = Number(value()); break;
      case '--shots': options.shots = true; break;
      case '--all': options.all = true; break;
      case '--console': options.console = true; break;
      case '--chrome': options.chrome = value(); break;
      case '--help': case '-h': options.help = true; break;
      default: throw new Error('Unknown option ' + arg + '. See the header of scripts/audit-ui.mjs.');
    }
  }
  return options;
}

// Everything below runs inside the page. It is a string because it is sent
// over DevTools, and it takes its thresholds as arguments so the script stays
// the only place they are written down.
const AUDIT = (singleLine, exempt, minFont, contrastFloor) => `(() => {
  const problems = [];
  const add = (level, kind, node, detail) => problems.push({ level, kind, where: describe(node), detail });
  const SINGLE_LINE = ${JSON.stringify(singleLine)};
  const EXEMPT = ${JSON.stringify(exempt)};

  // A short, recognisable path: enough to find the element, not a full trail.
  function describe(node) {
    if (!node || node === document.documentElement) return 'html';
    const step = element => element.tagName.toLowerCase()
      + (element.id ? '#' + element.id : '')
      + [...element.classList].slice(0, 2).map(name => '.' + name).join('');
    const parts = [];
    for (let element = node, depth = 0; element && element.tagName && depth < 3; element = element.parentElement, depth += 1) parts.unshift(step(element));
    return parts.join(' > ');
  }
  const text = node => (node.textContent || '').replace(/\\s+/g, ' ').trim();
  const shown = node => {
    const style = getComputedStyle(node);
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0.05;
  };
  // Only elements that carry their own words, not every wrapper around them.
  const hasOwnText = node => [...node.childNodes].some(child => child.nodeType === 3 && child.textContent.trim());

  const view = { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight };
  const boxes = new Map();
  const all = [...document.body.querySelectorAll('*')].filter(shown);
  for (const node of all) boxes.set(node, node.getBoundingClientRect());

  // 1. The page itself must not scroll. The display has no scrollbar and
  //    nobody to drag one.
  if (document.documentElement.scrollWidth > view.width + 1) {
    add('error', 'page-scrolls', document.body, 'content is ' + document.documentElement.scrollWidth + 'px wide in a ' + view.width + 'px viewport');
  }

  // 2. Content that is cut off with no way to bring it back. The fixed display
  //    has no pointer, so anything clipped by an ancestor is simply gone.
  const cutBy = (node, box) => {
    for (let element = node.parentElement; element; element = element.parentElement) {
      const style = getComputedStyle(element);
      if (!/hidden|clip/.test(style.overflowY + ' ' + style.overflowX)) continue;
      const edge = element.getBoundingClientRect();
      if (box.bottom > edge.bottom + 1 || box.right > edge.right + 1 || box.top < edge.top - 1) return element;
    }
    return null;
  };
  for (const node of all) {
    const box = boxes.get(node);
    if (box.width === 0 || box.height === 0 || !text(node)) continue;
    const clipper = cutBy(node, box);
    if (!clipper) continue;
    // Only the outermost offender: its children are the same fault.
    const parent = node.parentElement;
    if (parent && boxes.get(parent) && cutBy(parent, boxes.get(parent))) continue;
    const edge = clipper.getBoundingClientRect();
    const over = Math.round(Math.max(box.bottom - edge.bottom, box.right - edge.right, edge.top - box.top));
    // How much of the element is gone, not how many pixels: six pixels off a
    // sixteen-pixel label is a third of it and unreadable, while one pixel off
    // a six-hundred-pixel panel is sub-pixel rounding. The second still means
    // the layout is at its limit and one more line of provider text would
    // spill for real, which is worth knowing but not worth failing over.
    const lost = Math.max(
      Math.max(box.bottom - edge.bottom, edge.top - box.top) / Math.max(1, box.height),
      (box.right - edge.right) / Math.max(1, box.width));
    const serious = lost > 0.2 || over >= 24;
    add(serious ? 'error' : 'warning', 'clipped', node,
      over + 'px (' + Math.round(lost * 100) + '% of it) outside ' + describe(clipper) + ', which hides its overflow'
      + (serious ? '' : ' — at the limit, not yet losing anything')
      + ' — "' + text(node).slice(0, 40) + '"');
  }

  // A wall display has no pointer, so anything below the fold is unreachable.
  const scrolls = document.documentElement.scrollHeight > document.documentElement.clientHeight + 1;
  if (scrolls) add('error', 'page-scrolls', document.body, 'the page is ' + document.documentElement.scrollHeight + 'px tall in a ' + view.height + 'px viewport, and there is no pointer to scroll it');

  // 3. The single-line contract. A second line box here is a marker stranded
  //    above its digits or a number split from its unit.
  for (const selector of SINGLE_LINE) {
    for (const node of document.querySelectorAll(selector)) {
      if (!shown(node) || !text(node)) continue;
      const lines = node.getClientRects().length;
      if (lines > 1) add('error', 'wrapped', node, selector + ' rendered on ' + lines + ' lines — "' + text(node).slice(0, 40) + '"');
    }
  }

  // 4. Legibility. The Fire TV is read from across a room, not from a desk.
  for (const node of all) {
    if (!hasOwnText(node)) continue;
    if (EXEMPT.some(selector => node.closest(selector))) continue;
    const size = parseFloat(getComputedStyle(node).fontSize);
    if (size < ${minFont}) add('warning', 'tiny-text', node, size.toFixed(1) + 'px — "' + text(node).slice(0, 40) + '"');
  }

  // 5. Contrast, against the first ancestor that actually paints a background.
  const channel = value => { const v = value / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  const rgb = value => { const m = (value || '').match(/[\\d.]+/g); return m ? m.slice(0, 3).map(Number).concat(m.length > 3 ? Number(m[3]) : 1) : null; };
  function backdrop(node) {
    for (let element = node; element; element = element.parentElement) {
      const colour = rgb(getComputedStyle(element).backgroundColor);
      if (colour && colour[3] > 0.85) return colour;
    }
    return [17, 17, 19, 1];
  }
  for (const node of all) {
    if (!hasOwnText(node)) continue;
    if (EXEMPT.some(selector => node.closest(selector))) continue;
    const style = getComputedStyle(node);
    const ink = rgb(style.color);
    if (!ink) continue;
    const behind = backdrop(node);
    // A translucent colour sits on what is behind it; blend before measuring.
    const blended = ink[3] < 1 ? ink.slice(0, 3).map((c, i) => c * ink[3] + behind[i] * (1 - ink[3])) : ink.slice(0, 3);
    const light = luminance(blended), dark = luminance(behind.slice(0, 3));
    const ratio = (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05);
    const size = parseFloat(style.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
    const floor = large ? 3 : ${contrastFloor};
    if (ratio < floor) {
      add(ratio < floor - 1 ? 'warning' : 'note', 'contrast', node,
        ratio.toFixed(2) + ':1 needs ' + floor + ' at ' + size.toFixed(0) + 'px — "' + text(node).slice(0, 30) + '"');
    }
  }

  // 6. A pane that rendered nothing at all. Usually a data path that failed
  //    without saying so, which a screenshot shows as innocent empty space.
  for (const selector of ['.transport-panel', '.rotating-panel', '.clock-block']) {
    const node = document.querySelector(selector);
    if (node && shown(node) && !text(node)) add('error', 'empty', node, selector + ' rendered with no text at all');
  }

  return JSON.stringify(problems);
})()`;

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  console.log(await import('node:fs').then(fs => fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter(line => line.startsWith('//')).map(line => line.slice(3)).join('\n')));
  process.exit(0);
}

const minFont = options.minFont ?? 11;
const contrastFloor = options.contrast ?? 4.5;
const wait = options.wait ?? 4000;
// A one-off audit when any page flag is given; the whole matrix otherwise.
const oneOff = options.scenes.length === 0 && (options.offline || options.demo || options.transitDemo || options.time || options.fact !== undefined || options.url);
const chosen = oneOff
  ? [{ name: 'custom', why: 'the flags given on the command line', args: options }]
  : MATRIX.filter(scene => options.scenes.length === 0 || options.scenes.includes(scene.name));
if (!chosen.length) throw new Error('No scene matches. Known scenes: ' + MATRIX.map(scene => scene.name).join(', '));

const layouts = oneOff
  ? [{ name: 'custom', width: options.width ?? 1280, height: options.height ?? 720 }]
  : [{ name: '1280x720', width: 1280, height: 720 }];

const firstUrl = pageUrl({ ...options, ...(chosen[0].args ?? {}) });
await waitForServer(firstUrl);
const binary = findChrome(options.chrome);
// One browser for the whole matrix. Launching Chrome per capture is most of
// what made checking every state slow enough to skip.
const { devtools, close } = await launchChrome(binary, 1280, 720);
const counts = { error: 0, warning: 0, note: 0 };
const started = Date.now();

try {
  for (const scene of chosen) {
    for (const layout of layouts) {
      const url = pageUrl({ ...options, ...(scene.args ?? {}) });
      const label = scene.name + ' @ ' + layout.name;
      const { send, evaluate, logged } = await openPage(devtools, {
        url, width: layout.width, height: layout.height, reducedMotion: options.reducedMotion, wait,
      });
      const problems = JSON.parse(await evaluate(AUDIT(SINGLE_LINE, FURNITURE, minFont, contrastFloor)));
      const failures = logged.filter(entry => ['error', 'exception'].includes(entry.level));

      const shown = problems.filter(problem => options.all || problem.level !== 'note');
      for (const problem of problems) counts[problem.level] += 1;
      const summary = problems.length === 0 && failures.length === 0
        ? 'clean'
        : [counts.error && 'errors', failures.length && failures.length + ' console errors'].filter(Boolean).join(', ') || shown.length + ' to look at';
      console.log('\n=== ' + label.padEnd(28) + (scene.why ?? '') + ' — ' + (problems.length ? problems.length + ' reported' : summary));
      for (const problem of shown) {
        console.log('  ' + problem.level.toUpperCase().padEnd(8) + problem.kind.padEnd(13) + problem.where);
        console.log('  ' + ''.padEnd(8) + ''.padEnd(13) + problem.detail);
      }
      for (const entry of failures) console.log('  ERROR   console      ' + entry.text.replace(/\s+/g, ' ').slice(0, 160));
      if (options.console) for (const entry of logged) console.log('  [' + entry.level + '] ' + entry.text.replace(/\s+/g, ' ').slice(0, 160));

      if (options.shots) {
        const out = path.join(ROOT, 'screenshots', 'audit', scene.name + '-' + layout.name.replace(':', '-') + '.png');
        await mkdir(path.dirname(out), { recursive: true });
        const { data } = await send('Page.captureScreenshot', {
          format: 'png', captureBeyondViewport: false,
          clip: { x: 0, y: 0, width: layout.width, height: layout.height, scale: 1 },
        });
        await writeFile(out, Buffer.from(data, 'base64'));
        console.log('  shot     ' + path.relative(ROOT, out));
      }
      await send('Page.close').catch(() => undefined);
    }
  }
} finally { await close(); }

const seconds = ((Date.now() - started) / 1000).toFixed(1);
console.log('\n' + chosen.length * layouts.length + ' states in ' + seconds + ' s: '
  + counts.error + ' error, ' + counts.warning + ' warning, ' + counts.note + ' note'
  + (options.all ? '' : ' (notes hidden; pass --all)'));
if (counts.error) {
  console.error('\nErrors are layout faults a screenshot will not point at. Fix them, or say why the check is wrong.');
  process.exit(1);
}
