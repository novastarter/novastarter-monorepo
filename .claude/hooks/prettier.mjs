#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/**
 * Claude Code `PostToolUse` hook that runs `prettier --write` on the file an `Edit` or `Write` call just touched.
 *
 * Claude Code pipes the tool call as JSON into stdin; the hook formats every file type Prettier understands in
 * this repository, so edited code, configs and docs match `.prettierrc.json` without a manual pass.
 */

// 1. Claude Code hands the tool call over stdin as JSON; the edited path lives under `tool_input.file_path`
const input = JSON.parse(readFileSync(0, 'utf8'));
const file = input.tool_input?.file_path ?? '';

// 2. Only format the extensions Prettier supports here, including React `.tsx`/`.jsx` files
if (/\.(js|mjs|jsx|ts|tsx|json|scss|css|md|yaml|yml)$/.test(file)) {
	// 3. Run from the repository root through pnpm, so the root Prettier install and config are the ones used
	spawnSync('pnpm', ['exec', 'prettier', '--write', file], {
		cwd: process.env.CLAUDE_PROJECT_DIR,
		stdio: 'inherit',
		shell: true,
	});
}
