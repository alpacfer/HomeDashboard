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

// 1b. A scrolling layer loops seamlessly only when it is shifted by exactly one
//     tile. Get that wrong and the layer jumps once per cycle — every 128 to 470
//     seconds in the clock's scenery, which is far too rare to catch by eye and
//     invisible to `npm run motion`, which follows the Tenant's transform path
//     and not a background. Both halves of the invariant are checkable:
//     a cs-drift layer must express its background-size width as var(--tile),
//     and a cs-rain/cs-snow layer's background-size height must equal the
//     distance its keyframe travels. See docs/CLOCK.md.
//     MASK-SIZE COUNTS TOO. The weather card's cloud layers are silhouettes
//     worn over a flat gradient, so what repeats -- and therefore what has to
//     agree with the travel -- is the mask, and the background-size beside it
//     is a passenger. Reading only background-size would have watched the
//     passenger.
//     Structural, not by name. This rule used to know three animations
//     (cs-drift, cs-rain, cs-snow) and one transform function (translate3d),
//     which meant it was checking the examples rather than the invariant.
//     clock-workshop.css's shed-rain is the same tiling-fall pattern, written
//     with translateY, and slipped past on both counts; renaming cs-rain would
//     have made the whole rule evaporate with a green check. Every failure
//     mode was silent, which is the worst property a check can have.
const sheets = await list('app', /\.css$/);
const corpus = (await Promise.all(sheets.map(read))).join('\n');
// Keyframes are indexed across every stylesheet, because a rule and the
// animation it names need not live in the same file and already do not:
// @keyframes cs-drift is in clock-theme.css and every layer using it is in
// clock-hillside.css.
const KEYFRAMES = new Map();
for (const [, name, block] of corpus.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g)) {
  KEYFRAMES.set(name, block);
}
// Where the layer has got to when the loop repeats. Frames are read by their
// own offset rather than by source order, so a block written 0% 100% 50% is
// not misread, and translate3d/translate/translateX/translateY all count.
const finalTravel = name => {
  const block = KEYFRAMES.get(name);
  if (!block) return null;
  let best = null;
  for (const [, stops, decls] of block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const offsets = stops.split(',').map(stop => {
      const text = stop.trim();
      if (text === 'from') return 0;
      if (text === 'to') return 100;
      return Number.parseFloat(text);
    }).filter(Number.isFinite);
    const at = Math.max(...offsets);
    if (!Number.isFinite(at) || (best && at <= best.at)) continue;
    const transform = /transform\s*:\s*([^;]+)/.exec(decls)?.[1] ?? '';
    let x = '0', y = '0';
    const three = /translate3d\(([^)]*)\)/.exec(transform);
    const two = /\btranslate\(([^)]*)\)/.exec(transform);
    const onlyX = /translateX\(([^)]*)\)/.exec(transform);
    const onlyY = /translateY\(([^)]*)\)/.exec(transform);
    if (three) { const parts = three[1].split(','); x = (parts[0] ?? '0').trim(); y = (parts[1] ?? '0').trim(); }
    else if (two) { const parts = two[1].split(','); x = (parts[0] ?? '0').trim(); y = (parts[1] ?? '0').trim(); }
    if (onlyX) x = onlyX[1].trim();
    if (onlyY) y = onlyY[1].trim();
    best = { at, x, y };
  }
  return best;
};
const px = text => {
  const match = /^-?[\d.]+(?=px$)/.exec(String(text).trim());
  return match ? Math.abs(Number(match[0])) : null;
};
const tokens = text => [...String(text).matchAll(/--[\w-]+/g)].map(match => match[0]);

for (const file of sheets) {
  const css = await read(file);
  // Rule blocks are flat here: one selector, one { ... } with no nesting.
  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (selector.includes('@')) continue;
    // Every property that can carry the tile. The weather card's cloud layers
    // loop on their MASK -- the background under them is a plain two-stop
    // gradient and its size is only along for the ride -- so a check that read
    // background-size alone would have watched the passenger and not the
    // driver. Both are checked, and each against the same travel.
    const sizes = [...body.matchAll(/(?:^|[;{\s])(?:-webkit-)?(?:background|mask)-size\s*:\s*([^;]+)/g)]
      .map(match => match[1].trim());
    if (!sizes.length) continue;
    const shorthand = /animation\s*:\s*([^;]+)/.exec(body)?.[1]
      ?? /animation-name\s*:\s*([^;]+)/.exec(body)?.[1];
    if (!shorthand) continue;
    const where = file + ' (' + selector.trim().split('\n').pop().trim() + ')';
    const pairs = sizes.map(size => size.split(',')[0].trim().split(/\s+/));
    // One shorthand can name several animations, and the name is whichever
    // token is a keyframe -- not the first one, which may be a duration.
    for (const part of shorthand.split(',')) {
      const name = part.trim().split(/\s+/).find(token => KEYFRAMES.has(token));
      if (!name) continue;
      const moved = finalTravel(name);
      if (!moved) continue;
      for (const [axis, travelled, tile, word] of pairs.flatMap(([sizeX, sizeY]) =>
        [['x', moved.x, sizeX, 'width'], ['y', moved.y, sizeY, 'height']])) {
        if (!travelled || travelled === '0' || px(travelled) === 0) continue;
        if (tile === undefined) continue;
        const travelPx = px(travelled);
        const tilePx = px(tile);
        if (travelPx !== null && tilePx !== null) {
          if (Math.abs(travelPx - tilePx) > 0.01) {
            fail(where, 'tiles every ' + tilePx + 'px and @keyframes ' + name + ' travels ' + travelPx
              + 'px on ' + axis + ', so the layer jumps once a cycle. The travel must equal the tile ' + word + '.');
          }
          continue;
        }
        // One side is a custom property. Then both must name the same one, or
        // they are two independent numbers that only happen to agree today.
        const shared = tokens(tile).filter(token => tokens(travelled).includes(token));
        if (!shared.length) {
          fail(where, 'tiles every "' + tile + '" on ' + axis + ' but @keyframes ' + name + ' travels "'
            + travelled + '". Express both with the same custom property so they cannot drift apart'
            + ' and the loop jump once a cycle.');
        }
      }
    }
  }
}

// 1c. A generated stylesheet's custom properties must be defined nowhere else.
//     app/horizon.css is written by npm run horizon and holds the geometry
//     traced off the paintings; the theme files are written by hand. When both
//     define a name, one silently shadows the other and nothing says which.
//     This is not hypothetical and it is not cosmetic: the traced --sky-low was
//     also, already, the name of a sky COLOUR in clock-hillside.css's palette,
//     so --sun-y resolved to calc(#8cc0c6 + ...), which is invalid, which drops
//     the whole background-image list it appears in -- and .cs-sun paints the
//     sun, the moon and every star in one list. The card lost its sky and no
//     error was reported anywhere. A stylesheet cannot warn about this; only
//     this can.
const GENERATED_SHEETS = ['app/horizon.css'];
const declaredIn = async file => {
  const found = new Set();
  // A definition, not a use: the name at the head of a declaration.
  for (const [, name] of (await read(file)).matchAll(/(?:^|[;{])\s*(--[\w-]+)\s*:/g)) found.add(name);
  return found;
};
for (const generated of GENERATED_SHEETS) {
  if (!existsSync(path.join(ROOT, generated))) {
    fail(generated, 'is imported as generated but does not exist. Run npm run horizon.');
    continue;
  }
  const owned = await declaredIn(generated);
  for (const file of sheets) {
    if (file === generated) continue;
    for (const name of await declaredIn(file)) {
      if (!owned.has(name)) continue;
      fail(file, 'defines ' + name + ', which ' + generated + ' also defines. One of the two silently wins and'
        + ' the loser is invisible -- and an invalid value in a custom property takes the whole declaration that'
        + ' uses it with it. Rename one of them; the generated file owns the --arc- prefix.');
    }
  }
}

// 1d. Every drawing in public/scenes/ has to be a mask the browser will
//     actually use, and both ways it can fail are SILENT: a mask-image that
//     does not parse is treated as no mask at all, so the layer wearing it
//     simply is not there, and one without preserveAspectRatio="none" is fitted
//     inside its mask box rather than stretched to it, which opens a
//     transparent gutter beside every tile. Both have shipped. Neither shows in
//     a screenshot of a different weather, and there are eight weathers.
//
//     The XML rule that bit was `--` inside a comment, which is illegal and
//     which prose about tile widths and tangents runs into constantly. The tag
//     balance below is not a parser; it is the cheapest thing that would have
//     caught a truncated file, and it needs no dependency.
for (const file of await list('public/scenes', /\.svg$/)) {
  const svg = await read(file);
  for (const [comment] of svg.matchAll(/<!--[\s\S]*?-->/g)) {
    if (comment.slice(4, -3).includes('--')) {
      fail(file, 'has "--" inside an XML comment, which is not well formed. The browser then treats the'
        + ' whole file as no mask at all and the layer wearing it silently disappears.');
      break;
    }
  }
  if (!/<svg[^>]*\bpreserveAspectRatio="none"/.test(svg)) {
    fail(file, 'does not set preserveAspectRatio="none". A mask-image is a replaced element, so the default'
      + ' fits the drawing inside the mask box instead of stretching it, and a transparent gutter opens'
      + ' beside every tile. See public/scenes/README.md.');
  }
  const bare = svg.replace(/<!--[\s\S]*?-->/g, '');
  const open = new Map();
  for (const [, name, tail] of bare.matchAll(/<([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g)) {
    if (!tail.trimEnd().endsWith('/')) open.set(name, (open.get(name) ?? 0) + 1);
  }
  for (const [, name] of bare.matchAll(/<\/([a-zA-Z][\w:-]*)\s*>/g)) open.set(name, (open.get(name) ?? 0) - 1);
  const unclosed = [...open].filter(([, count]) => count !== 0);
  if (unclosed.length) {
    fail(file, 'has unbalanced tags: ' + unclosed.map(([name, count]) => name + ' ' + (count > 0 ? '+' : '') + count).join(', ')
      + '. An unparseable mask is treated as no mask, and the layer wearing it vanishes without a word.');
  }
}

// 1e. Every mask a stylesheet names has to exist, for the same reason: a 404
//     mask-image is no mask, and the layer is gone rather than unstyled.
for (const file of sheets) {
  for (const [, url] of (await read(file)).matchAll(/url\('(\/scenes\/[^']+)'\)/g)) {
    if (!existsSync(path.join(ROOT, 'public', url))) {
      fail(file, 'masks with ' + url + ', which does not exist. The layer wearing it disappears silently.');
    }
  }
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
  [/\bnew IntersectionObserver\(/, /\.disconnect\(\)/, 'an IntersectionObserver without .disconnect()'],
  [/\bnew MutationObserver\(/, /\.disconnect\(\)/, 'a MutationObserver without .disconnect()'],
  [/\bnew PerformanceObserver\(/, /\.disconnect\(\)/, 'a PerformanceObserver without .disconnect()'],
  [/\bnew EventSource\(/, /\.close\(\)/, 'an EventSource without .close()'],
  [/\bnew WebSocket\(/, /\.close\(\)/, 'a WebSocket without .close()'],
  [/\bnew Worker\(/, /\.terminate\(\)/, 'a Worker without .terminate()'],
  // AGENTS.md names the wake lock as something components own, and
  // keep-awake.tsx has always released it by hand with nothing checking.
  [/wakeLock\.request\(/, /\.release\(\)/, 'a wake lock without .release()'],
];
// app/ as well as components/: page.tsx runs a 1 Hz interval and four
// listeners, and was never scanned. Recursive, so a component moved into a
// subdirectory does not leave the check behind.
for (const dir of ['components', 'app']) {
  for (const name of (await readdir(path.join(ROOT, dir), { recursive: true })).filter(entry => /\.tsx?$/.test(entry))) {
    const file = dir + '/' + name.split(path.sep).join('/');
    const source = await read(file);
    for (const [create, destroy, message] of PAIRS) {
      if (create.test(source) && !destroy.test(source)) fail(file, message + '. Every effect must clean up what it starts.');
    }
  }
}

// 3b. Every fetch is given a deadline. A request that never settles leaves the
//     in-flight flag set for good and ends all refreshing on a display nobody
//     reloads -- the one failure this repository cannot recover from by
//     itself. AGENTS.md has required it since the pattern was written down;
//     nothing checked, and rotating-panel.tsx had been without one for a while.
const DEADLINE = /setTimeout\(\s*\(\s*\)\s*=>\s*[\w.]+\.abort\(\)|AbortSignal\.timeout\(/;
for (const dir of ['components', 'app']) {
  for (const name of (await readdir(path.join(ROOT, dir), { recursive: true })).filter(entry => /\.tsx?$/.test(entry))) {
    const file = dir + '/' + name.split(path.sep).join('/');
    const source = await read(file);
    if (!/\bfetch\(/.test(source)) continue;
    if (!/new AbortController\(/.test(source)) {
      fail(file, 'fetches without an AbortController. Copy components/weather-panel.tsx.');
    } else if (!DEADLINE.test(source)) {
      fail(file, 'has an AbortController but never arms it on a timer. Add setTimeout(() => controller.abort(), MS)'
        + ' and clear it in a finally, as components/weather-panel.tsx does. A request that never settles never refreshes again.');
    }
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

// 6b. The guard hook and AGENTS.md must describe the same protected files.
//     They had already drifted: AGENTS.md named render.yaml, the hook did not,
//     and the hook blocked package-lock.json, which AGENTS.md never mentioned.
//     Two descriptions of one rule, and nothing comparing them, so whichever
//     an agent happened to read was the one that counted.
const guard = await read('scripts/hooks/guard-generated.mjs');
const guarded = [...guard.matchAll(/^\s*\[\/\^([^/]+)\//gm)].map(match => match[1].replace(/\\/g, ''));
const listed = (/^## Do not touch without being asked$([\s\S]*?)^## /m.exec(await read('AGENTS.md'))?.[1] ?? '');
if (!listed) fail('AGENTS.md', 'has no "Do not touch without being asked" section for scripts/hooks/guard-generated.mjs to be checked against');
for (const pattern of guarded) {
  // The regex source is close enough to the path to look for: public/facts/daily,
  // app/clock-fonts.css, render.yaml, package-lock.json.
  const stem = pattern.replace(/\$$/, '').split('.+')[0].replace(/\|/g, '');
  if (stem && !listed.includes(stem)) {
    fail('AGENTS.md', 'guard-generated.mjs blocks ' + stem + ' but "Do not touch without being asked" never mentions it. An agent reads the list, not the hook.');
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
//     Every browser tool must accept every flag that goes into the page URL,
//     or capturing a scene and measuring "the same" scene quietly differ.
//     This used to grep each script for the literal text `case '--sky':`,
//     which could not tell an implemented arm from an empty one and covered
//     only the three scripts named in the list -- scene-guides.mjs accepts all
//     twelve and was never checked. The arms live in browser.mjs now, so what
//     is left to verify is that each tool actually routes to them.
const { URL_FLAGS } = await import('./lib/browser.mjs');
const BROWSER_TOOLS = (await list('scripts', /\.mjs$/)).filter(script => !script.includes('/lib/'));
for (const script of BROWSER_TOOLS) {
  const source = await read(script);
  if (!/from '\.\/lib\/browser\.mjs'/.test(source)) continue;
  if (!/\bpageUrl\(/.test(source)) continue;
  if (/\btakeUrlFlag\(/.test(source)) continue;
  // A tool that builds the page URL but parses the flags itself has to prove
  // it takes all of them.
  const missing = URL_FLAGS.filter(flag => !source.includes("case '" + flag + "':"));
  if (missing.length) {
    fail(script, 'builds a page URL but does not accept ' + missing.join(', ')
      + '. Route the default branch of its switch through takeUrlFlag(), as the other browser tools do.');
  }
}

if (problems.length) {
  console.error('Project rules check failed with ' + problems.length + ' problem(s):\n');
  for (const problem of problems) console.error('  ' + problem);
  console.error('\nThe rules are explained in AGENTS.md and docs/DEPLOYMENT.md.');
  process.exit(1);
}
console.log('Project rules check passed: no hover styles, every lib module tested, effects paired with cleanup, no public credentials, Render start script valid, hooks present, fonts in step.');
