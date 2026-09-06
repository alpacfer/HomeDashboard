// Claude Code hook that keeps the working tree lint-clean without waiting for
// `npm run check`. Two modes, both wired in .claude/settings.json:
//
//   --file   PostToolUse on Edit/Write: lint the one file just written.
//   --stop   Stop: lint every changed source file, typecheck if any TypeScript
//            changed, run the tests if lib/ or tests/ changed, and run the
//            project's own rule and documentation checks whenever anything it
//            covers changed. A failure exits 2, which keeps the turn open with
//            the output shown, so the problem is fixed before the work is
//            handed over.
//
// eslint reads code, so it only ever sees LINTABLE files. But the rules that
// catch a :hover in a stylesheet, an unpaired keyframe, or a documentation
// link pointing at a file that no longer exists live in check-rules.mjs and
// check-docs.mjs, and a stylesheet-only turn used to end with none of them
// run: the hook could not see a .css file at all. WATCHED is what the project
// checks, LINTABLE is the subset eslint and tsc can read.
//
// Fast by construction: eslint on a handful of files, tsc incremental, and
// two checks that only read files. Skips itself when there is nothing to
// check, and when the Stop hook has already run once for this stop
// (stop_hook_active).

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const mode = process.argv[2];
const LINTABLE = /\.(ts|tsx|mjs|js)$/;
const WATCHED = /\.(ts|tsx|mjs|js|css|md|json|ya?ml)$/;
const IGNORED = /^(node_modules|\.next|out|dist)\//;

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { /* no stdin */ }

function run(label, command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' });
  if (result.status === 0) return true;
  console.error('--- ' + label + ' failed ---\n' + (result.stdout || '') + (result.stderr || ''));
  return false;
}

const bin = name => {
  const local = path.join(root, 'node_modules', '.bin', name);
  return existsSync(local) ? local : name;
};

let files = [];
if (mode === '--file') {
  const target = input.tool_input?.file_path;
  if (!target) process.exit(0);
  const relative = path.relative(root, path.resolve(root, target)).split(path.sep).join('/');
  if (!LINTABLE.test(relative) || IGNORED.test(relative) || !existsSync(path.join(root, relative))) process.exit(0);
  files = [relative];
} else if (mode === '--stop') {
  if (input.stop_hook_active) process.exit(0);
  const changed = spawnSync('git', ['diff', '--name-only', 'HEAD'], { cwd: root, encoding: 'utf8' });
  const untracked = spawnSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' });
  files = [...new Set((changed.stdout + '\n' + untracked.stdout).split('\n').map(line => line.trim()).filter(Boolean))]
    .filter(file => WATCHED.test(file) && !IGNORED.test(file) && existsSync(path.join(root, file)));
} else {
  console.error('usage: lint-changed.mjs --file | --stop');
  process.exit(1);
}

if (!files.length) process.exit(0);
const lintable = files.filter(file => LINTABLE.test(file));
let ok = lintable.length ? run('eslint ' + lintable.join(' '), bin('eslint'), ['--max-warnings', '0', ...lintable]) : true;
if (mode === '--stop') {
  if (files.some(file => /\.tsx?$/.test(file))) ok = run('tsc --noEmit', bin('tsc'), ['--noEmit']) && ok;
  if (files.some(file => /^(lib|tests)\//.test(file))) ok = run('npm test', 'node', ['--import', 'tsx', '--test', 'tests/*.test.mjs']) && ok;
  // Both only read files, so they are cheap enough to run whenever anything
  // they cover moved. check-rules is the only thing that looks at a
  // stylesheet; check-docs is the only thing that notices a link left behind
  // by a renamed file.
  ok = run('npm run check:rules', 'node', ['scripts/check-rules.mjs']) && ok;
  ok = run('npm run docs:check', 'node', ['scripts/check-docs.mjs']) && ok;
}
if (!ok) {
  console.error('\nFix the problems above before finishing. Rules: AGENTS.md.');
  process.exit(2);
}
