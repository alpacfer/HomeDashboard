import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The Bash guard is the only check in this repository that can refuse work, so
// what it refuses and what it lets through is worth pinning down. It is a hook
// rather than a module, so it is exercised the way Claude Code runs it: a JSON
// command on stdin, exit 2 to block.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOK = path.join(ROOT, 'scripts', 'hooks', 'guard-bash.mjs');

function guard(command) {
  const result = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ tool_input: { command } }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT },
  });
  return { blocked: result.status === 2, message: (result.stderr || '').trim() };
}

test('every shape of a forced push is refused, an ordinary push is not', () => {
  for (const command of ['git push -f origin main', 'git push --force origin main',
    'git push --force-with-lease origin main', 'git push origin +main']) {
    assert.equal(guard(command).blocked, true, command);
  }
  assert.equal(guard('git push origin main').blocked, false);
  assert.equal(guard('git push').blocked, false);
});

test('the commands that discard uncommitted work are refused', () => {
  for (const command of ['git reset --hard HEAD~1', 'git checkout -- app/page.tsx', 'git checkout .',
    'git restore lib/weather.ts', 'git clean -fd', 'git stash drop', 'git branch -D topic']) {
    assert.equal(guard(command).blocked, true, command);
  }
  // Staging and stashing keep the work, so they are ordinary commands.
  assert.equal(guard('git restore --staged lib/weather.ts').blocked, false);
  assert.equal(guard('git stash').blocked, false);
  assert.equal(guard('git reset HEAD~1').blocked, false);
});

test('recursive deletion is allowed only where the files are rebuildable', () => {
  for (const command of ['rm -rf lib', 'rm -rf .', 'rm -r components/tenant.tsx', 'rm -rf public/maps']) {
    assert.equal(guard(command).blocked, true, command);
  }
  for (const command of ['rm -rf .next', 'rm -rf screenshots/audit', 'rm -rf node_modules',
    'rm -rf .cache/agent-turns', 'rm -rf /tmp/scratch/x', 'rm -f lib/weather.ts']) {
    assert.equal(guard(command).blocked, false, command);
  }
});

test('a target list ends at the command separator, not at the next command', () => {
  // Reading on past the separator once reported `echo` as a deletion target.
  const { blocked, message } = guard('rm -rf .next && echo done');
  assert.equal(blocked, false, message);
  assert.equal(guard('rm -rf .next\necho lib').blocked, false);
  // The dangerous half of a compound command is still caught.
  assert.equal(guard('echo start; rm -rf lib').blocked, true);
});

test('a shell write to a generated file is refused, whichever way it is spelt', () => {
  for (const command of ['echo x > package-lock.json', 'sed -i "s/a/b/" app/horizon.css',
    'tee .codex/hooks.json < x', 'cp x public/facts/daily/01-01.json', 'echo y >> app/clock-fonts.css']) {
    assert.equal(guard(command).blocked, true, command);
  }
  // Reading one is fine, and so is writing anywhere else.
  assert.equal(guard('sed -n "1,5p" app/horizon.css').blocked, false);
  assert.equal(guard('sed -i "s/a/b/" lib/weather.ts').blocked, false);
  assert.equal(guard('echo x > screenshots/notes.txt').blocked, false);
});

test('a heredoc body is text being written, not a command being run', () => {
  // This blocked two of the guard's own test runs the day it was written.
  const writing = "cat > trials.txt <<'EOF'\nrm -rf lib\ngit push -f\nEOF";
  assert.equal(guard(writing).blocked, false, guard(writing).message);
  // Unless the body is fed to a shell, where it really is executed.
  assert.equal(guard("bash <<'EOF'\nrm -rf lib\nEOF").blocked, true);
  // A command after the heredoc closes is read normally.
  assert.equal(guard("cat > x <<'EOF'\nhello\nEOF\nrm -rf lib").blocked, true);
});

test('ordinary work is never refused', () => {
  for (const command of ['npm run check', 'npm run shot -- --offline --clip .clock-widget',
    'git status --short', 'git diff --stat', 'git add -A', 'git commit -m "x"',
    'grep -rn tenant components', 'node scripts/check-rules.mjs', 'npm ci']) {
    assert.equal(guard(command).blocked, false, command + ': ' + guard(command).message);
  }
});
