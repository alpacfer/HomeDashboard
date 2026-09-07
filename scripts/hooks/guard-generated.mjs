// Claude Code PreToolUse hook: refuses Edit/Write on files that are generated
// or must be changed by a tool, and says which tool. Wired in
// .claude/settings.json; the list is scripts/hooks/protected.mjs and mirrors
// "Do not touch without being asked" in AGENTS.md. Exit code 2 blocks the tool
// call and shows the message.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { protectedReason } from './protected.mjs';

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }
const target = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
if (!target) process.exit(0);
const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const relative = path.relative(root, path.resolve(root, target)).split(path.sep).join('/');
const reason = protectedReason(relative);
if (reason) {
  console.error('Blocked: ' + relative + ' is ' + reason + ' If Alejandro explicitly asked for a hand edit here, say so and do it through Bash.');
  process.exit(2);
}
