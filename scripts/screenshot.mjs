// Capture the running dashboard the way the Fire TV sees it: headless Chrome
// driven over the DevTools protocol, 1280 x 720 by default, and optionally
// cropped to one element, with animations frozen or classes forced.
//
// Run with `npm run shot -- [options]`. Plain Node, no dependencies: Node 22's
// built-in WebSocket talks to Chrome directly. Works on Ubuntu, macOS and the
// GitHub runners, all of which have Chrome.
//
//   --url <url>            Page to capture. Default http://127.0.0.1:3000/
//   --scene <name>         Pin the rotating panel: transport, fact or map.
//   --fact <n>             Which daily fact, with --scene fact.
//   --demo                 Add ?weather=demo: no provider request is made and
//                          the forecast map draws a synthetic run, which is the
//                          only way to photograph its animation without buying
//                          a grid. Deterministic, so captures are comparable.
//   --offline              Add ?weather=off: no provider request is made, so
//                          the capture costs no quota. Use it for anything that
//                          is not about the weather (see docs/DEBUGGING.md).
//   --time <HH:MM>         Add ?time=: pin the clock to a Copenhagen time, so
//                          an outfit can be checked against chosen digits.
//   --pet <spot>           Add ?pet=: hold the Tenant at weather, week,
//                          transport, fact or map. Prefix with travel- to
//                          replay its safe-spot route before it holds.
//   --transit-demo         Add ?transit=demo: the departure boards are drawn
//                          from a synthetic answer holding a cancellation, a
//                          long delay, an early departure, a platform change
//                          and two service messages. No provider is asked. Use
//                          it for any capture of how a delay or an incident is
//                          marked: a live feed will not produce one to order.
//   --width, --height      Viewport in CSS pixels. Default 1280 x 720.
//   --scale <n>            Output pixels per CSS pixel. Default 1; 2 for detail.
//   --clip <selector>      Crop to the first element matching the selector.
//   --pad <px>             Margin kept around the clipped element, in CSS
//                          pixels. Default 4; more when parts overflow the
//                          box, as the Tenant's ears and leaf do.
//   --class <sel>=<names>  Force the element's whole class list, re-applied
//                          every 40 ms so React cannot undo it. Repeatable.
//                          Include the element's own class, or its styles go:
//                          --class ".clock-block=clock-block o-neon sp-domino"
//   --sequence <n>         Capture n frames from one page load instead of one,
//                          spaced --every apart, written as <name>-1.png and so
//                          on. One browser for the lot: a moving scene needs
//                          several moments to show anything, and starting a
//                          browser per moment is most of a minute each time.
//   --every <ms>           Spacing between --sequence frames. Default 700.
//   --freeze <ms>          Pause every CSS animation at this time.
//   --reduced-motion       Emulate prefers-reduced-motion: reduce.
//   --wait <ms>            Settle time after load. Default 4000.
//   --out <file>           Where to write. Default screenshots/<name>.png
//   --console              Print every console message the page logged.
//   --chrome <path>        Chrome binary. Also read from $CHROME_PATH.
//
// The dev server is not started here: `npm run dev` (or the preview) must be
// running, and the script waits up to 60 s for the URL to answer.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome, launchChrome, openPage, pageUrl, waitForServer } from './lib/browser.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const options = { classes: [], console: false, demo: false, offline: false, reducedMotion: false, transitDemo: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => { index += 1; return argv[index]; };
    const [flag, inline] = arg.includes('=') && arg.startsWith('--') && !arg.startsWith('--class') && !arg.startsWith('--url') ? arg.split(/=(.*)/s) : [arg, undefined];
    const value = () => inline ?? next();
    switch (flag) {
      case '--url': options.url = arg.includes('=') ? arg.slice('--url='.length) : next(); break;
      case '--scene': options.scene = value(); break;
      case '--fact': options.fact = value(); break;
      case '--offline': options.offline = true; break;
      case '--demo': options.demo = true; break;
      case '--transit-demo': options.transitDemo = true; break;
      case '--time': options.time = value(); break;
      case '--pet': options.pet = value(); break;
      case '--width': options.width = Number(value()); break;
      case '--height': options.height = Number(value()); break;
      case '--scale': options.scale = Number(value()); break;
      case '--clip': options.clip = value(); break;
      case '--pad': options.pad = Number(value()); break;
      case '--class': options.classes.push(arg.includes('=') && !arg.startsWith('--class=') ? arg.slice('--class'.length) : arg.startsWith('--class=') ? arg.slice('--class='.length) : next()); break;
      case '--sequence': options.sequence = Number(value()); break;
      case '--every': options.every = Number(value()); break;
      case '--freeze': options.freeze = Number(value()); break;
      case '--reduced-motion': options.reducedMotion = true; break;
      case '--wait': options.wait = Number(value()); break;
      case '--out': options.out = value(); break;
      case '--console': options.console = true; break;
      case '--chrome': options.chrome = value(); break;
      case '--help': case '-h': options.help = true; break;
      default: throw new Error('Unknown option ' + arg + '. See the header of scripts/screenshot.mjs.');
    }
  }
  return options;
}

function defaultName(options) {
  const parts = [options.scene ?? 'display'];
  if (options.reducedMotion) parts.push('reduced-motion');
  if (options.offline && !options.demo) parts.push('offline');
  if (options.demo) parts.push('demo');
  if (options.transitDemo) parts.push('transit-demo');
  if (options.pet) parts.push('pet-' + options.pet);
  return parts.join('-') + '.png';
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    const header = (await import('node:fs/promises')).readFile(fileURLToPath(import.meta.url), 'utf8');
    console.log((await header).split('\n').filter(line => line.startsWith('//')).map(line => line.slice(3)).join('\n'));
    return;
  }
  const width = options.width ?? 1280;
  const height = options.height ?? 720;
  const scale = options.scale ?? 1;
  const wait = options.wait ?? 4000;
  const url = pageUrl(options);
  const out = path.resolve(ROOT, options.out ?? path.join('screenshots', defaultName(options)));

  await waitForServer(url);
  const binary = findChrome(options.chrome);
  const { devtools, close } = await launchChrome(binary, width, height);
  try {
    const { send, logged } = await openPage(devtools, { url, width, height, reducedMotion: options.reducedMotion, wait });

    for (const spec of options.classes) {
      const [selector, names] = spec.split(/=(.*)/s);
      if (!selector || names === undefined) throw new Error('--class needs <selector>=<names>, got ' + spec);
      const { result } = await send('Runtime.evaluate', { expression: `(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element) return 'missing';
        const apply = () => { element.className = ${JSON.stringify(names)}; };
        apply();
        setInterval(apply, 40);
        return 'ok';
      })()` });
      if (result.value !== 'ok') throw new Error('--class: nothing matches ' + selector);
      await new Promise(resolve => setTimeout(resolve, 120));
    }
    if (options.freeze !== undefined) {
      await send('Runtime.evaluate', { expression: `document.getAnimations().forEach(animation => { animation.pause(); animation.currentTime = ${options.freeze}; })` });
      await new Promise(resolve => setTimeout(resolve, 60));
    }

    let clip;
    if (options.clip) {
      const { result } = await send('Runtime.evaluate', { expression: `(() => {
        const element = document.querySelector(${JSON.stringify(options.clip)});
        if (!element) return null;
        const box = element.getBoundingClientRect();
        return JSON.stringify({ x: box.left, y: box.top, width: box.width, height: box.height });
      })()` });
      if (!result.value) throw new Error('--clip: nothing matches ' + options.clip);
      const box = JSON.parse(result.value);
      const pad = Number.isFinite(options.pad) ? options.pad : 4;
      clip = { x: Math.max(0, Math.floor(box.x) - pad), y: Math.max(0, Math.floor(box.y) - pad), width: Math.ceil(box.width) + 2 * pad, height: Math.ceil(box.height) + 2 * pad, scale };
    } else {
      clip = { x: 0, y: 0, width, height, scale };
    }
    // One frame, or a strip of them from this same page load.
    const frames = Math.max(1, options.sequence ?? 1);
    const every = options.every ?? 700;
    await mkdir(path.dirname(out), { recursive: true });
    const written = [];
    for (let frame = 0; frame < frames; frame += 1) {
      if (frame) await new Promise(resolve => setTimeout(resolve, every));
      const { data } = await send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: false });
      const target = frames === 1 ? out : out.replace(/(\.png)$/, '-' + (frame + 1) + '$1');
      await writeFile(target, Buffer.from(data, 'base64'));
      written.push(target);
    }
    const problems = logged.filter(entry => ['warning', 'error', 'exception'].includes(entry.level));
    for (const target of written) console.log(path.relative(ROOT, target) + '  ' + clip.width * scale + 'x' + clip.height * scale + '  ' + url);
    if (problems.length) console.log(problems.length + ' console warning(s)/error(s)' + (options.console ? '' : ' (pass --console to see them)'));
    if (options.console) for (const entry of logged) console.log('  [' + entry.level + '] ' + entry.text);
  } finally {
    await close();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
