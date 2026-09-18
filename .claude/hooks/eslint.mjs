#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/**
 * Claude Code `PostToolUse` hook that runs `eslint --fix` on the file an `Edit` or `Write` call just touched.
 *
 * Claude Code pipes the tool call as JSON into stdin; the hook only reacts to script extensions the root
 * `eslint.config.js` covers, so JSON, Markdown and YAML edits never spawn ESLint for nothing.
 */

// 1. Claude Code hands the tool call over stdin as JSON; the edited path lives under `tool_input.file_path`
const input = JSON.parse(readFileSync(0, 'utf8'));
const file = input.tool_input?.file_path ?? '';

// 2. Only lint the extensions ESLint is configured for, including React `.tsx`/`.jsx` files
if (/\.(js|mjs|jsx|ts|tsx)$/.test(file)) {
	// 3. Run from the repository root through pnpm, so the root ESLint install and config are the ones used
	spawnSync('pnpm', ['exec', 'eslint', '--fix', file], {
		cwd: process.env.CLAUDE_PROJECT_DIR,
		stdio: 'inherit',
		shell: true,
	});
}
