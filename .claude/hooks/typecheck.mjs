#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Claude Code `Stop` hook that refuses to end the turn while a package or app with uncommitted changes fails
 * `check-types`.
 *
 * The hook reads the working tree through `git status`, maps each changed path under `packages/` or `apps/` to its
 * package, and runs `check-types` for all of them in one turbo call, so turbo builds the shared dependencies once and
 * from cache (`^build`). On failure it exits with code 2 and the compiler output on stderr, which Claude Code feeds back
 * to the agent. Claude Code marks the turn with `stop_hook_active` once a block has already fired, and the hook lets
 * that turn end to avoid an endless loop.
 */

/**
 * Lines of turbo output kept on stderr; the tail holds the `tsc` errors and the failing task summary.
 */
const MAX_LINES = 200;

const input = JSON.parse(readFileSync(0, 'utf8'));

if (input.stop_hook_active) {
	process.exit(0);
}

const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

// NUL-separated output keeps spaces and renames parseable; a rename carries the old path as an extra chunk to skip
const status = spawnSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
	cwd: root,
	encoding: 'utf8',
});

if (status.status !== 0) {
	process.exit(0);
}

const chunks = status.stdout.split('\0').filter(Boolean);
const dirs = new Set();

for (let i = 0; i < chunks.length; i++) {
	const entry = chunks[i];
	const match = /^((?:packages|apps)\/[^/]+)\//.exec(entry.slice(3));

	if (match) {
		dirs.add(match[1]);
	}

	if (/^[RC]|^.[RC]/.test(entry.slice(0, 2))) {
		i++;
	}
}

// A deleted package has no package.json left, and a package without `check-types` is skipped by turbo anyway
const names = [...dirs]
	.map((dir) => join(root, dir, 'package.json'))
	.filter((file) => existsSync(file))
	.map((file) => JSON.parse(readFileSync(file, 'utf8')).name)
	.filter(Boolean);

if (names.length === 0) {
	process.exit(0);
}

const result = spawnSync(
	'pnpm',
	['turbo', 'run', 'check-types', ...names.map((name) => `--filter=${name}`), '--output-logs=errors-only'],
	{ cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
);

if (result.status === 0) {
	process.exit(0);
}

const output = `${result.stdout ?? ''}${result.stderr ?? ''}${result.error ? String(result.error) : ''}`.trimEnd();
const lines = output.split('\n');
const tail = lines.length > MAX_LINES ? ['…', ...lines.slice(-MAX_LINES)] : lines;

process.stderr.write(
	`check-types failed for ${names.join(', ')}. Fix the type errors below before ending the turn; if they are not ` +
		`caused by your change, tell the user in one line.\n\n${tail.join('\n')}\n`,
);

process.exit(2);
