// Driving a real Chrome from Node, shared by the tools that need one.
//
// `scripts/screenshot.mjs` captures what a moment looks like and
// `scripts/measure-motion.mjs` measures what an animation does over time, and
// both need the same three things: find Chrome, wait for the dev server, and
// talk DevTools to a page. That plumbing lives here so neither script owns it.
//
// Plain Node, no dependencies: Node 22's built-in WebSocket talks to Chrome
// directly. Works on Ubuntu, macOS and the GitHub runners.
//
// Headless Chrome renders, so `requestAnimationFrame` fires and
// `document.visibilityState` is `visible`. That is the whole reason these
// tools exist rather than the editor's browser pane, which is hidden: a hidden
// page runs no animation frames at all, so the forecast map never even
// measures itself and sits on "Loading forecast…" for ever. See
// docs/DEBUGGING.md.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export function findChrome(explicit) {
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

export async function waitForServer(url, timeoutMs = 60_000) {
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
export class Devtools {
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
  send(method, params = {}, sessionId, timeoutMs = 30_000) {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(method + ' timed out')); }
      }, timeoutMs);
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

export async function launchChrome(binary, width, height) {
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

// The debug flags that go into the page URL. Each script parses its own
// arguments, but they must agree about what the flags mean, so the URL is
// built in one place. See lib/debug-flags.ts and lib/panel-rotation.ts.
//
// Both tools must accept every one of these, or capturing a scene and
// measuring "the same" scene quietly differ. That drift is not hypothetical:
// extracting this function dropped --transit-demo from the URL while both
// scripts still advertised it. scripts/check-rules.mjs enforces the list.
export const URL_FLAGS = ['--url', '--scene', '--fact', '--offline', '--demo', '--no-weather', '--transit-demo', '--time', '--pet', '--date', '--sky'];

export function pageUrl(options) {
  const url = new URL(options.url ?? 'http://127.0.0.1:3000/');
  if (options.scene) url.searchParams.set('scene', options.scene);
  if (options.fact !== undefined) url.searchParams.set('fact', String(options.fact));
  if (options.offline) url.searchParams.set('weather', 'off');
  // The demo run is a kind of offline, and wins when both are asked for: it
  // makes no request either, and it has something to draw.
  if (options.demo) url.searchParams.set('weather', 'demo');
  // And the empty card outranks both: it is the one state a placeholder hides.
  if (options.noWeather) url.searchParams.set('weather', 'none');
  if (options.transitDemo) url.searchParams.set('transit', 'demo');
  if (options.time) url.searchParams.set('time', options.time);
  if (options.pet) url.searchParams.set('pet', options.pet);
  if (options.date) url.searchParams.set('date', options.date);
  // The clock theme's sky: any of its light phase, weather and rate, in any
  // order (`dusk,snow,heavy`). Without it the card draws the real sky, which
  // is whatever the forecast says today and so cannot be captured to order.
  if (options.sky) url.searchParams.set('sky', options.sky);
  return url.toString();
}

// Open a page and wait for it to settle: one tab, the domains both tools need,
// the emulated viewport, then navigate, wait for load, for fonts, and for the
// caller's settle time. Everything the page logs is collected into `logged`.
export async function openPage(devtools, { url, width, height, reducedMotion = false, wait = 4000 }) {
  const { targetId } = await devtools.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await devtools.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params, timeoutMs) => devtools.send(method, params, sessionId, timeoutMs);
  const logged = [];
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
  if (reducedMotion) await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  const loaded = devtools.once('Page.loadEventFired', sessionId);
  await send('Page.navigate', { url });
  await loaded;
  await send('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => true)', awaitPromise: true });
  await new Promise(resolve => setTimeout(resolve, wait));

  // Evaluate in the page and hand back the value, with a page-side throw
  // reported as one rather than as a silent undefined.
  const evaluate = async (expression, timeoutMs) => {
    const { result, exceptionDetails } = await send('Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true }, timeoutMs);
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  };
  return { sessionId, send, evaluate, logged };
}
