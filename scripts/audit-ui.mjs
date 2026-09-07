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
//   --save-baseline        Remember where every element is, per scene, in
//                          screenshots/audit/baseline.json.
//   --baseline             Report what moved since --save-baseline: every
//                          text-bearing element and panel whose box shifted
//                          or resized by more than a pixel, largest first.
//                          This is the answer to "does this change move
//                          anything else on the page?", which a screenshot
//                          answers only by eye. The transport scene is live
//                          data, so its rows can move on their own; the
//                          transport-marked and fact scenes use the synthetic
//                          board and are the stable ones.
//   --min-font <px>        Legibility floor. Default 11.
//   --contrast <ratio>     Contrast floor for ordinary text. Default 4.5;
//                          large text is held to 3, as WCAG does.
//   --all                  Report notes as well as warnings and errors.
//   --json                 Print the findings as one JSON document instead of
//                          the columns: { states, seconds, counts, ok,
//                          results: [{ scene, layout, why, url, problems,
//                          console, shot? }] }. Every problem keeps its level,
//                          kind, where and detail, so a caller can assert on
//                          one rather than grep a column. Exit code is
//                          unchanged: 1 when anything is an error.
//   --url <url>            Page to audit. Default http://127.0.0.1:3000/
//   --scene, --fact, --offline, --demo, --dry, --no-weather, --transit-demo, --transit, --time,
//   --pet
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

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome, launchChrome, openPage, pageUrl, printHelp, takeBrowserFlag, takeUrlFlag, waitForServer } from './lib/browser.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The states worth checking, and why each one is here rather than another.
// Every scene is checked at the Fire TV's fixed 1280 x 720 viewport.
const MATRIX = [
  { name: 'transport', why: 'the boards, with real departures', args: { scene: 'transport', offline: true } },
  { name: 'transport-marked', why: 'every delay, cancellation and service message at once', args: { scene: 'transport', offline: true, transit: 'demo' } },
  { name: 'fact', why: 'the daily fact, and the compact departure strip under it', args: { scene: 'fact', fact: 0, offline: true, transit: 'demo' } },
  { name: 'map', why: 'the forecast map, on the synthetic run', args: { scene: 'map', demo: true } },
  { name: 'map-dry', why: 'the map the rotation skips, and its caption over the basemap', args: { scene: 'map', dry: true } },
  // The clock's backdrop is drawn by the weather now, and the digits and the
  // date sit on it. Auditing one sky checks the one the forecast happens to be
  // showing, which is not the one that breaks. These are the two extremes the
  // ivory type has to stay legible against: snow lying on a lit midday canopy
  // is the brightest ground it ever crosses, and a clear night the darkest.
  { name: 'clock-bright', why: "the clock's brightest sky — snow on a lit canopy", args: { scene: 'transport', offline: true, sky: 'day,snow,heavy' } },
  { name: 'clock-dark', why: "the clock's darkest sky — a clear night", args: { scene: 'transport', offline: true, sky: 'night,clear' } },
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
  const options = { scenes: [], console: false, demo: false, dry: false, offline: false, reducedMotion: false, transit: '', shots: false, all: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => { index += 1; return argv[index]; };
    const [flag, inline] = arg.includes('=') && arg.startsWith('--') && !arg.startsWith('--url') ? arg.split(/=(.*)/s) : [arg, undefined];
    const value = () => inline ?? next();
    switch (flag) {
      case '--min-font': options.minFont = Number(value()); break;
      case '--contrast': options.contrast = Number(value()); break;
      case '--shots': options.shots = true; break;
      case '--save-baseline': options.saveBaseline = true; break;
      case '--baseline': options.baseline = true; break;
      case '--all': options.all = true; break;
      case '--json': options.json = true; break;
      // Here --scene picks rows of the matrix, and is repeatable. It must be
      // taken before the shared URL flags, where --scene is the page's own
      // single-valued flag: routed there, `--scene map` set options.scene,
      // options.scenes stayed empty, and "one scene" audited all seven.
      case '--scene': {
        const name = value();
        if (!MATRIX.some(scene => scene.name === name)) throw new Error('--scene ' + name + ' is not in the matrix. Known scenes: ' + MATRIX.map(scene => scene.name).join(', ') + '.');
        options.scenes.push(name);
        break;
      }
      default:
        if (takeBrowserFlag(flag, options, value) || takeUrlFlag(flag, options, value, arg)) break;
        throw new Error('Unknown option ' + arg + '. See the header of scripts/audit-ui.mjs.');
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

  // Geographic tags must never be covered by map UI or by another tag.
  // This is independent of overflow: two fully visible boxes can still overlap.
  const tags = all.filter(node => node.matches('.forecast-map-label'));
  const mapUI = all.filter(node => node.matches('.forecast-map-timeline,.forecast-map-credit,.forecast-map-message,.forecast-map-stale,.showing-forecast-map .scene-pin,.showing-forecast-map .screen-progress'));
  const overlaps = (a, b) => Math.min(a.right, b.right) > Math.max(a.left, b.left)
    && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);
  for (let index = 0; index < tags.length; index += 1) {
    const tag = tags[index];
    const box = boxes.get(tag);
    for (const other of [...mapUI, ...tags.slice(index + 1)]) {
      if (overlaps(box, boxes.get(other))) add('error', 'overlap', tag, 'Tag "' + text(tag) + '" overlaps ' + describe(other));
    }
    const map = tag.closest('.forecast-map-canvas')?.getBoundingClientRect();
    if (map && (box.left < map.left || box.right > map.right || box.top < map.top || box.bottom > map.bottom)) {
      add('error', 'clipped', tag, 'Geographic tag extends outside the map viewport');
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

  // 7. Where everything is, for --baseline: every element that carries its
  //    own words, and the panels they sit in, keyed by a short path plus an
  //    ordinal when several share one. The Tenant is left out because it
  //    moves on its own. This is not a fault list; it is the census that
  //    --baseline compares two runs of, to answer "did this change move
  //    anything else?", which nothing else here can.
  const LANDMARKS = ${JSON.stringify(LANDMARKS)};
  const census = [];
  const ordinals = new Map();
  const round = value => Math.round(value * 10) / 10;
  for (const node of all) {
    if (node.closest('.tenant')) continue;
    if (!hasOwnText(node) && !LANDMARKS.some(selector => node.matches(selector))) continue;
    const box = boxes.get(node);
    if (!box.width && !box.height) continue;
    const base = describe(node);
    const ordinal = (ordinals.get(base) ?? 0) + 1;
    ordinals.set(base, ordinal);
    census.push({ key: base + (ordinal > 1 ? ' [' + ordinal + ']' : ''), x: round(box.left), y: round(box.top), w: round(box.width), h: round(box.height), text: text(node).slice(0, 24) });
  }

  return JSON.stringify({ problems, census });
})()`;

// The panels the census always records, whether or not they carry text.
const LANDMARKS = [
  '.display-shell', '.clock-widget', '.clock-block', '.weather', '.weather-band', '.week-strip',
  '.transport-panel', '.transport-mini', '.rotating-panel', '.forecast-map-frame', '.forecast-map-canvas', '.fact-body',
];

// What moved between two censuses of one scene. A box that moved or resized
// by more than a pixel in any direction counts; sub-pixel drift is rounding.
function movedSince(before, after) {
  const prior = new Map(before.map(box => [box.key, box]));
  const moved = [];
  const added = [];
  for (const box of after) {
    const was = prior.get(box.key);
    if (!was) { added.push(box); continue; }
    prior.delete(box.key);
    const delta = { x: box.x - was.x, y: box.y - was.y, w: box.w - was.w, h: box.h - was.h };
    const most = Math.max(...Object.values(delta).map(Math.abs));
    if (most > 1) moved.push({ ...box, delta, most });
  }
  moved.sort((a, b) => b.most - a.most);
  return { moved, added, gone: [...prior.values()], compared: after.length - added.length };
}

const signed = value => (value > 0 ? '+' : '') + (Math.round(value * 10) / 10);

const options = parseArgs(process.argv.slice(2));
if (options.help) { await printHelp(import.meta.url); process.exit(0); }

const BASELINE_FILE = path.join(ROOT, 'screenshots', 'audit', 'baseline.json');
let baseline = { savedAt: null, scenes: {} };
if (options.baseline) {
  try { baseline = JSON.parse(await readFile(BASELINE_FILE, 'utf8')); } catch {
    throw new Error('No baseline at ' + path.relative(ROOT, BASELINE_FILE) + '. Run with --save-baseline first, before the change.');
  }
}
const saved = { savedAt: new Date().toISOString(), scenes: {} };

const minFont = options.minFont ?? 11;
const contrastFloor = options.contrast ?? 4.5;
const wait = options.wait ?? 4000;
// A one-off audit when any page flag is given; the whole matrix otherwise.
const oneOff = options.scenes.length === 0 && (options.offline || options.demo || options.dry || options.transit || options.time || options.sky || options.fact !== undefined || options.url);
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
// --json collects the same findings the prose is built from and prints one
// document at the end, so a caller can assert on a finding instead of
// grepping a column. The page already hands us structured problems; the
// human format is the lossy one.
const collected = [];
const say = (...parts) => { if (!options.json) console.log(...parts); };

try {
  for (const scene of chosen) {
    for (const layout of layouts) {
      const url = pageUrl({ ...options, ...(scene.args ?? {}) });
      const label = scene.name + ' @ ' + layout.name;
      const { send, evaluate, logged } = await openPage(devtools, {
        url, width: layout.width, height: layout.height, reducedMotion: options.reducedMotion, wait,
      });
      const { problems, census } = JSON.parse(await evaluate(AUDIT(SINGLE_LINE, FURNITURE, minFont, contrastFloor)));
      const failures = logged.filter(entry => ['error', 'exception'].includes(entry.level));

      const shown = problems.filter(problem => options.all || problem.level !== 'note');
      for (const problem of problems) counts[problem.level] += 1;
      // Counted for this scene, not across the run: reading the cumulative
      // tally here reported an earlier scene's errors against a clean one.
      const here = problems.filter(problem => problem.level === 'error').length;
      const summary = problems.length === 0 && failures.length === 0
        ? 'clean'
        : [here && here + ' errors', failures.length && failures.length + ' console errors'].filter(Boolean).join(', ') || shown.length + ' to look at';
      say('\n=== ' + label.padEnd(28) + (scene.why ?? '') + ' — ' + (problems.length ? problems.length + ' reported' : summary));
      for (const problem of shown) {
        say('  ' + problem.level.toUpperCase().padEnd(8) + problem.kind.padEnd(13) + problem.where);
        say('  ' + ''.padEnd(8) + ''.padEnd(13) + problem.detail);
      }
      for (const entry of failures) say('  ERROR   console      ' + entry.text.replace(/\s+/g, ' ').slice(0, 160));
      if (options.console) for (const entry of logged) say('  [' + entry.level + '] ' + entry.text.replace(/\s+/g, ' ').slice(0, 160));
      const record = {
        scene: scene.name, layout: layout.name, why: scene.why ?? null, url,
        problems,
        console: (options.console ? logged : failures).map(entry => ({ level: entry.level, text: entry.text.replace(/\s+/g, ' ') })),
      };
      collected.push(record);

      if (options.saveBaseline) saved.scenes[scene.name] = { url, census };
      if (options.baseline) {
        const before = baseline.scenes[scene.name];
        if (!before) {
          say('  baseline     none for this scene; run --save-baseline');
        } else {
          const diff = movedSince(before.census, census);
          record.baseline = { savedAt: baseline.savedAt, ...diff };
          if (!diff.moved.length && !diff.added.length && !diff.gone.length) {
            say('  baseline     nothing moved: ' + diff.compared + ' elements where they were');
          } else {
            say('  baseline     ' + diff.moved.length + ' of ' + diff.compared + ' elements moved'
              + (diff.added.length ? ', ' + diff.added.length + ' new' : '') + (diff.gone.length ? ', ' + diff.gone.length + ' gone' : '')
              + ' since ' + baseline.savedAt);
            for (const box of diff.moved.slice(0, 12)) {
              say('    ' + ('x' + signed(box.delta.x) + ' y' + signed(box.delta.y) + ' w' + signed(box.delta.w) + ' h' + signed(box.delta.h)).padEnd(26)
                + box.key + (box.text ? '  "' + box.text + '"' : ''));
            }
            if (diff.moved.length > 12) say('    … and ' + (diff.moved.length - 12) + ' more');
            for (const box of diff.added.slice(0, 6)) say('    new    ' + box.key + (box.text ? '  "' + box.text + '"' : ''));
            for (const box of diff.gone.slice(0, 6)) say('    gone   ' + box.key + (box.text ? '  "' + box.text + '"' : ''));
          }
        }
      }

      if (options.shots) {
        const out = path.join(ROOT, 'screenshots', 'audit', scene.name + '-' + layout.name.replace(':', '-') + '.png');
        await mkdir(path.dirname(out), { recursive: true });
        const { data } = await send('Page.captureScreenshot', {
          format: 'png', captureBeyondViewport: false,
          clip: { x: 0, y: 0, width: layout.width, height: layout.height, scale: 1 },
        });
        await writeFile(out, Buffer.from(data, 'base64'));
        say('  shot     ' + path.relative(ROOT, out));
        record.shot = path.relative(ROOT, out);
      }
      await send('Page.close').catch(() => undefined);
    }
  }
} finally { await close(); }

const seconds = ((Date.now() - started) / 1000).toFixed(1);
if (options.saveBaseline) {
  // Scenes not audited this run keep their previous census, so a one-scene
  // save does not erase the rest.
  const merged = { savedAt: saved.savedAt, scenes: { ...(await readFile(BASELINE_FILE, 'utf8').then(JSON.parse).catch(() => ({ scenes: {} }))).scenes, ...saved.scenes } };
  await mkdir(path.dirname(BASELINE_FILE), { recursive: true });
  await writeFile(BASELINE_FILE, JSON.stringify(merged));
  say('\nbaseline saved  ' + path.relative(ROOT, BASELINE_FILE) + '  (' + Object.keys(saved.scenes).length + ' scene(s))');
}
if (options.json) {
  console.log(JSON.stringify({ states: collected.length, seconds: Number(seconds), counts, ok: counts.error === 0, results: collected }, null, 2));
} else {
  console.log('\n' + chosen.length * layouts.length + ' states in ' + seconds + ' s: '
    + counts.error + ' error, ' + counts.warning + ' warning, ' + counts.note + ' note'
    + (options.all ? '' : ' (notes hidden; pass --all)'));
}
if (counts.error) {
  if (!options.json) console.error('\nErrors are layout faults a screenshot will not point at. Fix them, or say why the check is wrong.');
  process.exit(1);
}
