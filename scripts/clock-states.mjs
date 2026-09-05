// Every state the clock widget's theme can be in, from one browser, on one
// sheet — plus a scan for the artefact this kind of scenery keeps producing.
//
// WHY THIS EXISTS
// The hillside theme has four light phases times eight skies times four rates.
// `npm run shot` captures one of those per run and launches a Chrome to do it,
// so looking at twenty states costs seven minutes of wall clock and twenty
// separate images that cannot be compared side by side. Every real fault found
// while building the theme — a cloud bank clipped into one hard line, a ridge
// whose flat top ruled a horizontal rule across the card, a text-shadow cut
// square by each digit's own overflow — was invisible in any single tile and
// obvious the moment the tiles were next to each other.
//
// THE SEAM SCAN
// Those three faults are one fault: a straight edge that nothing in the scene
// should have drawn. That is mechanically detectable. `--seams` reads each
// capture back and reports rows and columns where the image changes sharply
// and does so across most of its width or height, which is what a clipped
// gradient looks like and what a hill or a cloud never does.
//
//   npm run states                     the sheet, at screenshots/clock-states.png
//   npm run states -- --seams          and the scan, as text
//   npm run states -- --group rain     one row only
//   npm run states -- --pin dusk,snow  one extra state, appended
//
// It asks no provider: every state is `?weather=off` with the sky pinned by
// `?sky=`, so a run costs nothing and is deterministic. See docs/CLOCK.md.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome, launchChrome, openPage, waitForServer } from './lib/browser.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'screenshots', 'states');
const BASELINE = path.join(OUT, 'baseline');
const SHEET = path.join(ROOT, 'screenshots', 'clock-states.png');
const WIDTH = 1280, HEIGHT = 720, PAD = 6;
// The card needs a moment after load for the fonts to land and the Tenant to
// be measured onto the digits; below about two seconds it is captured mid-way.
const SETTLE_MS = 2400;

// The rows of the sheet. A group is a heading and the states under it; adding
// a state is a line here and nothing else.
const GROUPS = [
  { id: 'light', title: 'The four lights, clear sky', states: [
    ['dawn,clear', 'dawn'], ['day,clear', 'day'], ['dusk,clear', 'dusk'], ['night,clear', 'night'],
  ] },
  { id: 'sky', title: 'What the sky is made of, at midday', states: [
    ['day,partly', 'partly'], ['day,cloudy', 'cloudy'], ['day,overcast', 'overcast'], ['day,fog', 'fog'],
  ] },
  { id: 'rain', title: 'Rain, at three rates, and after dark', states: [
    ['day,rain,light', 'rain · light'], ['day,rain,moderate', 'rain · moderate'],
    ['day,rain,heavy', 'rain · heavy'], ['night,rain,heavy', 'night · rain · heavy'],
  ] },
  { id: 'snow', title: 'Snow and sleet, which settle on the canopy', states: [
    ['day,snow,light', 'snow · light'], ['day,snow,heavy', 'snow · heavy'],
    ['dusk,snow,moderate', 'dusk · snow'], ['day,sleet,moderate', 'sleet'],
  ] },
  { id: 'mixed', title: 'The light and the weather are independent', states: [
    ['dawn,snow,moderate', 'dawn · snow'], ['dusk,rain,heavy', 'dusk · rain'],
    ['night,overcast', 'night · overcast'], ['dawn,fog', 'dawn · fog'],
  ] },
];

function parseArgs(argv) {
  const options = { seams: false, groups: null, pins: [], time: '10:09', baseline: false, saveBaseline: false };
  for (let index = 0; index < argv.length; index += 1) {
    const next = () => { index += 1; return argv[index]; };
    switch (argv[index]) {
      case '--seams': options.seams = true; break;
      case '--baseline': options.baseline = true; break;
      case '--save-baseline': options.saveBaseline = true; break;
      case '--group': (options.groups ??= []).push(next()); break;
      case '--pin': options.pins.push(next()); break;
      case '--time': options.time = next(); break;
      case '--help': case '-h': options.help = true; break;
      default: throw new Error('Unknown flag ' + argv[index]);
    }
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  console.log('npm run states [-- --seams] [--baseline | --save-baseline]');
  console.log('              [--group <id>] [--pin <sky>] [--time HH:MM]');
  console.log('groups: ' + GROUPS.map(group => group.id).join(', '));
  process.exit(0);
}

const groups = [
  ...GROUPS.filter(group => !options.groups || options.groups.includes(group.id)),
  ...(options.pins.length ? [{ id: 'pinned', title: 'Pinned', states: options.pins.map(pin => [pin, pin]) }] : []),
];
if (!groups.length) throw new Error('No groups matched. Known: ' + GROUPS.map(group => group.id).join(', '));

const base = 'http://127.0.0.1:3000/?weather=off&time=' + encodeURIComponent(options.time) + '&sky=';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

await waitForServer('http://127.0.0.1:3000/');
await mkdir(OUT, { recursive: true });
if (options.saveBaseline) await mkdir(BASELINE, { recursive: true });
const chrome = await launchChrome(findChrome(), WIDTH, HEIGHT);
const shots = new Map();
try {
  // One page, navigated per state. A fresh target per state would work and
  // costs a Chrome tab each; the app reads `?sky=` once at mount, so a full
  // navigation is enough to change it.
  const page = await openPage(chrome.devtools, { url: base + 'dusk', width: WIDTH, height: HEIGHT, wait: SETTLE_MS });
  for (const group of groups) {
    for (const [pin, label] of group.states) {
      const loaded = chrome.devtools.once('Page.loadEventFired', page.sessionId);
      await page.send('Page.navigate', { url: base + encodeURIComponent(pin) });
      await loaded;
      await page.evaluate('document.fonts.ready.then(() => true)');
      await sleep(SETTLE_MS);
      // Park every scenery animation at its first frame. Without this a
      // capture catches the rain, the drift and the breathing wherever they
      // happen to be, two runs of the same state differ by a percent or two,
      // and --baseline cannot tell that from a change worth reading. Only the
      // backdrop is frozen: the Tenant's tracks are driven from JavaScript and
      // stopping those mid-pose would be a different lie.
      await page.evaluate(`(() => {
        for (const animation of document.getAnimations()) {
          const target = animation.effect && animation.effect.target;
          if (!target || !target.classList) continue;
          if (/(^|\\s)cs-/.test(target.className) || target.classList.contains('clock-light')) {
            animation.pause();
            animation.currentTime = 0;
          }
        }
        return true;
      })()`);
      const box = JSON.parse(await page.evaluate(`(() => {
        const rect = document.querySelector('.clock-widget').getBoundingClientRect();
        return JSON.stringify({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
      })()`));
      const clip = {
        x: Math.max(0, Math.floor(box.x) - PAD), y: Math.max(0, Math.floor(box.y) - PAD),
        width: Math.ceil(box.width) + 2 * PAD, height: Math.ceil(box.height) + 2 * PAD, scale: 1,
      };
      const { data } = await page.send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: false });
      const file = path.join(OUT, pin.replace(/,/g, '-') + '.png');
      await writeFile(file, Buffer.from(data, 'base64'));
      // The base64 is kept for the seam scan: a file:// image drawn into a
      // canvas taints it and getImageData then throws, while a data: URL is
      // same-origin and readable. The sheet still points at the files, which
      // only have to render.
      shots.set(pin, { file, data, label, width: clip.width, height: clip.height });
      if (options.saveBaseline) await writeFile(path.join(BASELINE, path.basename(file)), Buffer.from(data, 'base64'));
      console.log('captured ' + pin);
    }
  }

  await writeFile(path.join(ROOT, 'screenshots', '.states-sheet.html'), sheetHtml(groups, shots, options));
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1400, deviceScaleFactor: 1, mobile: false });
  const loaded = chrome.devtools.once('Page.loadEventFired', page.sessionId);
  await page.send('Page.navigate', { url: 'file://' + path.join(ROOT, 'screenshots', '.states-sheet.html') });
  await loaded;
  await sleep(900);
  const size = JSON.parse(await page.evaluate('JSON.stringify({ w: document.body.scrollWidth, h: document.body.scrollHeight })'));
  const { data } = await page.send('Page.captureScreenshot', {
    format: 'png', clip: { x: 0, y: 0, width: size.w, height: size.h, scale: 1 }, captureBeyondViewport: true,
  });
  await writeFile(SHEET, Buffer.from(data, 'base64'));
  console.log('\nsheet  ' + path.relative(ROOT, SHEET) + '  ' + size.w + 'x' + size.h);

  if (options.saveBaseline) console.log('baseline saved  ' + path.relative(ROOT, BASELINE));
  if (options.baseline) await reportDiff(page, shots);
  if (options.seams) await reportSeams(page, shots);
} finally {
  await chrome.close();
}

/**
 * What moved since the baseline, per state. A CSS change to one layer is
 * supposed to change some states and leave the rest alone, and "the rest alone"
 * is the half nobody checks: tuning the cloud bank also moved the ridge twice
 * during this theme's build, and both times it was found by eye, late.
 *
 * Reported as the share of pixels that differ and the band they differ in, so
 * a diff can be read against intent — "rain got darker in the top third" is a
 * result, "the ridge moved in the clear states" is a bug.
 */
async function reportDiff(page, shots) {
  // The scenery is frozen before every capture, so it is comparable; the
  // Tenant is not, because stopping its tracks mid-pose would misreport the
  // character. What that leaves is a few tenths of a percent in the rows it
  // occupies, from a blink or a breath, and saying so here is cheaper than
  // having someone chase it.
  console.log('\nAgainst the baseline (the Tenant is not frozen, so a few tenths of a percent'
    + '\naround its rows is the character breathing, not a change):');
  let missing = 0;
  for (const [pin, shot] of shots) {
    let before;
    try {
      before = await readFile(path.join(BASELINE, path.basename(shot.file)), 'base64');
    } catch { missing += 1; console.log('  ' + pin.padEnd(22) + 'no baseline'); continue; }
    const result = JSON.parse(await page.evaluate(`(async () => {
      const load = async src => { const image = new Image(); image.src = src; await image.decode(); return image; };
      const [a, b] = await Promise.all([
        load(${JSON.stringify('data:image/png;base64,' + before)}),
        load(${JSON.stringify('data:image/png;base64,' + shot.data)}),
      ]);
      if (a.width !== b.width || a.height !== b.height) return JSON.stringify({ resized: true });
      const read = image => {
        const canvas = document.createElement('canvas');
        canvas.width = image.width; canvas.height = image.height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, image.width, image.height).data;
      };
      const [before, after] = [read(a), read(b)];
      // Eight levels of tolerance: PNG is lossless, so anything above this is a
      // real paint difference and not encoder noise.
      const rows = new Array(a.height).fill(0);
      let changed = 0;
      for (let index = 0; index < before.length; index += 4) {
        const delta = Math.abs(before[index] - after[index])
          + Math.abs(before[index + 1] - after[index + 1])
          + Math.abs(before[index + 2] - after[index + 2]);
        if (delta > 8) { changed += 1; rows[Math.floor((index / 4) / a.width)] += 1; }
      }
      const total = a.width * a.height;
      let peak = 0;
      for (let row = 1; row < rows.length; row += 1) if (rows[row] > rows[peak]) peak = row;
      const band = rows.filter(count => count > 0);
      return JSON.stringify({
        share: changed / total,
        peak, height: a.height,
        first: rows.findIndex(count => count > 0),
        last: rows.length - 1 - [...rows].reverse().findIndex(count => count > 0),
        touched: band.length,
      });
    })()`));
    if (result.resized) { console.log('  ' + pin.padEnd(22) + 'size changed — baseline not comparable'); continue; }
    if (result.share === 0) { console.log('  ' + pin.padEnd(22) + 'identical'); continue; }
    const percent = (result.share * 100).toFixed(1);
    const where = 'rows ' + result.first + '–' + result.last + ' of ' + result.height + ', most at ' + result.peak;
    console.log('  ' + pin.padEnd(22) + percent.padStart(5) + '% of pixels  (' + where + ')');
  }
  if (missing) console.log('\n  ' + missing + ' state(s) had no baseline. Run --save-baseline once to make one.');
}

/**
 * Straight edges that nothing in the scene should have drawn. Read back in the
 * page, because a canvas is the cheapest image decoder available here and this
 * script must stay dependency-free like the rest of scripts/.
 *
 * A row is a seam when the mean absolute difference between it and the row
 * above is large AND most of the pixels along it change in the same direction
 * — a gradient clipped at a box edge does exactly that, and a hillside, a
 * cloud or a glyph never does, because their edges are curved and so their
 * change is spread over many rows.
 */
async function reportSeams(page, shots) {
  console.log('\nSeam scan — a straight edge across most of the card, which is what a clipped gradient leaves:');
  let found = 0;
  for (const [pin, shot] of shots) {
    const seams = await page.evaluate(`(async () => {
      const image = new Image();
      image.src = ${JSON.stringify('data:image/png;base64,' + shot.data)};
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      const { data, width, height } = context.getImageData(0, 0, image.width, image.height);
      const at = (x, y) => (y * width + x) * 4;
      const rows = [];
      // The card's own rounded border is a straight edge on purpose, and the
      // capture's padding puts it a known distance in, so the outer band on
      // every side is not evidence of anything.
      const margin = ${PAD} + 5;
      for (let y = margin; y < height - margin; y += 1) {
        let sum = 0, signed = 0, counted = 0;
        for (let x = margin + 4; x < width - margin - 4; x += 1) {
          const a = at(x, y), b = at(x, y - 1);
          const delta = (data[a] - data[b]) + (data[a + 1] - data[b + 1]) + (data[a + 2] - data[b + 2]);
          sum += Math.abs(delta); signed += Math.sign(delta); counted += 1;
        }
        const mean = sum / counted;
        const agreement = Math.abs(signed) / counted;
        if (mean > 26 && agreement > 0.82) rows.push({ y, mean: Math.round(mean), agreement: Number(agreement.toFixed(2)) });
      }
      return JSON.stringify(rows);
    })()`);
    const rows = JSON.parse(seams);
    if (rows.length) {
      found += rows.length;
      console.log('  ' + pin.padEnd(22) + rows.map(row => 'y=' + row.y + ' (Δ' + row.mean + ', ' + row.agreement + ' agree)').join('  '));
    }
  }
  console.log(found ? '\n' + found + ' suspect row(s). Look at the tile before believing it: a horizon meant to be\nstraight will show up here too.' : '  none.');
}

function sheetHtml(groups, shots, options) {
  const rows = groups.map(group => `
    <section>
      <h2>${group.title}</h2>
      <div class="row">${group.states.map(([pin]) => {
        const shot = shots.get(pin);
        return `<figure><img src="file://${shot.file}" width="${shot.width}" height="${shot.height}"><figcaption>${shot.label}</figcaption></figure>`;
      }).join('')}</div>
    </section>`).join('');
  return `<!doctype html><meta charset="utf-8"><style>
    :root { color-scheme:dark; }
    body { margin:0; padding:26px 28px 30px; background:#111113; font:13px/1.3 ui-sans-serif,system-ui,sans-serif; color:#f3f2ee; }
    h1 { margin:0 0 4px; font-size:19px; font-weight:600; }
    p.sub { margin:0 0 22px; color:#93939d; font-size:12.5px; }
    h2 { margin:0 0 9px; font-size:12px; font-weight:600; letter-spacing:.09em; text-transform:uppercase; color:#8d8d97; }
    section { margin-bottom:22px; }
    .row { display:flex; gap:14px; }
    figure { margin:0; }
    img { display:block; border-radius:7px; }
    figcaption { margin-top:6px; font-size:11.5px; letter-spacing:.05em; text-transform:uppercase; color:#a6a6b0; }
  </style>
  <h1>Clock widget — every sky it draws</h1>
  <p class="sub">1280 × 720, the Fire TV's real resolution, clock pinned to ${options.time}. Each tile is one <code>?sky=</code> pin; on the wall these come from the sun's elevation and the weather card's reading of the hour.</p>
  ${rows}`;
}
