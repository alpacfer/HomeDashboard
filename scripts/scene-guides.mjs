// Look at a painted card the way you would look at a stage set.
//
// The clock and the weather card are drawings with live things standing on
// them, and every placement question they raise is the same one: where, in this
// picture, is the surface? A screenshot cannot answer it. The bench in the
// workshop painting is drawn twice, once flat behind the digits and once larger
// in front of them, and the seam between the two reads as one plank to the eye
// and as nothing at all to the stylesheet. Four rounds of nudging `padding-top`
// against a PNG is how that gets guessed at; this is how it gets measured.
//
// Two things come out of one page load:
//
//   A table.  Every horizontal edge the composited card actually has, found by
//             reading the rendered pixels rather than the source artwork, so
//             the answer includes the second bench plane, the light pass and
//             the weather filter. Then every element that has to line up with
//             one: the digits' ink and their baseline, the date, the Tenant's
//             feet, and each named group inside the prop SVG. All in card
//             pixels and in per cent of its height, which is what the rules are
//             written in.
//
//   A guide.  The same card with those landmarks drawn on it — edges as ruled
//             lines, boxes round the props, the baseline picked out — so a
//             placement can be judged against the picture instead of against a
//             number. `--plain` leaves the drawing alone for a clean before.
//
// It also reports the light: the mean colour of the card and of each band, and
// where the brightest pool in the picture is. That is what a prop's filter has
// to match, and where a lamp has to stand to be the thing casting it.
//
// Run with `npm run scene -- [options]`. The dev server must be running, the
// same as for `npm run shot`.
//
//   --card <clock|weather>  Which painted card. Default clock.
//   --sky <spec>            Pin the scene's light and weather, as
//                           `npm run shot` does: `night,clear`, `dusk,rain`.
//                           Repeatable, and every state named goes through the
//                           same browser: reading a dozen of them is what
//                           deriving a light filter takes, and a Chrome launch
//                           each is most of a minute each. Default is whatever
//                           the pinned time gives.
//   --edges <n>             Report the n strongest horizontal edges. Default 8.
//   --step <n>              How sharp a row has to be to count as an edge, in
//                           mean luminance change across the row. Default 3.
//   --plain                 Capture the card with no guides drawn on it.
//   --with-content          Read the card with its type and props up. Off by
//                           default: both are brighter than the painting, so
//                           they would be the brightest pool in every reading.
//   --no-shot               Table only, write no PNG.
//   --out <file>            Where to write. Default screenshots/scene-<card>.png
//   --scale <n>             Output pixels per CSS pixel. Default 2.
//   --time, --offline, --demo, --no-weather, --transit-demo, --scene, --fact, --pet, --date, --url
//                           The usual debug flags. See scripts/lib/browser.mjs.
//   --width, --height       Viewport in CSS pixels. Default 1280 x 720.
//   --wait <ms>             Settle time after load. Default 4000.
//   --chrome <path>         Chrome binary. Also read from $CHROME_PATH.
//
// The card is captured, handed back to the page as an image and read there with
// a canvas, so the pixels analysed are the ones Chrome composited and no image
// decoder has to be installed to see them.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome, launchChrome, openPage, pageUrl, takeUrlFlag, waitForServer } from './lib/browser.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// What each card is, and which parts of it are worth naming in the table. A
// selector that matches nothing is skipped rather than reported empty, because
// the same card has different props under different weather.
const CARDS = {
  clock: {
    selector: '.clock-widget',
    // Hidden for the reading pass. Ivory digits are brighter than anything the
    // painter put in the room, so with them up the brightest pool in the
    // picture is always a glyph and the edges include their shoulders; and the
    // props carry their own glow, which would answer the question of where the
    // painted light is with the place a prop was already put.
    content: ['.clock-block', '.scene-props'],
    landmarks: [
      ['digits', '.clock'],
      ['digit cell', '.clock-digit'],
      ['colon', '.separator'],
      ['date', '.clock-date'],
      ['tenant', '.tenant'],
      ['tenant (reduced)', '.woodland-resident'],
      ['bench plane', '.workshop-bench'],
      ['window', '.shed-window-weather'],
      ['lamp', '.shed-lamp-shade'],
      ['lamplight', '.shed-lamplight'],
      ['shelf props', '.shed-furniture'],
    ],
  },
  weather: {
    selector: '.weather',
    content: ['.temperature', '.weather-headline', '.scene-props'],
    landmarks: [
      ['temperature', '.temperature'],
      ['condition', '.temperature > small'],
      ['headline', '.weather-headline'],
      ['landing pad', '.weather-landing'],
      ['campfire', '.exterior-camp'],
      ['sky mask', '.exterior-sky'],
    ],
  },
};

function parseArgs(argv) {
  const options = { card: 'clock', edges: 8, step: 3, scale: 2, guides: true, shot: true, skies: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => { index += 1; return argv[index]; };
    const [flag, inline] = arg.startsWith('--') && arg.includes('=') && !arg.startsWith('--url') ? arg.split(/=(.*)/s) : [arg, undefined];
    const value = () => inline ?? next();
    switch (flag) {
      case '--card': options.card = value(); break;
      case '--edges': options.edges = Number(value()); break;
      case '--step': options.step = Number(value()); break;
      case '--plain': options.guides = false; break;
      case '--with-content': options.withContent = true; break;
      case '--no-shot': options.shot = false; break;
      case '--out': options.out = value(); break;
      case '--scale': options.scale = Number(value()); break;
      case '--sky': options.skies.push(value()); break;
      case '--width': options.width = Number(value()); break;
      case '--height': options.height = Number(value()); break;
      case '--wait': options.wait = Number(value()); break;
      case '--chrome': options.chrome = value(); break;
      case '--help': case '-h': options.help = true; break;
      // --sky above is this tool's own: it is repeatable here and single
      // elsewhere. Its case wins before the shared handler is reached.
      default:
        if (takeUrlFlag(flag, options, value, arg)) break;
        throw new Error('Unknown option ' + arg + '. See the header of scripts/scene-guides.mjs.');
    }
  }
  return options;
}

// Read the card's own pixels: the horizontal edges in it, the mean colour of
// each third, and where its brightest pool sits. Runs in the page, on a capture
// of the card handed back as a data URL, so what it measures is the composite.
function analyse(dataUrl, step, count) {
  return `(async () => {
    const image = new Image();
    image.src = 'data:image/png;base64,' + ${JSON.stringify(dataUrl)};
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const { width, height } = canvas;
    const pixels = context.getImageData(0, 0, width, height).data;
    const luminance = (x, y) => { const i = (y * width + x) * 4; return 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]; };

    // A painted edge runs the width of the card; a digit's shoulder does not.
    // Only the middle of each row is read, so the rounded corners and the
    // vignette down the sides cannot invent one.
    const from = Math.round(width * 0.1), to = Math.round(width * 0.9);
    const rows = [];
    for (let y = 1; y < height; y += 1) {
      let sum = 0;
      for (let x = from; x < to; x += 1) sum += Math.abs(luminance(x, y) - luminance(x, y - 1));
      rows.push(sum / (to - from));
    }
    // Keep the strongest row of each run rather than every row of a soft edge.
    const peaks = [];
    for (let y = 0; y < rows.length; y += 1) {
      if (rows[y] < ${step}) continue;
      if (peaks.length && y - peaks[peaks.length - 1].y <= 3) {
        if (rows[y] > peaks[peaks.length - 1].strength) peaks[peaks.length - 1] = { y: y + 1, strength: rows[y] };
        continue;
      }
      peaks.push({ y: y + 1, strength: rows[y] });
    }
    const edges = peaks.sort((a, b) => b.strength - a.strength).slice(0, ${count})
      .map(peak => ({ y: peak.y, strength: +peak.strength.toFixed(1) })).sort((a, b) => a.y - b.y);

    const meanOf = (top, bottom) => {
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = Math.round(top); y < Math.round(bottom); y += 2) for (let x = 0; x < width; x += 2) {
        const i = (y * width + x) * 4; r += pixels[i]; g += pixels[i + 1]; b += pixels[i + 2]; n += 1;
      }
      return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n), lum: +((0.299 * r + 0.587 * g + 0.114 * b) / n).toFixed(1) };
    };

    // The brightest cell of a coarse grid is the lamp pool, the sun, or the
    // window: whatever the picture's own light source is.
    const cols = 32, cells = 16;
    let best = null;
    for (let cy = 0; cy < cells; cy += 1) for (let cx = 0; cx < cols; cx += 1) {
      const mean = meanOf(cy * height / cells, (cy + 1) * height / cells);
      let sum = 0, n = 0;
      for (let y = Math.round(cy * height / cells); y < Math.round((cy + 1) * height / cells); y += 2)
        for (let x = Math.round(cx * width / cols); x < Math.round((cx + 1) * width / cols); x += 2) { sum += luminance(x, y); n += 1; }
      void mean;
      const value = sum / n;
      if (!best || value > best.value) best = { value, cx, cy };
    }
    return {
      pixels: { width, height },
      edges,
      light: {
        card: meanOf(0, height), top: meanOf(0, height / 3), middle: meanOf(height / 3, 2 * height / 3), bottom: meanOf(2 * height / 3, height),
        brightest: { xPct: +(((best.cx + 0.5) / cols) * 100).toFixed(1), yPct: +(((best.cy + 0.5) / cells) * 100).toFixed(1), lum: +best.value.toFixed(1) },
      },
    };
  })()`;
}

// Draw the landmarks onto the card itself. Plain absolutely-placed divs, added
// to the page and captured with it: nothing here has to agree with a separate
// drawing surface about where the card is.
function overlay(selector, edges, landmarks) {
  return `(() => {
    const card = document.querySelector(${JSON.stringify(selector)});
    const layer = document.createElement('div');
    layer.id = 'scene-guides';
    layer.style.cssText = 'position:absolute;inset:0;z-index:9999;pointer-events:none;font:700 7px/1 ui-monospace,monospace;';
    const line = (y, label, colour) => {
      const rule = document.createElement('div');
      rule.style.cssText = 'position:absolute;left:0;right:0;top:' + y + 'px;height:1px;background:' + colour + ';';
      const tag = document.createElement('span');
      tag.textContent = label;
      tag.style.cssText = 'position:absolute;right:2px;top:-8px;padding:0 2px;color:#000;background:' + colour + ';';
      rule.appendChild(tag);
      layer.appendChild(rule);
    };
    const box = (rect, label, colour) => {
      const element = document.createElement('div');
      element.style.cssText = 'position:absolute;outline:1px dashed ' + colour + ';left:' + rect.left + 'px;top:' + rect.top
        + 'px;width:' + rect.width + 'px;height:' + rect.height + 'px;';
      const tag = document.createElement('span');
      tag.textContent = label;
      tag.style.cssText = 'position:absolute;left:0;top:-8px;padding:0 2px;color:#000;white-space:nowrap;background:' + colour + ';';
      element.appendChild(tag);
      layer.appendChild(element);
    };
    for (const edge of ${JSON.stringify(edges)}) line(edge.y, edge.y + ' / ' + edge.pct + '%', '#ff2f6d');
    for (const mark of ${JSON.stringify(landmarks)}) {
      if (mark.baseline !== undefined) line(mark.baseline, 'baseline ' + mark.baseline, '#39ff88');
      box(mark, mark.name, mark.name === 'digits' ? '#ffd23f' : '#4fc3ff');
    }
    card.appendChild(layer);
    return true;
  })()`;
}

function row(name, value) { return '  ' + name.padEnd(18) + value; }

// One sky: read the card, print the table, and write the guide.
async function report(chrome, options, card, sky) {
  const width = options.width ?? 1280, height = options.height ?? 720;
  const url = pageUrl({ ...options, sky });
  const page = await openPage(chrome.devtools, { url, width, height, wait: options.wait ?? 4000 });

  // The card's box, its landmarks and the digits' real baseline, all in the
  // card's own pixels. The baseline is measured the way the clock measures
  // it, from the face's metrics rather than from its cell.
  const measured = await page.evaluate(`(() => {
    const card = document.querySelector(${JSON.stringify(card.selector)});
    if (!card) return null;
    const box = card.getBoundingClientRect();
    const local = rect => ({ left: +(rect.left - box.left).toFixed(1), top: +(rect.top - box.top).toFixed(1),
      width: +rect.width.toFixed(1), height: +rect.height.toFixed(1) });
    const landmarks = [];
    for (const [name, selector] of ${JSON.stringify(card.landmarks)}) {
      const element = document.querySelector(selector);
      if (!element) continue;
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      landmarks.push({ name, selector, ...local(rect) });
    }
    const face = document.querySelector('.digit-face');
    if (face) {
      const style = getComputedStyle(face);
      const context = document.createElement('canvas').getContext('2d');
      context.font = style.fontWeight + ' ' + style.fontSize + ' ' + style.fontFamily;
      const metrics = context.measureText(face.textContent || '8');
      const rect = face.getBoundingClientRect();
      const centre = (rect.top + rect.bottom) / 2 - box.top;
      const baseline = centre + (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2;
      const digits = landmarks.find(mark => mark.name === 'digits');
      if (digits) { digits.baseline = +baseline.toFixed(1); digits.cap = +metrics.actualBoundingBoxAscent.toFixed(1); }
    }
    return { box: { x: box.left, y: box.top, width: +box.width.toFixed(1), height: +box.height.toFixed(1) }, landmarks };
  })()`);
  if (!measured) throw new Error('No ' + card.selector + ' on the page. Is the scene the one you meant?');

  const { box } = measured;
  const clip = { x: box.x, y: box.y, width: box.width, height: box.height, scale: 1 };
  // Read the painting, not what stands on it. `visibility` rather than
  // `display`, so nothing reflows and every landmark keeps the box just
  // measured; the guide pass puts it all back before drawing.
  const hide = show => page.evaluate(`(() => {
    for (const selector of ${JSON.stringify(card.content ?? [])})
      for (const element of document.querySelectorAll(selector)) element.style.visibility = ${JSON.stringify(show ? '' : 'hidden')};
    return true;
  })()`);
  if (!options.withContent) await hide(false);
  const plate = await page.send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: true });
  const read = await page.evaluate(analyse(plate.data, options.step, options.edges), 60_000);
  if (!options.withContent) await hide(true);
  const edges = read.edges.map(edge => ({ ...edge, pct: +((edge.y / box.height) * 100).toFixed(1) }));

  const pct = value => (value / box.height * 100).toFixed(1) + '%';
  console.log('\n' + options.card + (sky ? '  ' + sky : '') + '  ' + box.width + 'x' + box.height + '  ' + url);
  console.log('\n  painted edges       px      of card   strength');
  for (const edge of edges) console.log('  ' + String(edge.y).padStart(19) + ' ' + pct(edge.y).padStart(9) + ' ' + String(edge.strength).padStart(10));
  console.log('\n  landmark            top      bottom    left     right    of card (top-bottom)');
  for (const mark of measured.landmarks) {
    console.log('  ' + mark.name.padEnd(18) + String(mark.top).padStart(6) + String(+(mark.top + mark.height).toFixed(1)).padStart(10)
      + String(mark.left).padStart(9) + String(+(mark.left + mark.width).toFixed(1)).padStart(9)
      + '    ' + pct(mark.top) + ' - ' + pct(mark.top + mark.height)
      + (mark.baseline === undefined ? '' : '   baseline ' + mark.baseline + ' / ' + pct(mark.baseline)));
  }
  const { light } = read;
  const rgb = band => 'rgb(' + band.r + ',' + band.g + ',' + band.b + ')  L ' + band.lum;
  console.log('\n  light');
  console.log(row('whole card', rgb(light.card)));
  console.log(row('top third', rgb(light.top)));
  console.log(row('middle third', rgb(light.middle)));
  console.log(row('bottom third', rgb(light.bottom)));
  console.log(row('brightest pool', light.brightest.xPct + '% across, ' + light.brightest.yPct + '% down   L ' + light.brightest.lum));

  if (!options.shot) return;
  if (options.guides) await page.evaluate(overlay(card.selector, edges, measured.landmarks));
  const scale = options.scale ?? 2;
  const final = await page.send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale }, captureBeyondViewport: true });
  // A named sky writes its own file, so a sweep does not overwrite itself.
  const name = 'scene-' + options.card + (sky ? '-' + sky.replace(/[^a-z0-9]+/gi, '-') : '') + (options.guides ? '' : '-plain') + '.png';
  const out = path.resolve(ROOT, options.out ?? path.join('screenshots', name));
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, Buffer.from(final.data, 'base64'));
  console.log('\n  ' + path.relative(ROOT, out) + '  ' + Math.round(box.width * scale) + 'x' + Math.round(box.height * scale) + '\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { console.log('See the header of scripts/scene-guides.mjs.'); return; }
  const card = CARDS[options.card];
  if (!card) throw new Error('Unknown card ' + options.card + '. One of: ' + Object.keys(CARDS).join(', ') + '.');
  const skies = options.skies.length ? options.skies : [undefined];
  if (skies.length > 1 && options.out) throw new Error('--out names one file; drop it when sweeping several skies.');
  const width = options.width ?? 1280, height = options.height ?? 720;
  await waitForServer(pageUrl({ ...options, sky: skies[0] }));

  const chrome = await launchChrome(findChrome(options.chrome), width, height);
  try {
    for (const sky of skies) await report(chrome, options, card, sky);
  } finally {
    await chrome.close();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
