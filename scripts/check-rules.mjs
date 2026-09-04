// The project rules from AGENTS.md that a script can check, checked. Each rule
// names the reason in its message so a failure teaches the rule rather than
// just blocking the commit. Pure Node, no dependencies. Run with
// `npm run check:rules`; `npm run check` and CI include it.

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const fail = (file, message) => problems.push(file + ': ' + message);
const read = file => readFile(path.join(ROOT, file), 'utf8');
const list = async (dir, pattern) => (await readdir(path.join(ROOT, dir))).filter(name => pattern.test(name)).map(name => dir + '/' + name);

// 1. There is no pointer on the wall. Hover, cursor and pointer-only styles are
//    invisible to the only user this display has (docs/DEPLOYMENT.md, rule 5).
for (const file of await list('app', /\.css$/)) {
  const css = await read(file);
  css.split('\n').forEach((line, index) => {
    if (/:hover\b/.test(line)) fail(file + ':' + (index + 1), 'uses :hover; the display has no pointer');
    if (/\bcursor\s*:/.test(line)) fail(file + ':' + (index + 1), 'sets cursor; the display has no pointer');
  });
}

// 2. Every lib/ module has a test that imports it. lib/ is where logic goes so
//    that it can be tested without a renderer; a module nothing imports from
//    tests/ has escaped that.
const tests = await Promise.all((await list('tests', /\.test\.mjs$/)).map(read));
for (const file of await list('lib', /\.ts$/)) {
  const name = path.basename(file, '.ts');
  if (!tests.some(test => new RegExp("lib/" + name.replace(/[.-]/g, '\\$&') + "\\.ts'").test(test))) {
    fail(file, 'no test in tests/ imports it. Add tests/' + name + '.test.mjs or import it from an existing suite.');
  }
}

// 3. Timers, listeners, frames and Leaflet maps created in a component must be
//    torn down in the same file. The display runs for weeks without a reload;
//    a leak invisible in five minutes kills it overnight. This is a pairing
//    check, not a proof, and eslint's exhaustive-deps does the rest.
const PAIRS = [
  [/\bsetInterval\(/, /\bclearInterval\(/, 'setInterval without clearInterval'],
  [/\bsetTimeout\(/, /\bclearTimeout\(/, 'setTimeout without clearTimeout'],
  [/\baddEventListener\(/, /\bremoveEventListener\(|\{\s*once:\s*true\s*\}/, 'addEventListener without removeEventListener (or { once: true })'],
  [/\brequestAnimationFrame\(/, /\bcancelAnimationFrame\(/, 'requestAnimationFrame without cancelAnimationFrame'],
  [/\bL\.map\(/, /\.remove\(\)/, 'a Leaflet map without .remove()'],
  [/\bnew ResizeObserver\(/, /\.disconnect\(\)/, 'a ResizeObserver without .disconnect()'],
];
for (const file of await list('components', /\.tsx?$/)) {
  const source = await read(file);
  for (const [create, destroy, message] of PAIRS) {
    if (create.test(source) && !destroy.test(source)) fail(file, message + '. Every effect must clean up what it starts.');
  }
}

// 4. Nothing shipped to the browser may look like a credential. NEXT_PUBLIC_
//    variables are inlined into the client bundle.
for (const dir of ['app', 'components', 'lib']) {
  for (const file of (await readdir(path.join(ROOT, dir), { recursive: true })).filter(name => /\.(ts|tsx|css)$/.test(name))) {
    const source = await read(dir + '/' + file);
    const match = source.match(/NEXT_PUBLIC_\w*(KEY|SECRET|TOKEN|PASSWORD|ACCESS_ID)\w*/);
    if (match) fail(dir + '/' + file, match[0] + ' would ship a credential to the browser. Read it in a route handler instead.');
  }
}

// 5. The Render start command must be a script that exists, bound to 0.0.0.0.
//    render.yaml is documentation until linked, but wrong documentation of a
//    deploy is worse than none.
const renderYaml = await read('render.yaml');
const pkg = JSON.parse(await read('package.json'));
const start = renderYaml.match(/startCommand:\s*npm run (\S+)/)?.[1];
if (!start) fail('render.yaml', 'startCommand must be an npm script');
else if (!pkg.scripts[start]) fail('render.yaml', 'startCommand names npm run ' + start + ', which package.json does not define');
else if (!/0\.0\.0\.0/.test(pkg.scripts[start])) fail('package.json', start + ' must bind 0.0.0.0 or Render\'s proxy cannot reach it');

// 6. Hooks and commands in .claude/ must point at files that exist, or the
//    guardrails silently stop guarding.
const settings = JSON.parse(await read('.claude/settings.json'));
for (const [event, entries] of Object.entries(settings.hooks ?? {})) {
  for (const entry of entries) for (const hook of entry.hooks ?? []) {
    const script = hook.command.match(/scripts\/[\w./-]+\.mjs/)?.[0];
    if (script && !existsSync(path.join(ROOT, script))) fail('.claude/settings.json', event + ' hook runs ' + script + ', which does not exist');
  }
}

// 7. The generated font stylesheet and the face list must agree: every face the
//    script fetches has a declaration, and nothing is declared by hand.
const faces = [...(await read('scripts/fetch-clock-fonts.mjs')).matchAll(/\{ id: '([\w-]+)', family: '([^']+)'/g)];
const fontCss = await read('app/clock-fonts.css');
for (const [, id, family] of faces) {
  if (!fontCss.includes("font-family: '" + family + "'") && !fontCss.includes('font-family:"' + family + '"') && !fontCss.includes("font-family:'" + family + "'")) {
    fail('app/clock-fonts.css', 'has no @font-face for ' + family + ' (' + id + '). Run npm run fonts:clock.');
  }
}

// 8. The two tools that drive a browser must accept the same URL flags, or a
//    screenshot and a motion measurement of "the same" scene are not of the
//    same scene. scripts/lib/browser.mjs builds the URL for both and names the
//    flags; this is the check that neither script has fallen behind it.
const { URL_FLAGS } = await import('./lib/browser.mjs');
for (const script of ['scripts/screenshot.mjs', 'scripts/measure-motion.mjs']) {
  const source = await read(script);
  for (const flag of URL_FLAGS) {
    if (!source.includes("case '" + flag + "':")) {
      fail(script, 'does not accept ' + flag + ', which scripts/lib/browser.mjs puts in the page URL. Both browser tools must take the same URL flags.');
    }
  }
}

if (problems.length) {
  console.error('Project rules check failed with ' + problems.length + ' problem(s):\n');
  for (const problem of problems) console.error('  ' + problem);
  console.error('\nThe rules are explained in AGENTS.md and docs/DEPLOYMENT.md.');
  process.exit(1);
}
console.log('Project rules check passed: no hover styles, every lib module tested, effects paired with cleanup, no public credentials, Render start script valid, hooks present, fonts in step.');
