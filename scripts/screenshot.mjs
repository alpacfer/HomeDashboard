// Capture the running dashboard the way the Fire TV sees it: headless Chrome
// driven over the DevTools protocol, 1280 x 720 by default, and optionally
// cropped to one element, with animations frozen or posed, or classes forced.
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
//                          the capture costs no quota, and the card, ribbon and
//                          week strip are filled from lib/weather-demo.ts so
//                          the dashboard is still shown in context. Use it for
//                          anything that is not about the weather (see
//                          docs/DEBUGGING.md).
//   --dry                  Add ?weather=dry: the same synthetic run with no
//                          precipitation in it. That is the state the rotation
//                          skips the forecast map for, so with --scene map it
//                          is the only way to photograph the scene being
//                          skipped. Outranks --demo.
//   --no-weather           Add ?weather=none: no request and no placeholder
//                          either, which is how the genuinely unavailable card
//                          is photographed. Outranks --offline, --demo and --dry.
//   --time <HH:MM>         Add ?time=: pin the clock to a Copenhagen time, so
//                          the face can be checked against the digits that stress it.
//   --sky <state>          Add ?sky=: pin the clock's light, weather and rate,
//                          in any order (night,snow,heavy).
//   --pet <spot>           Add ?pet=: hold the Tenant at weather, week,
//                          transport, fact or map. Prefix with travel- to
//                          replay its safe-spot route before it holds.
//   --date <date>          Add ?date=: MM-DD shows that recurring calendar day;
//                          YYYY-MM-DD also enables an exact-date editorial
//                          edition, so it can be reviewed before going live.
//   --transit-demo         Add ?transit=demo: the departure boards are drawn
//                          from a synthetic answer holding a cancellation, a
//                          long delay, an early departure, a platform change
//                          and two service messages. No provider is asked. Use
//                          it for any capture of how a delay or an incident is
//                          marked: a live feed will not produce one to order.
//   --transit <state>      demo, or one of the three unhealthy boards:
//                          stale (dated four minutes back, amber stamp),
//                          expired (seven minutes, red stamp and blank
//                          boards) or down (the route refuses, "no data").
//                          The only way to photograph a board that is not
//                          fresh.
//   --width, --height      Viewport in CSS pixels. Default 1280 x 720.
//   --scale <n>            Output pixels per CSS pixel. Default 1; 2 for detail.
//   --clip <selector>      Crop to the first element matching the selector,
//                          measured after --class, --freeze and --pose have
//                          been applied, so a posed element is cropped where
//                          it is posed. A selector that matches nothing fails
//                          and names the nearest class names on the page.
//   --pad <px>             Margin kept around the clipped element, in CSS
//                          pixels. Default 4; more when parts overflow the
//                          box, as the Tenant's ears and leaf do.
//   --class <sel>=<names>  Force the element's whole class list, re-applied
//                          every 40 ms so React cannot undo it. Repeatable.
//                          Include the element's own class, or its styles go:
//                          --class ".tenant=tenant pose-perched on-round pa-slip"
//   --sequence <n>         Capture n frames from one page load instead of one,
//                          spaced --every apart, written as <name>-1.png and so
//                          on. One browser for the lot: a moving scene needs
//                          several moments to show anything.
//   --every <ms>           Spacing between --sequence frames. Default 700.
//   --freeze <ms>          Pause every CSS animation on the page at this point
//                          of the document timeline. Transitions are left
//                          alone: pausing one pins the state it was leaving,
//                          which drew a sleeping Tenant with open eyes. One
//                          time for the whole page: to place two animations of
//                          different periods, use --pose.
//   --pose <sel>=<phase>   Hold every animation on that element (and under it)
//                          at a phase of its own cycle: 7% of the iteration,
//                          or 350ms / 1.2s of active time. The animation's
//                          delay is zeroed first, so a negative delay cannot
//                          shift what the phase means. Repeatable, and applied
//                          after --freeze, so a page can be frozen and one
//                          element posed differently:
//                          --pose ".bird-flight=9.8%" --pose ".bird-wings=7%"
//   --reduced-motion       Emulate prefers-reduced-motion: reduce.
//   --wait <ms>            Settle time after load. Default 4000.
//   --out <file>           Where to write. Default screenshots/<name>.png,
//                          where the name is built from the flags.
//   --then                 Start another capture in the same browser. Flags
//                          after it are read on top of the flags before the
//                          first --then, so the base is written once:
//                          --offline --time 08:46 --clip .clock-block
//                            --then --sky night,clear
//                            --then --sky day,snow,heavy --out screenshots/snow.png
//                          Each group loads its own page; --out is per group
//                          and a default name that collides gets -2, -3.
//   --console              Print every console message the page logged.
//   --chrome <path>        Chrome binary. Also read from $CHROME_PATH.
//
// The dev server is not started here: `npm run dev` (or the preview) must be
// running. The script waits up to 60 s for a server that is listening but
// still compiling, and fails at once when nothing is listening at all.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  findChrome, launchChrome, noMatchMessage, openPage, pageUrl, parsePhase, printHelp, splitGroups, takeBrowserFlag, takeUrlFlag, waitForServer,
} from './lib/browser.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Flags whose value contains '=' and so must not be split on it.
const KEEP_WHOLE = ['--class', '--pose', '--url'];

function parseArgs(argv, seed) {
  const options = seed
    ? { ...seed, classes: [...seed.classes], poses: [...seed.poses], out: undefined }
    : { classes: [], poses: [], console: false, demo: false, dry: false, offline: false, reducedMotion: false, transit: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => { index += 1; return argv[index]; };
    // --class, --pose and --url carry '=' inside their value, so they are not
    // split on it: the flag is the name, and the value is the rest of the
    // argument or the next one.
    const whole = KEEP_WHOLE.find(name => arg.startsWith(name));
    const [flag, inline] = whole ? [whole, undefined] : arg.includes('=') && arg.startsWith('--') ? arg.split(/=(.*)/s) : [arg, undefined];
    const value = () => inline ?? next();
    const spec = name => arg.startsWith(name + '=') ? arg.slice(name.length + 1) : arg.length > name.length ? arg.slice(name.length) : next();
    switch (flag) {
      case '--scale': options.scale = Number(value()); break;
      case '--clip': options.clip = value(); break;
      case '--pad': options.pad = Number(value()); break;
      case '--class': options.classes.push(spec('--class')); break;
      case '--pose': options.poses.push(spec('--pose')); break;
      case '--sequence': options.sequence = Number(value()); break;
      case '--every': options.every = Number(value()); break;
      case '--freeze': options.freeze = Number(value()); break;
      case '--out': options.out = value(); break;
      default:
        if (takeBrowserFlag(flag, options, value) || takeUrlFlag(flag, options, value, arg)) break;
        throw new Error('Unknown option ' + arg + '. See the header of scripts/screenshot.mjs.');
    }
  }
  return options;
}

const slug = text => String(text).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();

function defaultName(options) {
  const parts = [options.scene ?? 'display'];
  if (options.reducedMotion) parts.push('reduced-motion');
  if (options.noWeather) parts.push('no-weather');
  else if (options.dry) parts.push('dry');
  else if (options.offline && !options.demo) parts.push('offline');
  else if (options.demo) parts.push('demo');
  if (options.transit) parts.push('transit-' + options.transit);
  if (options.pet) parts.push('pet-' + options.pet);
  if (options.sky) parts.push('sky-' + slug(options.sky));
  if (options.time) parts.push(slug(options.time));
  if (options.date) parts.push(slug(options.date));
  return parts.join('-') + '.png';
}

// Where each group writes. A default name that another group already took
// gets a counter, so two groups that differ only in --class or --pose do not
// overwrite each other silently.
function outputPaths(groups) {
  const taken = new Set();
  return groups.map(options => {
    let out = path.resolve(ROOT, options.out ?? path.join('screenshots', defaultName(options)));
    for (let counter = 2; taken.has(out); counter += 1) {
      out = out.replace(/(-\d+)?(\.png)$/, '-' + counter + '$2');
    }
    taken.add(out);
    return out;
  });
}

// Everything that runs against one page: force the classes, freeze, pose,
// then measure the crop and capture. In that order -- a crop measured before
// the pose captures where the element was, not where it is.
async function capture(devtools, options, out) {
  const width = options.width ?? 1280;
  const height = options.height ?? 720;
  const scale = options.scale ?? 1;
  const wait = options.wait ?? 4000;
  const url = pageUrl(options);
  const { send, evaluate, logged } = await openPage(devtools, { url, width, height, reducedMotion: options.reducedMotion, wait });

  for (const spec of options.classes) {
    const [selector, names] = spec.split(/=(.*)/s);
    if (!selector || names === undefined) throw new Error('--class needs <selector>=<names>, got ' + spec);
    const applied = await evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return 'missing';
      const apply = () => { element.className = ${JSON.stringify(names)}; };
      apply();
      setInterval(apply, 40);
      return 'ok';
    })()`);
    if (applied !== 'ok') throw new Error(await noMatchMessage(evaluate, '--class', selector));
    await new Promise(resolve => setTimeout(resolve, 120));
  }
  if (options.freeze !== undefined) {
    await evaluate(`document.getAnimations().forEach(animation => {
      if (animation instanceof CSSTransition) return;
      animation.pause(); animation.currentTime = ${options.freeze};
    })`);
    await new Promise(resolve => setTimeout(resolve, 60));
  }
  for (const spec of options.poses) {
    const [selector, phaseText] = spec.split(/=(.*)/s);
    if (!selector || phaseText === undefined) throw new Error('--pose needs <selector>=<phase>, got ' + spec);
    const phase = parsePhase(phaseText);
    const posed = await evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return 'missing';
      const animations = element.getAnimations({ subtree: true }).filter(animation => !(animation instanceof CSSTransition));
      if (!animations.length) return 'still';
      for (const animation of animations) {
        animation.pause();
        // Active time is currentTime minus delay, so with a negative delay
        // the timeline is not the progress. Zero it, and it is.
        const duration = Number(animation.effect.getComputedTiming().duration) || 0;
        animation.effect.updateTiming({ delay: 0 });
        animation.currentTime = ${phase.percent !== undefined ? `${phase.percent} / 100 * duration` : String(phase.ms)};
      }
      return 'ok:' + animations.length;
    })()`);
    if (posed === 'missing') throw new Error(await noMatchMessage(evaluate, '--pose', selector));
    if (posed === 'still') throw new Error('--pose: nothing on or under ' + selector + ' is animating right now, so there is no phase to hold. Is the element shown in this state?');
    await new Promise(resolve => setTimeout(resolve, 60));
  }

  let clip;
  if (options.clip) {
    const box = await evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(options.clip)});
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return { x: box.left, y: box.top, width: box.width, height: box.height };
    })()`);
    if (!box) throw new Error(await noMatchMessage(evaluate, '--clip', options.clip));
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
  await send('Page.close').catch(() => undefined);
}

async function main() {
  const [baseArgs, ...rest] = splitGroups(process.argv.slice(2));
  const base = parseArgs(baseArgs);
  if (base.help) { await printHelp(import.meta.url); return; }
  const groups = [base, ...rest.map(args => parseArgs(args, base))];
  const outs = outputPaths(groups);

  await waitForServer(pageUrl(base));
  const binary = findChrome(base.chrome);
  // One browser for every group. Starting one per capture was most of the
  // cost of photographing several states of one change.
  const { devtools, close } = await launchChrome(binary, base.width ?? 1280, base.height ?? 720);
  try {
    for (let index = 0; index < groups.length; index += 1) await capture(devtools, groups[index], outs[index]);
  } finally {
    await close();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
