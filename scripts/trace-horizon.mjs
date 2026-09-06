// Where the paint stops, read off the paintings rather than guessed at.
//
// The weather card is a painted woodland clearing with a live sky drawn over
// it: a sun, a high thin layer and a cloud bank, all in `.exterior-sky`. The
// clock card is a timber workshop with one small arched window in it, and the
// weather belongs behind its glass. Those layers are in front of the paintings,
// so without a shape to cut them to, the sun crosses the tree canopy, the
// clouds sit on top of the far ridge, and the weather rubs out the painted
// mullions. What they need is the outline of the painted sky itself and the
// outline of the glass — and both are properties of the artwork, not numbers
// anyone should be nudging in a stylesheet.
//
// So they are measured. The segmentation is in scripts/lib/segment.mjs, which
// explains itself; the short version is that the colour of the sky is fitted as
// a field, carried into the canopy where there is no sky to look at, and every
// pixel is asked how far off it is. What comes out is a per-pixel ALPHA rather
// than a polygon, and that is the point: a hand-painted leaf edge is soft, half
// a pixel of leaf over half a pixel of sky, and only an alpha can say so. The
// first version of this tool traced one top and one bottom per column into a
// 137-point polygon, which flattened a lacy canopy into a staircase and threw
// away every gap of sky between the leaves.
//
// Three things come out of one run:
//
//   app/horizon.css   Generated. The two masks, as inline PNGs — no request —
//                     and the handful of numbers the sun's arc is expressed in:
//                     where the traced sky begins and ends across the card, and
//                     how low and high the disc may sit. lib/sky-arc.ts
//                     supplies only the two unitless fractions; every position
//                     on the card is here, because it is geometry read off the
//                     painting and geometry belongs in the stylesheet.
//
//   Two overlays.     Each plate with everything its mask removes dimmed, so
//                     the answer can be judged against the picture instead of
//                     against a list of coordinates. This is the part worth
//                     actually looking at when a trace is wrong.
//
// Plain Node with a headless Chrome, like the other tools here: Node cannot
// decode WebP and this repository does not add a dependency for it, so the
// plates are handed to a page as data URLs and read back through a canvas.
// Unlike the rest of scripts/, no dev server is needed — the input is the
// artwork in public/scenes, not a rendered page.
//
// Run with `npm run horizon -- [options]`.
//
//   --plate <name>     Use only this plate (day, dawn, dusk, night).
//                      Repeatable. Default is all four, combined by median.
//   --factor <n>       How far off the fitted sky a pixel may be and still be
//                      sky, as a multiple of how far the sky itself strays.
//                      Default 1.9. Raise it if leaves are eating into open
//                      sky; lower it if the hazy far treeline is being taken
//                      for sky.
//   --iterations <n>   Refits of the sky field. Default 4.
//   --disagree <pct>   Fail if the plates disagree about more than this share of
//                      the picture AWAY FROM ANY EDGE, which is the only place
//                      a plate out of register could show. Default 0.5. Along
//                      the edges they always disagree a little, because four
//                      separately painted plates land their leaf edges a pixel
//                      apart; that figure is reported but not gated.
//   --no-write         Report and draw, change nothing.
//   --out <file>       Where to write the overlay.
//                      Default screenshots/horizon.png
//   --scale <n>        Overlay pixels per image pixel. Default 2.
//   --chrome <path>    Chrome binary. Also read from $CHROME_PATH.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome, launchChrome } from './lib/browser.mjs';
import { segmentScene } from './lib/segment.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLATES = ['day', 'dawn', 'dusk', 'night'];
const PLATE_FILE = (scene, name) => 'public/scenes/' + scene + '-' + name + '-v1.webp';
const GENERATED = 'app/horizon.css';

function parseArgs(argv) {
  const options = { plates: [], factor: 1.9, iterations: 4, disagree: 0.5, scale: 2, write: true };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => { index += 1; return argv[index]; };
    const [flag, inline] = arg.startsWith('--') && arg.includes('=') ? arg.split(/=(.*)/s) : [arg, undefined];
    const value = () => inline ?? next();
    switch (flag) {
      case '--plate': options.plates.push(value()); break;
      case '--factor': options.factor = Number(value()); break;
      case '--iterations': options.iterations = Number(value()); break;
      case '--disagree': options.disagree = Number(value()); break;
      case '--no-write': options.write = false; break;
      case '--out': options.out = value(); break;
      case '--scale': options.scale = Number(value()); break;
      case '--chrome': options.chrome = value(); break;
      case '--help': case '-h': options.help = true; break;
      default: throw new Error('Unknown option ' + arg + '. See the header of scripts/trace-horizon.mjs.');
    }
  }
  if (!options.plates.length) options.plates = [...PLATES];
  for (const plate of options.plates) {
    if (!PLATES.includes(plate)) throw new Error('Unknown plate ' + plate + '. One of: ' + PLATES.join(', '));
  }
  return options;
}

// The segmentation runs in the page; this is how it gets there. Stringifying
// the real function is what lets scripts/lib/segment.mjs be ordinary readable
// JavaScript rather than a template literal nobody can edit.
const inPage = (fn, input) => '(' + fn.toString() + ')(' + JSON.stringify(input) + ')';

// The overlay: the plate with everything the mask removes dimmed, and for the
// clearing, the sun's arc drawn across the sky it has to cross. Drawn in the
// page because the mask is a PNG the page has just made, and because no image
// encoder has to be installed here to composite two of them.
async function drawOverlay(input) {
  const plate = new Image();
  plate.src = input.plate;
  const mask = new Image();
  mask.src = input.mask;
  await Promise.all([plate.decode(), mask.decode()]);

  const region = input.zoom ?? { left: 0, top: 0, right: 1, bottom: 1 };
  const sw = plate.naturalWidth * (region.right - region.left);
  const sh = plate.naturalHeight * (region.bottom - region.top);
  const magnify = input.scale * (input.zoom ? Math.min(760 / sw, 900 / sh) : 1);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw * magnify);
  canvas.height = Math.round(sh * magnify);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.imageSmoothingEnabled = !input.zoom;

  const draw = image => context.drawImage(image,
    image.naturalWidth * region.left, image.naturalHeight * region.top, sw, sh, 0, 0, canvas.width, canvas.height);

  // The mask's own alpha, painted as the dimming: where the mask is empty the
  // plate goes dark, where it is solid the plate is left alone, and where it is
  // half -- a leaf edge -- the plate is half dark. So the picture shows the
  // soft edges as soft, which an outline drawn in pink could never do.
  draw(plate);
  const lit = context.getImageData(0, 0, canvas.width, canvas.height);
  context.clearRect(0, 0, canvas.width, canvas.height);
  draw(mask);
  const alpha = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < lit.data.length; index += 4) {
    const keep = 0.24 + 0.76 * (alpha.data[index + 3] / 255);
    lit.data[index] = lit.data[index] * keep;
    lit.data[index + 1] = lit.data[index + 1] * keep;
    lit.data[index + 2] = lit.data[index + 2] * keep + (1 - keep) * 26;
    lit.data[index + 3] = 255;
  }
  context.putImageData(lit, 0, 0);

  if (input.arc) {
    const place = point => [
      (point[0] - region.left) / (region.right - region.left) * canvas.width,
      (point[1] - region.top) / (region.bottom - region.top) * canvas.height,
    ];
    context.strokeStyle = 'rgba(255,214,110,.95)';
    context.lineWidth = 1.5 * magnify;
    context.setLineDash([6 * magnify, 4 * magnify]);
    context.beginPath();
    input.arc.path.map(place).forEach((point, index) => index ? context.lineTo(point[0], point[1]) : context.moveTo(point[0], point[1]));
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = 'rgba(255,214,110,.95)';
    for (const mark of input.arc.marks) {
      const point = place(mark);
      context.beginPath();
      context.arc(point[0], point[1], input.arc.radius * canvas.width, 0, Math.PI * 2);
      context.fill();
    }
  }
  return canvas.toDataURL('image/png');
}

// The longest unbroken run of columns that have sky. The picture has exactly
// one such region — everything left of the framing tree's trunk is tree — and
// taking the longest run rather than the first keeps a stray column at the very
// edge from starting the track in the wrong place.
function span(has) {
  let best = null, start = -1;
  for (let x = 0; x <= has.length; x += 1) {
    const inside = x < has.length && has[x];
    if (inside && start < 0) start = x;
    if (!inside && start >= 0) {
      if (!best || x - start > best.to - best.from) best = { from: start, to: x - 1 };
      start = -1;
    }
  }
  return best;
}

/** The four numbers the sun's arc is expressed in, all fractions of the card. */
function buildArc(sky) {
  const { seam, crown, has, width, height } = sky;
  // The disc is a circle, so it is one fraction of the card across and a
  // different fraction of it down; the card is about twice as wide as it is
  // tall. Writing both out is the difference between "one disc of clearance"
  // and "one disc sideways, half a disc down".
  const across = 0.019;
  const down = across * (width / height);

  // The track runs between the columns where there is sky ENOUGH, not merely
  // sky. Where the canopy comes down to meet the treeline at the right-hand
  // end, the gap closes to a sliver a few rows deep -- real sky, correctly
  // traced, and no place to put a disc: taking it as the end of the track hung
  // the setting sun half off the edge of the card.
  const room = new Uint8Array(width);
  for (let x = 0; x < width; x += 1) room[x] = has[x] && seam[x] - crown[x] >= down * 3 ? 1 : 0;
  const reach = span(room);
  if (!reach) throw new Error('No painted sky was found with room for the disc in it. Look at the overlay: either the artwork has changed beyond recognition, or --factor is far too low.');

  const from = reach.from / width + across * 2;
  const to = reach.to / width - across;

  const middle = index => index > width * 0.33 && index < width * 0.72;
  const overMiddle = values => values.filter((_, index) => middle(index) && has[index]);
  const inSpan = values => values.filter((_, index) => index >= reach.from && index <= reach.to && has[index]);
  const deepest = Math.max(...inSpan(seam));
  const shallowest = Math.min(...overMiddle(crown));
  const seamAt = fraction => seam[Math.min(width - 1, Math.max(0, Math.round(fraction * width)))];

  // Where the disc sits when the body is exactly on the horizon. Only the two
  // ENDS of the track matter: that is the only place on the arc a body at zero
  // elevation is ever found, because how far across the card it is and how high
  // it is are both the same hour angle. Measuring against the deepest point of
  // the whole seam instead -- which is in the middle of the card, under the
  // midday sun -- buries the disc thirteen points of card below the ridge it is
  // rising behind, and holds a September sunrise back by an hour and a quarter.
  const low = Math.min(Math.max(seamAt(from), seamAt(to)) + down, 1);
  // At the peak the disc keeps a whole disc between itself and whatever is
  // above it: the canopy over the middle of the card, or the top of the card
  // where there is no canopy.
  const high = Math.max(shallowest + down * 2, down * 2);

  const arc = { path: [], marks: [], radius: across };
  for (let step = 0; step <= 60; step += 1) {
    const cross = step / 60;
    // The same arc the stylesheet composes, so the overlay is a drawing of the
    // rule rather than a second opinion about it.
    arc.path.push([from + (to - from) * cross, low + (high - low) * Math.sin(cross * Math.PI)]);
  }
  for (const cross of [0, 0.25, 0.5, 0.75, 1]) {
    arc.marks.push([from + (to - from) * cross, low + (high - low) * Math.sin(cross * Math.PI)]);
  }
  return {
    arc, deepest, shallowest, ends: [seamAt(from), seamAt(to)],
    reach: { from: reach.from / width, to: reach.to / width },
    track: { from, to, low, high },
  };
}

const percent = value => (value * 100).toFixed(2) + '%';
const kilobytes = url => (url.length * 0.75 / 1024).toFixed(1) + ' KB';

function report(sky, geometry, glass, options) {
  console.log('Plates   ' + sky.plates.map(entry => entry.plate + ' (ΔE ' + entry.threshold + ', sky ' + entry.area + '%)').join(', '));
  console.log('Sky      ' + sky.area + '% of the card, x ' + percent(geometry.reach.from) + ' to ' + percent(geometry.reach.to));
  console.log('Edges    ' + sky.uncertain + '% of the picture is a soft edge — leaf against sky, and painted that way');
  console.log('Agree    ' + sky.edgeDisagreement + '% of the picture is read differently by different plates, almost all of'
    + ' it brushwork along an edge');
  console.log('         ' + sky.disagreement + '% of it is away from any edge, where a plate out of register would show,'
    + ' against ' + options.disagree + '% allowed');
  console.log('Seam     deepest ' + percent(geometry.deepest) + ', lowest canopy over the middle ' + percent(geometry.shallowest)
    + ', at the track ends ' + percent(geometry.ends[0]) + ' and ' + percent(geometry.ends[1]));
  console.log('Track    x ' + percent(geometry.track.from) + ' to ' + percent(geometry.track.to)
    + ', y ' + percent(geometry.track.low) + ' at the horizon, ' + percent(geometry.track.high) + ' at the peak');
  console.log('');
  console.log('Window   box x ' + percent(glass.box.left / sky.width) + ' to ' + percent(glass.box.right / sky.width)
    + ', y ' + percent(glass.box.top / sky.height) + ' to ' + percent(glass.box.bottom / sky.height) + ' of the card');
  console.log('Glass    ' + glass.area + '% of the card');
  console.log('Counted  ' + glass.counted.join(', '));
  console.log('Sky ends ' + percent(glass.skyEnd) + ' down the card, from rows '
    + glass.ends.map(entry => entry.plate + ' ' + entry.at).join(', '));
  console.log('Gates    ' + glass.gates.map(entry => entry.plate + ' ' + entry.gate).join(', '));
  if (glass.escaped.length) {
    console.log('LEAKED   ' + glass.escaped.join(', ') + ' — the fill reached the edge of the box, so the frame has a gap'
      + ' in it or the gate is too low there. Those plates were left out of the vote; the rest still describe the glass.');
  }
  console.log('');
  console.log('Masks    sky ' + kilobytes(sky.mask) + ', window ' + kilobytes(glass.mask));
}

function stylesheet(sky, geometry, glass, options) {
  return `/* Generated by npm run horizon. Do not edit.
 *
 * Where the paint stops in public/scenes/*.webp, as two masks and four numbers.
 * Traced from ${options.plates.length} plate${options.plates.length === 1 ? '' : 's'} and combined by taking the median.
 * ${sky.uncertain}% of the picture is a soft edge — a leaf against the sky, which is
 * how it was painted — and the plates disagree about ${sky.disagreement}% of it away
 * from any edge, which is where one out of register with the others would show.
 *
 * To change any of it, change the paintings and run: npm run horizon
 * Traced at --factor ${options.factor}, --iterations ${options.iterations}. See scripts/trace-horizon.mjs.
 */

/* The sky in the clearing: the underside of the framing tree's canopy, the far
 * ridge and the treeline, to the leaf. Everything drawn into .exterior-sky is
 * cut to it — the disc, the high thin layer and the cloud bank alike — which is
 * what puts all three behind the trees instead of over them.
 *
 * A MASK RATHER THAN A CLIP PATH, and an image rather than a shape, for one
 * reason: a painted leaf edge is soft. A clip path can only say in or out, so
 * it renders a canopy as a staircase and cannot hold a gap of sky between two
 * leaves at all. The alpha here is that edge as the painter left it. Inline, so
 * it is still no request: ${kilobytes(sky.mask)} decoded once at load, and nothing per frame.
 * The plate is painted at background-size:100% 100%, so the mask and the
 * painting stretch to the card together and no aspect correction is involved. */
.exterior-sky {
  -webkit-mask-image: url("${sky.mask}"); mask-image: url("${sky.mask}");
  -webkit-mask-size: 100% 100%; mask-size: 100% 100%;
  -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;
}

/* Where the sun and moon may travel on this painting, and how far the disc
 * climbs. lib/sky-arc.ts supplies --arc-cross and --arc-climb, both plain
 * fractions of one; these four numbers are what turn them into a place on the
 * card. --arc-low is a disc's depth under whichever end of the track the seam
 * runs deeper at, so a body at zero elevation is behind the land at both. */
.ct-hillside {
  --arc-from: ${percent(geometry.track.from)};
  --arc-to: ${percent(geometry.track.to)};
  --arc-low: ${percent(geometry.track.low)};
  --arc-high: ${percent(geometry.track.high)};
}

/* The shed window's four panes, the same way and for the same reason: the
 * painted frame and mullions have soft sides, and a mask that steps a whole
 * pixel at one of them shows a staircase across the glass. This is what leaves
 * them standing in front of the weather instead of under it. ${kilobytes(glass.mask)}. */
.shed-window-sky {
  -webkit-mask-image: url("${glass.mask}"); mask-image: url("${glass.mask}");
  -webkit-mask-size: 100% 100%; mask-size: 100% 100%;
  -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;
}

/* How far down the glass there is sky to put weather in. Below this the panes
 * show painted trees, and a cloud drifting over a tree reads as a smear on the
 * inside of the window rather than as weather beyond it. The cloud layer wears
 * this as a second mask of its own — two masks on two elements rather than one
 * composited pair, which needs no mask-composite support to be right. */
.ct-workshop { --shed-sky-end: ${percent(glass.skyEnd)}; }
`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    const source = await readFile(fileURLToPath(import.meta.url), 'utf8');
    console.log(source.split('\n').filter(line => line.startsWith('//')).map(line => line.slice(3)).join('\n'));
    return;
  }

  const { devtools, close } = await launchChrome(findChrome(options.chrome), 900, 600);
  let sky, glass, geometry, overlay, windowOverlay;
  try {
    const { targetId } = await devtools.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await devtools.send('Target.attachToTarget', { targetId, flatten: true });
    const evaluate = async expression => {
      const { result, exceptionDetails } = await devtools.send('Runtime.evaluate',
        { expression, awaitPromise: true, returnByValue: true }, sessionId, 300_000);
      if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
      return result.value;
    };

    const urls = new Map();
    for (const scene of ['exterior', 'interior']) {
      for (const plate of options.plates) {
        const bytes = await readFile(path.join(ROOT, PLATE_FILE(scene, plate)));
        urls.set(scene + ':' + plate, 'data:image/webp;base64,' + bytes.toString('base64'));
      }
    }
    const listFor = scene => options.plates.map(plate => ({ plate, url: urls.get(scene + ':' + plate) }));
    const settings = {
      iterations: options.iterations, factor: options.factor, floor: 2.5,
      sigmaY: 9, sigmaX: 55, softLow: 0.75, softHigh: 1.25, gate: 0.45, band: 0.18, evidence: 0.02,
    };

    sky = await evaluate(inPage(segmentScene, { mode: 'sky', plates: listFor('exterior'), settings }));
    glass = await evaluate(inPage(segmentScene, { mode: 'window', plates: listFor('interior'), settings }));
    if (glass.error) throw new Error('interior: ' + glass.error);
    geometry = buildArc(sky);

    overlay = await evaluate(inPage(drawOverlay, {
      plate: urls.get('exterior:' + options.plates[0]), mask: sky.mask, scale: options.scale, arc: geometry.arc,
    }));
    windowOverlay = await evaluate(inPage(drawOverlay, {
      plate: urls.get('interior:' + options.plates[0]), mask: glass.mask, scale: options.scale,
      zoom: {
        left: glass.box.left / sky.width, right: (glass.box.right + 1) / sky.width,
        top: glass.box.top / sky.height, bottom: (glass.box.bottom + 1) / sky.height,
      },
    }));
  } finally {
    await close();
  }

  report(sky, geometry, glass, options);

  const out = path.resolve(ROOT, options.out ?? 'screenshots/horizon.png');
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, Buffer.from(overlay.split(',')[1], 'base64'));
  console.log('\nOverlay  ' + path.relative(ROOT, out));
  const windowOut = out.replace(/\.png$/, '-window.png');
  await writeFile(windowOut, Buffer.from(windowOverlay.split(',')[1], 'base64'));
  console.log('         ' + path.relative(ROOT, windowOut));

  if (options.write) {
    await writeFile(path.join(ROOT, GENERATED), stylesheet(sky, geometry, glass, options));
    console.log('Written  ' + GENERATED);
  } else {
    console.log('Skipped  ' + GENERATED + ' (--no-write)');
  }

  if (sky.disagreement > options.disagree) {
    console.error('\nThe plates read ' + sky.disagreement + '% of the picture differently AWAY FROM ANY EDGE, over the '
      + options.disagree + '% allowed. Disagreement along an edge is brushwork and is expected; this is not. They are lit'
      + ' differently and framed identically, so a figure this large means one of them has been repainted out of register'
      + ' with the others — or --factor is loose enough that a plate is finding sky in its own trees. Look at the overlay.');
    process.exitCode = 1;
  }
}

await main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
