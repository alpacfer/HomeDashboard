// The digit roll, caught in the act.
//
// WHY THIS EXISTS
// The clock's transition happens on the minute boundary and lasts under a
// second, and nothing else on the display is like that: every other moving
// thing can be pinned, frozen or replayed on demand. `--sequence` on
// `npm run shot` captures a strip from one page load but starts whenever the
// browser is ready, so catching a 945 ms roll in a 60 s window is luck. The
// theme has three transitions — a breeze in fair weather, a wash in rain, a
// slower one in snow — and all three shipped once without anyone having seen
// them move.
//
// The trick is that `?time=` shifts the clock by whole minutes and keeps the
// seconds, so the boundary is always at :00 of the real clock. This waits for
// the page's own clock to reach :58.7 and then captures a fast strip across
// the boundary, which lands eight or nine frames inside the roll.
//
//   npm run roll                          the breeze, at dusk
//   npm run roll -- --sky day,rain,heavy  the wash, and the faster pace
//   npm run roll -- --sky day,snow,light  the slow one
//   npm run roll -- --clip .clock-widget  the whole card rather than the block
//
// Writes screenshots/clock-roll.png. Costs no provider quota: the page is
// always loaded with `?weather=off`.

import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome, launchChrome, openPage, pageUrl, waitForServer } from './lib/browser.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FRAMES_DIR = path.join(ROOT, 'screenshots', '.roll-frames');
// 20 frames 120 ms apart is 2.4 s of wall clock, and the capture itself costs
// a little on top, so the strip comfortably brackets a boundary entered at
// :58.7. The roll is 840 ms plus 105 ms of stagger.
const FRAMES = 20, EVERY = 120, ENTER_AT = 58.7;

function parseArgs(argv) {
  const options = { sky: 'dusk,clear', clip: '.clock-block', out: 'clock-roll.png', pad: 2 };
  for (let index = 0; index < argv.length; index += 1) {
    const next = () => { index += 1; return argv[index]; };
    switch (argv[index]) {
      case '--sky': options.sky = next(); break;
      case '--clip': options.clip = next(); break;
      case '--out': options.out = next(); break;
      case '--pad': options.pad = Number(next()); break;
      case '--frames': options.frames = Number(next()); break;
      case '--every': options.every = Number(next()); break;
      case '--help': case '-h': options.help = true; break;
      default: throw new Error('Unknown flag ' + argv[index]);
    }
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  console.log(await import('node:fs').then(fs => fs.readFileSync(new URL(import.meta.url), 'utf8')
    .split('\n').filter(line => line.startsWith('//')).map(line => line.slice(3)).join('\n')));
  process.exit(0);
}

const frames = options.frames ?? FRAMES;
const every = options.every ?? EVERY;
const url = pageUrl({ offline: true, sky: options.sky });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

await waitForServer(url);
await rm(FRAMES_DIR, { recursive: true, force: true });
await mkdir(FRAMES_DIR, { recursive: true });
const { devtools, close } = await launchChrome(findChrome(), 1280, 720);
try {
  const page = await openPage(devtools, { url, width: 1280, height: 720, wait: 3000 });
  const box = JSON.parse(await page.evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(options.clip)});
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    return JSON.stringify({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
  })()`) ?? 'null');
  if (!box) throw new Error('--clip: nothing matches ' + options.clip);
  const clip = {
    x: Math.max(0, Math.floor(box.x) - options.pad), y: Math.max(0, Math.floor(box.y) - options.pad),
    width: Math.ceil(box.width) + 2 * options.pad, height: Math.ceil(box.height) + 2 * options.pad, scale: 1,
  };

  // Wait for the page's own clock, not this process's: `?time=` shifts by whole
  // minutes and keeps the seconds, so the two agree about where :00 is, and
  // asking the page costs one round trip against a boundary we have seconds to
  // spare before.
  process.stdout.write('waiting for the minute');
  for (;;) {
    const seconds = Number(await page.evaluate('new Date().getSeconds() + new Date().getMilliseconds() / 1000'));
    if (seconds >= ENTER_AT) break;
    process.stdout.write('.');
    await sleep(Math.max(30, Math.min(700, (ENTER_AT - seconds) * 1000)));
  }
  console.log('');

  const captured = [];
  for (let frame = 0; frame < frames; frame += 1) {
    const { data } = await page.send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: false });
    const file = path.join(FRAMES_DIR, String(frame).padStart(2, '0') + '.png');
    await writeFile(file, Buffer.from(data, 'base64'));
    captured.push({ file, ms: frame * every });
    await sleep(every);
  }

  const sheet = path.join(FRAMES_DIR, 'strip.html');
  await writeFile(sheet, `<!doctype html><meta charset="utf-8"><style>
    body { margin:0; padding:20px 22px 24px; background:#111113; color:#a6a6b0; font:11px/1.3 ui-sans-serif,system-ui,sans-serif; }
    h1 { color:#f3f2ee; font-size:15px; font-weight:600; margin:0 0 3px; }
    p { margin:0 0 14px; color:#75757f; }
    .strip { display:grid; grid-template-columns:repeat(5,1fr); gap:9px; }
    figure { margin:0; } img { display:block; width:100%; border-radius:4px; }
    figcaption { margin-top:4px; letter-spacing:.06em; }
  </style>
  <h1>The minute changing — ${options.sky}</h1>
  <p>${frames} frames, ${every} ms apart, captured across the boundary. The roll is 840 ms plus 105 ms of stagger from the right.</p>
  <div class="strip">${captured.map(frame =>
    `<figure><img src="file://${frame.file}"><figcaption>+${frame.ms} ms</figcaption></figure>`).join('')}</div>`);

  await page.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false });
  const loaded = devtools.once('Page.loadEventFired', page.sessionId);
  await page.send('Page.navigate', { url: 'file://' + sheet });
  await loaded;
  await sleep(700);
  const size = JSON.parse(await page.evaluate('JSON.stringify({ w: document.body.scrollWidth, h: document.body.scrollHeight })'));
  const { data } = await page.send('Page.captureScreenshot', {
    format: 'png', clip: { x: 0, y: 0, width: size.w, height: size.h, scale: 1 }, captureBeyondViewport: true,
  });
  const out = path.join(ROOT, 'screenshots', options.out);
  await writeFile(out, Buffer.from(data, 'base64'));
  console.log(path.relative(ROOT, out) + '  ' + size.w + 'x' + size.h + '  ' + url);
} finally {
  await close();
}
