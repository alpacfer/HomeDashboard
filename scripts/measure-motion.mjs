// Measure what an animation actually does over time, which a screenshot cannot.
//
// `npm run shot` proves what one moment looks like. Nothing proved what the
// forecast map did between moments, and a flicker shipped through a green
// check, a passing suite and three screenshots that each looked correct. This
// is the missing half: load a scene in a real rendering browser, watch a canvas
// for a few seconds, and report both how evenly it is painted and whether what
// it draws reads as movement or as twitching.
//
// Run with `npm run motion -- [options]`. The dev server must be running, the
// same as for `npm run shot`.
//
//   --scene <name>         Pin the rotating panel: transport, fact or map.
//   --demo                 ?weather=demo: the synthetic forecast run, which is
//                          how the map is watched without spending quota.
//   --offline              ?weather=off: no provider request at all.
//   --transit-demo         ?transit=demo: synthetic departure boards.
//   --time <HH:MM>         Pin the clock to a Copenhagen time.
//   --pet <spot>           Hold the Tenant at a dashboard landmark.
//   --url <url>            Page to load. Default http://127.0.0.1:3000/
//   --fact <n>             Which daily fact, with --scene fact.
//   --selector <css>       Canvas or moving element to watch. Default
//                          .forecast-map-overlay
//   --seconds <n>          How long to watch. Default 4.
//   --samples <n>          Content samples a second. Default 12.
//   --width, --height      Viewport in CSS pixels. Default 1280 x 720.
//   --reduced-motion       Emulate prefers-reduced-motion: reduce.
//   --wait <ms>            Settle time after load. Default 4000.
//   --console              Print everything the page logged.
//   --chrome <path>        Chrome binary. Also read from $CHROME_PATH.
//
// Two numbers matter, and they answer different questions.
//
// **Cadence** counts the 2D draw calls the page makes to that canvas. Uneven
// gaps mean the loop is bunching, which is what a timer driving a React render
// does whenever the page is busy, and is what "not smooth" looks like even
// when every frame is correct.
//
// **Reversals** count how often a pixel changes direction: brightening, then
// darkening, then brightening again. Rain crossing a cell brightens it once
// and dims it once, so about one reversal per pixel over a pass is exactly
// right. Many more means a value sitting on a threshold and twitching across
// it, which is the flicker four hard colour bands used to cause: 191 of 345
// cells crossed a band and crossed back inside one pass.
//
// For a moving element, the report also verifies that every position-changing
// frame belongs to the Tenant's charge/parabola pipeline (or to a fall).

import { fileURLToPath } from 'node:url';
import { findChrome, launchChrome, openPage, pageUrl, waitForServer } from './lib/browser.mjs';

// Where "a thing crossing the frame" stops being a plausible reading of this
// number. Both ends were measured on the forecast map over four seconds: the
// continuous colour ramp scores 0.38, and putting the four hard colour bands
// back scores 2.38, so the alarm sits between them with room either side.
// Raise it for a scene that legitimately has several things crossing at once.
const FLICKER_REVERSALS = 1.5;

function parseArgs(argv) {
  const options = { console: false, demo: false, offline: false, reducedMotion: false, transitDemo: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => { index += 1; return argv[index]; };
    const [flag, inline] = arg.includes('=') && arg.startsWith('--') && !arg.startsWith('--url') ? arg.split(/=(.*)/s) : [arg, undefined];
    const value = () => inline ?? next();
    switch (flag) {
      // These must mean the same as they do in scripts/screenshot.mjs;
      // the URL they build is shared, in scripts/lib/browser.mjs.
      case '--url': options.url = arg.includes('=') ? arg.slice('--url='.length) : next(); break;
      case '--scene': options.scene = value(); break;
      case '--fact': options.fact = value(); break;
      case '--offline': options.offline = true; break;
      case '--demo': options.demo = true; break;
      case '--transit-demo': options.transitDemo = true; break;
      case '--time': options.time = value(); break;
      case '--pet': options.pet = value(); break;
      case '--selector': options.selector = value(); break;
      case '--seconds': options.seconds = Number(value()); break;
      case '--samples': options.samples = Number(value()); break;
      case '--width': options.width = Number(value()); break;
      case '--height': options.height = Number(value()); break;
      case '--reduced-motion': options.reducedMotion = true; break;
      case '--wait': options.wait = Number(value()); break;
      case '--console': options.console = true; break;
      case '--chrome': options.chrome = value(); break;
      case '--help': case '-h': options.help = true; break;
      default: throw new Error('Unknown option ' + arg + '. See the header of scripts/measure-motion.mjs.');
    }
  }
  return options;
}

// Watch one canvas or compositor-moved element from inside the page. Canvas
// cadence comes from draw calls; an element is sampled on animation frames so
// a Tenant route can be checked with the same command.
function watcher(selector, seconds, samples) {
  return `(async () => {
  const canvas = document.querySelector(${JSON.stringify(selector)});
  if (!canvas) return { error: 'nothing matches ' + ${JSON.stringify(selector)} };
  if (!canvas.getContext) {
    const frames = [];
    const until = performance.now() + ${seconds} * 1000;
    while (performance.now() < until) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      const box = canvas.getBoundingClientRect();
      frames.push({ at: performance.now(), x: box.left, y: box.top, pose: canvas.className });
    }
    const gaps = frames.slice(1).map((frame, index) => frame.at - frames[index].at).sort((a, b) => a - b);
    const quantile = at => gaps.length ? gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * at))] : 0;
    let distance = 0, moving = 0, jumps = 0, charges = 0, outsidePipeline = 0;
    for (let index = 1; index < frames.length; index += 1) {
      const step = Math.hypot(frames[index].x - frames[index - 1].x, frames[index].y - frames[index - 1].y);
      distance += step;
      if (step > 0.1) {
        moving += 1;
        const poses = String(frames[index - 1].pose) + ' ' + String(frames[index].pose);
        // Falling is the one intentional exception: it is external physics,
        // not locomotion. Every other root-position change must be a charge or
        // a sampled parabola.
        if (!/pose-(charging|jumping|falling)/.test(poses)) outsidePipeline += 1;
      }
      if (!String(frames[index - 1].pose).includes('pose-jumping') && String(frames[index].pose).includes('pose-jumping')) jumps += 1;
      if (!String(frames[index - 1].pose).includes('pose-charging') && String(frames[index].pose).includes('pose-charging')) charges += 1;
    }
    return {
      kind: 'element', frames: frames.length, moving, distance, jumps, charges, outsidePipeline,
      seconds: frames.length > 1 ? (frames[frames.length - 1].at - frames[0].at) / 1000 : 0,
      gap: { min: quantile(0), median: quantile(0.5), p90: quantile(0.9), max: gaps.length ? gaps[gaps.length - 1] : 0 },
    };
  }
  const proto = CanvasRenderingContext2D.prototype;
  const originals = { drawImage: proto.drawImage, putImageData: proto.putImageData };
  const stamps = [];
  for (const name of Object.keys(originals)) {
    proto[name] = function (...args) {
      if (this.canvas === canvas) stamps.push(performance.now());
      return originals[name].apply(this, args);
    };
  }
  const WIDE = 48, HIGH = 27;
  const scratch = document.createElement('canvas');
  scratch.width = WIDE; scratch.height = HIGH;
  const scratchContext = scratch.getContext('2d', { willReadFrequently: true });
  const shots = [];
  const every = 1000 / ${samples};
  const until = performance.now() + ${seconds} * 1000;
  while (performance.now() < until) {
    await new Promise(resolve => setTimeout(resolve, every));
    if (!canvas.width || !canvas.height) continue;
    scratchContext.clearRect(0, 0, WIDE, HIGH);
    scratchContext.drawImage(canvas, 0, 0, WIDE, HIGH);
    shots.push(scratchContext.getImageData(0, 0, WIDE, HIGH).data);
  }
  for (const name of Object.keys(originals)) proto[name] = originals[name];

  const gaps = stamps.slice(1).map((at, index) => at - stamps[index]).sort((a, b) => a - b);
  const quantile = at => gaps.length ? gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * at))] : 0;
  // Alpha carries the overlay's intensity as much as colour does, so a pixel's
  // brightness is measured over the composite rather than over RGB alone.
  const brightness = (shot, pixel) => {
    const at = pixel * 4;
    return (shot[at] * 0.299 + shot[at + 1] * 0.587 + shot[at + 2] * 0.114) * (shot[at + 3] / 255);
  };
  let reversals = 0, moved = 0, steps = 0, worst = 0;
  const pixels = WIDE * HIGH;
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    let direction = 0;
    for (let shot = 1; shot < shots.length; shot += 1) {
      const change = brightness(shots[shot], pixel) - brightness(shots[shot - 1], pixel);
      moved += Math.abs(change);
      steps += 1;
      worst = Math.max(worst, Math.abs(change));
      // Below this a change is rounding, not something anybody sees.
      if (Math.abs(change) < 1) continue;
      const now = Math.sign(change);
      if (direction && now !== direction) reversals += 1;
      direction = now;
    }
  }
  return {
    paints: stamps.length,
    seconds: stamps.length > 1 ? (stamps[stamps.length - 1] - stamps[0]) / 1000 : 0,
    gap: { min: quantile(0), median: quantile(0.5), p90: quantile(0.9), max: gaps.length ? gaps[gaps.length - 1] : 0 },
    shots: shots.length,
    meanChange: steps ? moved / steps : 0,
    worstChange: worst,
    reversalsPerPixel: reversals / pixels,
  };
})()`;
}

function bar(label, value) {
  return '  ' + label.padEnd(24) + value;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    const source = await (await import('node:fs/promises')).readFile(fileURLToPath(import.meta.url), 'utf8');
    console.log(source.split('\n').filter(line => line.startsWith('//')).map(line => line.slice(3)).join('\n'));
    return;
  }
  const width = options.width ?? 1280;
  const height = options.height ?? 720;
  const seconds = options.seconds ?? 4;
  const samples = options.samples ?? 12;
  const selector = options.selector ?? '.forecast-map-overlay';
  const url = pageUrl(options);

  await waitForServer(url);
  const { devtools, close } = await launchChrome(findChrome(options.chrome), width, height);
  try {
    const { evaluate, logged } = await openPage(devtools, { url, width, height, reducedMotion: options.reducedMotion, wait: options.wait ?? 4000 });
    // A page that never became visible would report nothing and look like a
    // broken animation, so say so rather than printing zeroes.
    const state = await evaluate(`({ visibility: document.visibilityState, message: (document.querySelector('.forecast-map-message') || {}).textContent || null })`);
    const measured = await evaluate(watcher(selector, seconds, samples), (seconds + 20) * 1000);
    if (measured.error) throw new Error('--selector: ' + measured.error);

    console.log(selector + '  ' + width + 'x' + height + '  ' + url);
    if (measured.kind !== 'element' && state.message) console.log('  the panel is showing "' + state.message.trim() + '", so there may be nothing to measure');
    console.log('');
    if (measured.kind === 'element') {
      const fps = measured.frames > 1 ? (measured.frames - 1) / measured.seconds : 0;
      console.log(bar('animation frames', measured.frames + '  (' + fps.toFixed(1) + ' a second)'));
      console.log(bar('gap between frames', ['min', 'median', 'p90', 'max']
        .map(key => measured.gap[key].toFixed(1)).join(' / ') + ' ms   (min / median / p90 / max)'));
      console.log(bar('moving frames', measured.moving));
      console.log(bar('path sampled', measured.distance.toFixed(1) + ' px'));
      console.log(bar('charge / jump starts', measured.charges + ' / ' + measured.jumps));
      console.log(bar('movement outside jumps', measured.outsidePipeline));
      const evenness = measured.gap.median > 0 ? measured.gap.max / measured.gap.median : 0;
      console.log('');
      console.log(measured.outsidePipeline > 0
        ? '  NON-JUMP MOVEMENT. The Tenant changed position outside charge, parabola, or fall poses.'
        : measured.jumps < 1
        ? '  No jump began during the measurement window.'
        : evenness > 2
          ? '  Movement sampled, but its worst frame gap was ' + evenness.toFixed(1) + ' times the median.'
          : '  Jump movement is evenly paced.');
      const problems = logged.filter(entry => ['warning', 'error', 'exception'].includes(entry.level));
      if (problems.length) console.log('\n' + problems.length + ' console warning(s)/error(s)' + (options.console ? '' : ' (pass --console to see them)'));
      if (options.console) for (const entry of logged) console.log('  [' + entry.level + '] ' + entry.text);
      if (measured.jumps < 1 || measured.outsidePipeline > 0) process.exitCode = 1;
      return;
    }
    if (measured.paints < 2) {
      console.log('  no painting at all in ' + seconds + ' s.');
      console.log('  If the page is hidden its animation frames never run; visibility is ' + state.visibility + '.');
    } else {
      const fps = (measured.paints - 1) / measured.seconds;
      console.log(bar('paints', measured.paints + '  (' + fps.toFixed(1) + ' a second)'));
      console.log(bar('gap between paints', ['min', 'median', 'p90', 'max']
        .map(key => measured.gap[key].toFixed(1)).join(' / ') + ' ms   (min / median / p90 / max)'));
      const evenness = measured.gap.median > 0 ? measured.gap.max / measured.gap.median : 0;
      console.log(bar('', evenness > 2
        ? 'bunching: the worst gap is ' + evenness.toFixed(1) + ' times the median'
        : 'evenly paced'));
    }
    console.log('');
    console.log(bar('content samples', measured.shots + '  (' + samples + ' a second)'));
    console.log(bar('change per sample', measured.meanChange.toFixed(2) + ' of 255 mean, ' + measured.worstChange.toFixed(0) + ' worst'));
    console.log(bar('reversals per pixel', measured.reversalsPerPixel.toFixed(2)));
    console.log('');
    // With nothing painted there is nothing to judge, and a verdict on an
    // empty measurement reads as a pass when it is really a no-op.
    const flickering = measured.paints > 1 && measured.reversalsPerPixel > FLICKER_REVERSALS;
    console.log(measured.paints < 2
      ? '  Nothing was drawn, so there is nothing to judge. Either the scene has\n'
        + '  finished its passes, or nothing on it moves.'
      : flickering
      ? '  FLICKER. A pixel changing direction this often is a value sitting on a\n'
        + '  threshold and twitching across it, not something crossing the frame.'
      : '  Reads as motion. One thing arriving and leaving scores about 1; over '
        + FLICKER_REVERSALS + '\n  would be a value twitching across a threshold.');
    const problems = logged.filter(entry => ['warning', 'error', 'exception'].includes(entry.level));
    if (problems.length) console.log('\n' + problems.length + ' console warning(s)/error(s)' + (options.console ? '' : ' (pass --console to see them)'));
    if (options.console) for (const entry of logged) console.log('  [' + entry.level + '] ' + entry.text);
    // A detector that only ever narrates is one nobody can script against.
    if (flickering) process.exitCode = 1;
  } finally {
    await close();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
