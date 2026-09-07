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

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

// Wait for the dev server, but not for one that is not there. A server that
// is listening and still compiling gets the full minute; a port with nothing
// on it is refused instantly, and waiting a minute to say so is the single
// slowest way a capture can fail. Three seconds of refusal covers the gap
// between `next dev` being launched and it binding the port.
export async function waitForServer(url, timeoutMs = 60_000) {
  const origin = new URL(url).origin;
  const started = Date.now();
  const deadline = started + timeoutMs;
  let lastError = 'no response';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(origin, { signal: AbortSignal.timeout(5_000) });
      if (response.status < 500) return;
      lastError = 'HTTP ' + response.status;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      const code = error?.cause?.code ?? error?.code;
      if (code === 'ECONNREFUSED' && Date.now() - started > 3_000) {
        throw new Error('Nothing is listening at ' + origin + ' (connection refused). Start the dev server with the'
          + ' preview tool (or npm run dev); if another session already runs one on another port, pass --url.');
      }
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
      // The timer is cleared when the answer arrives. It was not, once: every
      // command left a live 30 s timer behind, Node's event loop waited for the
      // last of them, and every tool here sat for half a minute after its
      // work was done -- a 5 s screenshot took 35 s and a loop of five blew
      // the Bash budget. Measured 7 Sep 2026.
      const timer = setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(method + ' timed out')); }
      }, timeoutMs);
      this.pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); },
      });
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

const PROFILE_PREFIX = 'homedashboard-shot-';
const OWNER_FILE = 'owner.json';

const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };

// Every process on this machine whose command line names one of our profile
// directories: the browser and all of its helpers. `ps` is the one portable
// answer on Ubuntu and macOS, and this is best-effort, so a platform without
// it just reports nothing.
function chromeProcessesUsing(profile) {
  try {
    const listing = spawnSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' });
    if (listing.status !== 0) return [];
    // The browser names the profile as --user-data-dir; its crash handler
    // names a database inside it. Both are ours.
    return listing.stdout.split('\n')
      .filter(line => line.includes(profile + '/') || line.includes('--user-data-dir=' + profile))
      .map(line => Number(line.trim().split(/\s+/)[0]))
      .filter(Number.isInteger);
  } catch { return []; }
}

// Remove what an earlier run left behind. A tool that is killed before its
// `close()` runs -- a Bash timeout, a Ctrl-C, a session that ended -- leaves
// its Chrome alive and its profile on disk, and Chrome does not die with its
// parent. Found 79 such processes and 1.7 GB of profiles from one week of
// sessions. Each run writes owner.json naming its own Node process; a profile
// whose owner is gone is stale, and so is a legacy one with no owner file
// whose Chrome has been orphaned to init. A profile whose owner is still
// running belongs to another tool mid-capture and is left alone.
export async function sweepStaleProfiles() {
  const swept = [];
  let entries;
  try { entries = await readdir(os.tmpdir()); } catch { return swept; }
  for (const name of entries) {
    if (!name.startsWith(PROFILE_PREFIX)) continue;
    const profile = path.join(os.tmpdir(), name);
    try {
      let stale = false;
      try {
        const owner = JSON.parse(await readFile(path.join(profile, OWNER_FILE), 'utf8'));
        stale = !alive(owner.node);
      } catch {
        // No owner file: written by an earlier version of this helper. Stale
        // if no Chrome uses it, or if the one that does has lost its parent.
        const users = chromeProcessesUsing(profile);
        if (!users.length) stale = true;
        else {
          const parents = spawnSync('ps', ['-o', 'ppid=', '-p', String(users[0])], { encoding: 'utf8' }).stdout.trim();
          const parentArgs = parents ? spawnSync('ps', ['-o', 'args=', '-p', parents], { encoding: 'utf8' }).stdout : '';
          stale = !/\bnode\b/.test(parentArgs);
        }
      }
      if (!stale) continue;
      for (const pid of chromeProcessesUsing(profile)) { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } }
      await rm(profile, { recursive: true, force: true });
      swept.push(name);
    } catch { /* another sweep got there first, or a permission we do not have */ }
  }
  if (swept.length) console.log('swept ' + swept.length + ' stale Chrome profile(s) left by earlier runs');
  return swept;
}

export async function launchChrome(binary, width, height) {
  await sweepStaleProfiles();
  const profile = await mkdtemp(path.join(os.tmpdir(), PROFILE_PREFIX));
  const child = spawn(binary, [
    '--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
    '--force-device-scale-factor=1', '--window-size=' + width + ',' + height, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  await writeFile(path.join(profile, OWNER_FILE), JSON.stringify({ node: process.pid, chrome: child.pid, started: new Date().toISOString() }));

  // If this process is interrupted, take Chrome with it. A signal handler
  // suppresses Node's default exit, so exit here with the conventional code.
  const abandon = () => { try { child.kill('SIGKILL'); } catch { /* already gone */ } try { rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome still writing; the next launch sweeps it */ } };
  const onSignal = signal => { abandon(); process.exit(signal === 'SIGINT' ? 130 : 143); };
  process.once('exit', abandon);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, onSignal);

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
    process.off('exit', abandon);
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.off(signal, onSignal);
    try { socket.close(); } catch { /* already closed */ }
    // Wait for Chrome to exit before removing its profile: it is still
    // writing to it, and removing a directory under it fails with ENOTEMPTY.
    let fallback;
    const exited = new Promise(resolve => { child.once('exit', resolve); fallback = setTimeout(resolve, 5_000); });
    child.kill();
    await exited;
    clearTimeout(fallback);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try { await rm(profile, { recursive: true, force: true }); break; } catch { await new Promise(resolve => setTimeout(resolve, 200)); }
    }
  };
  return { devtools: new Devtools(socket), close };
}

// When a selector matches nothing, say what is there. Twenty captures in one
// week failed on a guessed class name -- .forecast-map-panel for
// .forecast-map-frame, .transport-scene for .transport-panel -- and each wrong
// guess cost a Chrome launch and a re-run. The page knows its own class names;
// the nearest few are worth more than "nothing matches".
export const SUGGEST_CLASSES = `(() => {
  const names = new Set();
  for (const element of document.querySelectorAll('*')) for (const name of element.classList) names.add(name);
  return [...names];
})()`;

export function nearestSelectors(selector, classNames, limit = 5) {
  const wanted = selector.replace(/^[.#]/, '').toLowerCase();
  const tokens = wanted.split(/[-_]/).filter(Boolean);
  const score = name => {
    const lower = name.toLowerCase();
    if (lower === wanted) return -10_000;
    let shared = 0;
    for (const token of tokens) if (lower.includes(token)) shared += token.length;
    // Shared characters first, then the shorter of two equal candidates.
    return -shared * 100 + lower.length + (lower.includes(wanted) || wanted.includes(lower) ? -50 : 0);
  };
  return classNames
    .map(name => ({ name, score: score(name) }))
    .filter(entry => entry.score < 0)
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map(entry => '.' + entry.name);
}

export async function noMatchMessage(evaluate, flag, selector) {
  let hint = '';
  try {
    const near = nearestSelectors(selector, await evaluate(SUGGEST_CLASSES));
    if (near.length) hint = ' Classes on the page that come close: ' + near.join(', ') + '.';
  } catch { /* the page could not be asked; the plain message still helps */ }
  return flag + ': nothing matches ' + selector + '.' + hint;
}

// A phase for one animation: `7%` of its own iteration, or `350ms` (or a bare
// number) of active time. What --pose takes, after the selector and '='.
export function parsePhase(text) {
  const trimmed = String(text ?? '').trim();
  const percent = /^(-?[\d.]+)%$/.exec(trimmed);
  if (percent) return { percent: Number(percent[1]) };
  const ms = /^(-?[\d.]+)(?:ms)?$/.exec(trimmed);
  if (ms) return { ms: Number(ms[1]) };
  const seconds = /^(-?[\d.]+)s$/.exec(trimmed);
  if (seconds) return { ms: Number(seconds[1]) * 1000 };
  throw new Error('a phase is a percentage of the animation (7%) or a time (350ms, 1.2s), got "' + text + '"');
}

// Split one argv into capture groups on a separator word. The first group is
// the base; the others are read on top of a copy of it, so `--offline --time
// 08:46 --then --sky night,clear --then --sky day,snow` is three captures that
// share the first two flags.
export function splitGroups(argv, separator = '--then') {
  const groups = [[]];
  for (const arg of argv) {
    if (arg === separator) groups.push([]);
    else groups[groups.length - 1].push(arg);
  }
  return groups;
}

// The debug flags that go into the page URL. Each script parses its own
// arguments, but they must agree about what the flags mean, so the URL is
// built in one place. See lib/debug-flags.ts and lib/panel-rotation.ts.
//
// Both tools must accept every one of these, or capturing a scene and
// measuring "the same" scene quietly differ. That drift is not hypothetical:
// extracting this function dropped --transit-demo from the URL while both
// scripts still advertised it. scripts/check-rules.mjs enforces the list.
export const URL_FLAGS = ['--url', '--scene', '--fact', '--offline', '--demo', '--dry', '--no-weather', '--transit-demo', '--transit', '--time', '--pet', '--date', '--sky'];

/**
 * Handle one of URL_FLAGS, or report that it is not one.
 *
 * Every browser tool parses its own arguments -- they each have flags nobody
 * else has, and a shared parser for all of them would be worse than the
 * duplication. But these twelve arms were written out four times, identically,
 * and their agreement was checked by grepping the scripts for the literal text
 * `case '--sky':`. That check could not tell an implemented arm from an empty
 * one, and it could only ever cover scripts someone remembered to list.
 *
 * Call it from the default branch of a tool's own switch: it returns true if
 * it took the flag, false if the caller should reject it. `arg` is the raw
 * argument, which only --url needs: its values contain '=', so it is the one
 * flag the callers keep out of their generic `--flag=value` split.
 */
export function takeUrlFlag(flag, options, value, arg = flag) {
  switch (flag) {
    case '--url': options.url = arg.startsWith('--url=') ? arg.slice('--url='.length) : value(); return true;
    case '--scene': options.scene = value(); return true;
    case '--fact': options.fact = value(); return true;
    case '--offline': options.offline = true; return true;
    case '--demo': options.demo = true; return true;
    case '--dry': options.dry = true; return true;
    case '--no-weather': options.noWeather = true; return true;
    case '--transit-demo': options.transit = 'demo'; return true;
    case '--transit': options.transit = value(); return true;
    case '--time': options.time = value(); return true;
    case '--pet': options.pet = value(); return true;
    case '--date': options.date = value(); return true;
    case '--sky': options.sky = value(); return true;
    default: return false;
  }
}

/**
 * Handle one of the flags every browser tool takes for the browser itself,
 * or report that it is not one. These seven arms were written out in five
 * scripts; a tool that forgot one silently differed from the others.
 *
 *   --width, --height   viewport in CSS pixels
 *   --wait <ms>         settle time after load
 *   --reduced-motion    emulate prefers-reduced-motion: reduce
 *   --console           print everything the page logged
 *   --chrome <path>     the Chrome binary
 *   --help, -h          print the script's header comment
 *
 * Call it beside takeUrlFlag from the default branch of a tool's own switch.
 */
export function takeBrowserFlag(flag, options, value) {
  switch (flag) {
    case '--width': options.width = Number(value()); return true;
    case '--height': options.height = Number(value()); return true;
    case '--wait': options.wait = Number(value()); return true;
    case '--reduced-motion': options.reducedMotion = true; return true;
    case '--console': options.console = true; return true;
    case '--chrome': options.chrome = value(); return true;
    case '--help': case '-h': options.help = true; return true;
    default: return false;
  }
}

// Every tool documents itself in the comment block at the top of its file,
// and --help prints that block. One reader for all of them.
export async function printHelp(metaUrl) {
  const source = await readFile(fileURLToPath(metaUrl), 'utf8');
  const header = [];
  for (const line of source.split('\n')) {
    if (!line.startsWith('//')) { if (header.length) break; continue; }
    header.push(line.replace(/^\/\/ ?/, ''));
  }
  console.log(header.join('\n'));
}

export function pageUrl(options) {
  const url = new URL(options.url ?? 'http://127.0.0.1:3000/');
  if (options.scene) url.searchParams.set('scene', options.scene);
  if (options.fact !== undefined) url.searchParams.set('fact', String(options.fact));
  if (options.offline) url.searchParams.set('weather', 'off');
  // The demo run is a kind of offline, and wins when both are asked for: it
  // makes no request either, and it has something to draw.
  if (options.demo) url.searchParams.set('weather', 'demo');
  // The same run with no rain in it, which is the only way to reach the
  // forecast map the rotation has skipped. It outranks --demo, since asking
  // for both can only mean the dry one was meant.
  if (options.dry) url.searchParams.set('weather', 'dry');
  // And the empty card outranks all three: it is the one state a placeholder hides.
  if (options.noWeather) url.searchParams.set('weather', 'none');
  // demo, stale, expired or down: a synthetic board, optionally dated back
  // past the freshness stamp's thresholds, or refused outright.
  if (options.transit) url.searchParams.set('transit', options.transit);
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
