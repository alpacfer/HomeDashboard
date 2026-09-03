// Fails when documentation points at something that no longer exists.
//
// This repository documents behaviour by naming the module that owns it, so a
// file move silently rots the docs unless something checks. Two things are
// verified for every tracked Markdown file:
//
//   1. relative Markdown links resolve to a real file or directory;
//   2. inline-code strings that look like repository paths exist on disk.
//
// Pure Node with no dependencies so it behaves identically on Ubuntu, macOS
// and CI. Run with: npm run docs:check
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, resolve, relative, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['.git', 'node_modules', '.next', 'out', 'dist', 'coverage']);

// Paths that appear in prose as templates or runtime URLs rather than as files
// that exist in the working tree.
const ALLOWED_MISSING = new Set([
  'public/facts/daily/MM-DD.json',
  '.env.local',
]);

const CODE_PATH = /^[\w.@-]+(?:\/[\w.@*-]+)+\.(?:ts|tsx|mjs|js|css|json|md|yml|yaml)$/;

async function markdownFiles(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await markdownFiles(full)));
    else if (entry.name.endsWith('.md')) found.push(full);
  }
  return found;
}

// Strip fenced code blocks so shell transcripts and ASCII trees are not scanned.
function withoutFences(text) {
  return text.replace(/^```[\s\S]*?^```/gm, '');
}

function linkTargets(body) {
  const targets = [];
  for (const [, target] of body.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^(?:https?:|mailto:|#)/.test(target)) continue;
    targets.push(target.split('#')[0]);
  }
  return targets.filter(Boolean);
}

function codePaths(body) {
  const paths = [];
  for (const [, code] of body.matchAll(/`([^`\n]+)`/g)) {
    const candidate = code.trim();
    if (!CODE_PATH.test(candidate)) continue;
    if (candidate.includes('*') || candidate.startsWith('http')) continue;
    // Installed dependencies are not ours to keep in step with the docs, and
    // their layout must not decide whether CI is green.
    if (candidate.startsWith('node_modules/')) continue;
    paths.push(candidate);
  }
  return paths;
}

const problems = [];

for (const file of (await markdownFiles(ROOT)).sort()) {
  const rel = relative(ROOT, file).split(/[\\/]/).join(posix.sep);
  const raw = await readFile(file, 'utf8');
  const body = withoutFences(raw);

  for (const target of linkTargets(body)) {
    const resolved = resolve(dirname(file), target);
    if (!existsSync(resolved)) problems.push(`${rel}: broken link -> ${target}`);
  }

  for (const candidate of codePaths(body)) {
    if (ALLOWED_MISSING.has(candidate)) continue;
    if (!existsSync(resolve(ROOT, candidate))) {
      problems.push(`${rel}: referenced path does not exist -> ${candidate}`);
    }
  }
}

// A stale entry in the allowlist is itself a form of rot.
for (const allowed of ALLOWED_MISSING) {
  if (existsSync(resolve(ROOT, allowed))) {
    problems.push(`scripts/check-docs.mjs: ${allowed} now exists; remove it from ALLOWED_MISSING`);
  }
}

if (problems.length) {
  console.error(`Documentation check failed with ${problems.length} problem(s):\n`);
  for (const problem of problems) console.error(`  ${problem}`);
  console.error('\nUpdate the documentation, or the path it refers to.');
  process.exit(1);
}

console.log('Documentation check passed: all links and referenced paths resolve.');
