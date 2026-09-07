// Write the Codex copies of the Claude Code configuration from the originals.
//
// Two agents work in this repository and each reads its own files: Claude
// Code reads .claude/settings.json and .claude/commands/*.md, Codex reads
// .codex/hooks.json and .agents/skills/*/SKILL.md. The Codex files were made
// once by hand from the Claude ones and then left: three of the four commands
// had a skill, the hooks matched by luck, and nothing said which copy was the
// source. This makes .claude/ the source and the rest derived, the same way
// npm run horizon owns app/horizon.css.
//
// Run with `npm run agents:sync`. `npm run check:rules` fails when the
// derived files differ from what this would write, and names this command.
// Plain Node, no dependencies.

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// A command's front matter and body. Only `description` crosses over: the
// `allowed-tools` list is Claude Code's permission vocabulary.
function parseCommand(markdown) {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(markdown);
  if (!match) throw new Error('a command file starts with a --- front matter block');
  const description = /^description:\s*(.+)$/m.exec(match[1])?.[1]?.trim();
  if (!description) throw new Error('a command file names a description in its front matter');
  return { description, body: match[2].replace(/^\n+/, '').replace(/\s+$/, '') + '\n' };
}

function skillFor(name, { description, body }) {
  return [
    '---',
    'name: "source-command-' + name + '"',
    'description: ' + JSON.stringify(description),
    '---',
    '',
    '# source-command-' + name,
    '',
    'Use this skill when the user asks to run the migrated source command `' + name + '`.',
    '',
    '## Command Template',
    '',
    body,
  ].join('\n');
}

// Everything the sync would write, as { relative path: content }. Exported so
// the rules check can compare without writing.
export async function derivedFiles() {
  const files = new Map();
  const settings = JSON.parse(await readFile(path.join(ROOT, '.claude/settings.json'), 'utf8'));
  files.set('.codex/hooks.json', JSON.stringify({ hooks: settings.hooks ?? {} }, null, 2) + '\n');
  for (const entry of (await readdir(path.join(ROOT, '.claude/commands'))).filter(file => file.endsWith('.md')).sort()) {
    const name = path.basename(entry, '.md');
    const command = parseCommand(await readFile(path.join(ROOT, '.claude/commands', entry), 'utf8'));
    files.set('.agents/skills/source-command-' + name + '/SKILL.md', skillFor(name, command));
  }
  return files;
}

// Which derived files are missing or differ from what would be written.
export async function staleDerivedFiles() {
  const stale = [];
  for (const [file, expected] of await derivedFiles()) {
    const actual = await readFile(path.join(ROOT, file), 'utf8').catch(() => null);
    if (actual !== expected) stale.push(file);
  }
  return stale;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const written = [];
  for (const [file, content] of await derivedFiles()) {
    const target = path.join(ROOT, file);
    const before = await readFile(target, 'utf8').catch(() => null);
    if (before === content) continue;
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
    written.push(file);
  }
  console.log(written.length ? 'Written:\n  ' + written.join('\n  ') : 'Codex configuration already matches .claude/.');
}
