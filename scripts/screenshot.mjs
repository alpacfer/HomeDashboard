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
//   --narrow               720 x 900, the max-aspect-ratio: 5/4 layout.
//   --width, --height      Viewport in CSS pixels. Default 1280 x 720.
//   --scale <n>            Output pixels per CSS pixel. Default 1; 2 for detail.
//   --clip <selector>      Crop to the first element matching the selector.
//   --class <sel>=<names>  Force the element's whole class list, re-applied
//                          every 40 ms so React cannot undo it. Repeatable.
//                          Include the element's own class, or its styles go:
//                          --class ".clock-block=clock-block o-neon sp-domino"
//   --freeze <ms>          Pause every CSS animation at this time.
//   --reduced-motion       Emulate prefers-reduced-motion: reduce.
//   --wait <ms>            Settle time after load. Default 4000.
//   --out <file>           Where to write. Default screenshots/<name>.png
//   --console              Print every console message the page logged.
//   --chrome <path>        Chrome binary. Also read from $CHROME_PATH.
//
// The dev server is not started here: `npm run dev` (or the preview) must be
// running, and the script waits up to 60 s for the URL to answer.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const options = { classes: [], console: false, demo: false, offline: false, narrow: false, reducedMotion: false };
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
      case '--time': options.time = value(); break;
      case '--narrow': options.narrow = true; break;
      case '--width': options.width = Number(value()); break;
      case '--height': options.height = Number(value()); break;
      case '--scale': options.scale = Number(value()); break;
      case '--clip': options.clip = value(); break;
      case '--class': options.classes.push(arg.includes('=') && !arg.startsWith('--class=') ? arg.slice('--class'.length) : arg.startsWith('--class=') ? arg.slice('--class='.length) : next()); break;
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

function findChrome(explicit) {
  const candidates = [
    explicit,
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ].filter(Boolean);
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  // Anything on PATH by these names.
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
      const full = path.join(dir, name);
      if (existsSync(full)) return full;
    }
  }
  throw new Error('No Chrome found. Install Google Chrome or pass --chrome <path> (or set CHROME_PATH).');
}

async function waitForServer(url, timeoutMs = 60_000) {
  const origin = new URL(url).origin;
  const deadline = Date.now() + timeoutMs;
  let lastError = 'no response';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(origin, { signal: AbortSignal.timeout(5_000) });
      if (response.status < 500) return;
      lastError = 'HTTP ' + response.status;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(origin + ' did not answer within ' + timeoutMs / 1000 + ' s (' + lastError + '). Start the dev server first: npm run dev');
}

// A minimal DevTools client: one WebSocket to the browser, flat sessions.
class Devtools {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = [];
    socket.addEventListener('message', event => {
      const message = JSON.parse(typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString());
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message + (message.error.data ? ': ' + message.error.data : '')));
        else resolve(message.result);
      } else if (message.method) {
        for (const listener of this.listeners) listener(message);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(method + ' timed out')); }
      }, 30_000);
    });
  }
  once(method, sessionId, timeoutMs = 30_000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.listeners = this.listeners.filter(l => l !== listener); reject(new Error('Timed out waiting for ' + method)); }, timeoutMs);
      const listener = message => {
        if (message.method === method && (!sessionId || message.sessionId === sessionId)) {
          clearTimeout(timer);
          this.listeners = this.listeners.filter(l => l !== listener);
          resolve(message.params);
        }
      };
      this.listeners.push(listener);
    });
  }
  on(listener) { this.listeners.push(listener); }
}

async function launchChrome(binary, width, height) {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'homedashboard-shot-'));
  const child = spawn(binary, [
    '--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
    '--force-device-scale-factor=1', '--window-size=' + width + ',' + height, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = await new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error('Chrome did not expose DevTools within 20 s:\n' + buffer)), 20_000);
    child.stderr.on('data', chunk => {
      buffer += chunk;
      const match = buffer.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    child.on('exit', code => { clearTimeout(timer); reject(new Error('Chrome exited with code ' + code + ':\n' + buffer)); });
  });
  const socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', () => reject(new Error('Could not connect to ' + endpoint)), { once: true }); });
  const close = async () => {
    try { socket.close(); } catch { /* already closed */ }
    // Wait for Chrome to exit before removing its profile: it is still
    // writing to it, and removing a directory under it fails with ENOTEMPTY.
    const exited = new Promise(resolve => { child.once('exit', resolve); setTimeout(resolve, 5_000); });
    child.kill();
    await exited;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try { await rm(profile, { recursive: true, force: true }); break; } catch { await new Promise(resolve => setTimeout(resolve, 200)); }
    }
  };
  return { devtools: new Devtools(socket), close };
}

function pageUrl(options) {
  const url = new URL(options.url ?? 'http://127.0.0.1:3000/');
  if (options.scene) url.searchParams.set('scene', options.scene);
  if (options.fact !== undefined) url.searchParams.set('fact', String(options.fact));
  if (options.offline) url.searchParams.set('weather', 'off');
  // The demo run is a kind of offline, and wins when both are asked for: it
  // makes no request either, and it has something to draw.
  if (options.demo) url.searchParams.set('weather', 'demo');
  if (options.time) url.searchParams.set('time', options.time);
  return url.toString();
}

function defaultName(options) {
  const parts = [options.scene ?? 'display'];
  if (options.narrow) parts.push('narrow');
  if (options.reducedMotion) parts.push('reduced-motion');
  if (options.offline && !options.demo) parts.push('offline');
  if (options.demo) parts.push('demo');
  return parts.join('-') + '.png';
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    const header = (await import('node:fs/promises')).readFile(fileURLToPath(import.meta.url), 'utf8');
    console.log((await header).split('\n').filter(line => line.startsWith('//')).map(line => line.slice(3)).join('\n'));
    return;
  }
  const width = options.width ?? (options.narrow ? 720 : 1280);
  const height = options.height ?? (options.narrow ? 900 : 720);
  const scale = options.scale ?? 1;
  const wait = options.wait ?? 4000;
  const url = pageUrl(options);
  const out = path.resolve(ROOT, options.out ?? path.join('screenshots', defaultName(options)));

  await waitForServer(url);
  const binary = findChrome(options.chrome);
  const { devtools, close } = await launchChrome(binary, width, height);
  const logged = [];
  try {
    const { targetId } = await devtools.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await devtools.send('Target.attachToTarget', { targetId, flatten: true });
    const send = (method, params) => devtools.send(method, params, sessionId);
    devtools.on(message => {
      if (message.sessionId !== sessionId) return;
      if (message.method === 'Runtime.consoleAPICalled') logged.push({ level: message.params.type, text: message.params.args.map(arg => arg.value ?? arg.description ?? '').join(' ') });
      if (message.method === 'Runtime.exceptionThrown') logged.push({ level: 'exception', text: message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text });
      if (message.method === 'Log.entryAdded') logged.push({ level: message.params.entry.level, text: message.params.entry.text + (message.params.entry.url ? ' (' + message.params.entry.url + ')' : '') });
    });
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Log.enable');
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    if (options.reducedMotion) await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    const loaded = devtools.once('Page.loadEventFired', sessionId);
    await send('Page.navigate', { url });
    await loaded;
    await send('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => true)', awaitPromise: true });
    await new Promise(resolve => setTimeout(resolve, wait));

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
      clip = { x: Math.max(0, Math.floor(box.x) - 4), y: Math.max(0, Math.floor(box.y) - 4), width: Math.ceil(box.width) + 8, height: Math.ceil(box.height) + 8, scale };
    } else {
      clip = { x: 0, y: 0, width, height, scale };
    }
    const { data } = await send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: false });
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, Buffer.from(data, 'base64'));
    const problems = logged.filter(entry => ['warning', 'error', 'exception'].includes(entry.level));
    console.log(path.relative(ROOT, out) + '  ' + clip.width * scale + 'x' + clip.height * scale + '  ' + url);
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
