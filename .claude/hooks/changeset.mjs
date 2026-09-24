#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/**
 * Claude Code `Stop` hook that refuses to end the turn while `packages/` or `apps/` carry uncommitted code changes
 * without a matching changeset in `.changeset/`.
 *
 * The hook reads the working tree through `git status`, so it catches edits made through any tool, including shell
 * commands. A `changeset version` run rewrites `CHANGELOG.md` files and consumes the changesets it releases, so a
 * tree with a touched `CHANGELOG.md` is treated as a release chore and never blocked. Claude Code marks the turn
 * with `stop_hook_active` once a block has already fired, and the hook lets that turn end to avoid an endless loop.
 */

// Claude Code hands the event over stdin as JSON; `stop_hook_active` means this turn already answered a block
const input = JSON.parse(readFileSync(0, 'utf8'));

if (input.stop_hook_active) {
	process.exit(0);
}

// Read every uncommitted path, NUL-separated so spaces and renames parse safely; a rename carries the old path as an
// extra NUL-terminated chunk that has to be skipped
const status = spawnSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
	cwd: process.env.CLAUDE_PROJECT_DIR,
	encoding: 'utf8',
});

if (status.status !== 0) {
	process.exit(0);
}

const chunks = status.stdout.split('\0').filter(Boolean);
const paths = [];

for (let i = 0; i < chunks.length; i++) {
	const entry = chunks[i];
	paths.push(entry.slice(3));

	if (/^[RC]|^.[RC]/.test(entry.slice(0, 2))) {
		i++;
	}
}

// A touched CHANGELOG.md means `changeset version` ran: the changesets were consumed on purpose, nothing to demand
if (paths.some((path) => /(^|\/)CHANGELOG\.md$/.test(path))) {
	process.exit(0);
}

// Code changes live under `packages/` and `apps/`; a changeset is any Markdown file in `.changeset/` except the
// generated README
const code = paths.filter((path) => /^(packages|apps)\/[^/]+\//.test(path));
const changesets = paths.filter((path) => /^\.changeset\/(?!README\.md$)[^/]+\.md$/.test(path));

if (code.length === 0 || changesets.length > 0) {
	process.exit(0);
}

const shown = code.slice(0, 10).join(', ') + (code.length > 10 ? `, … (${code.length - 10} more)` : '');

process.stdout.write(
	JSON.stringify({
		decision: 'block',
		reason:
			`Uncommitted changes under packages/ or apps/ have no changeset: ${shown}. ` +
			'Write .changeset/<kebab-name>.md per the changeset rule in AGENTS.md (frontmatter with affected packages and ' +
			'bump type, then one release-note sentence for the package consumer). If the change is not yours, ask the ' +
			'user in one line what it does before writing it.',
	}),
);
