#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import process from 'node:process';

/**
 * Lefthook `pre-commit` job that rejects a commit carrying code changes under `packages/` or `apps/` without a
 * matching changeset in `.changeset/`.
 *
 * The job reads the git index rather than the working tree, so only what is actually being committed counts. It
 * mirrors the Claude Code Stop hook in `.claude/hooks/changeset.mjs`: a `changeset version` run rewrites
 * `CHANGELOG.md` files and consumes the changesets it releases, so a commit touching a `CHANGELOG.md` is treated as
 * a release chore and never blocked. Bypass with `LEFTHOOK=0 git commit` or `git commit --no-verify`.
 */

// 1. Read every staged path, NUL-separated so spaces parse safely; deletions are included because removing code
//    is a change the package consumer must hear about too
const diff = spawnSync('git', ['diff', '--cached', '--name-only', '-z'], { encoding: 'utf8' });

if (diff.status !== 0) {
	process.stderr.write(`changeset: git diff failed\n${diff.stderr}`);
	process.exit(1);
}

const paths = diff.stdout.split('\0').filter(Boolean);

// 2. A staged CHANGELOG.md means `changeset version` ran: the changesets were consumed on purpose, nothing to demand
if (paths.some((path) => /(^|\/)CHANGELOG\.md$/.test(path))) {
	process.exit(0);
}

// 3. Code changes live under `packages/` and `apps/`; a changeset is any Markdown file in `.changeset/` except the
//    generated README
const code = paths.filter((path) => /^(packages|apps)\/[^/]+\//.test(path));
const changesets = paths.filter((path) => /^\.changeset\/(?!README\.md$)[^/]+\.md$/.test(path));

if (code.length === 0 || changesets.length > 0) {
	process.exit(0);
}

// 4. Reject the commit and name the files that still lack a changeset, capped so a wide refactor stays readable
const shown = code.slice(0, 10).join(', ') + (code.length > 10 ? `, … (${code.length - 10} more)` : '');

process.stderr.write(
	`Staged changes under packages/ or apps/ have no changeset: ${shown}\n` +
		'Write .changeset/<kebab-name>.md per the changeset rule in AGENTS.md (frontmatter with affected packages and ' +
		'bump type, then one release-note sentence for the package consumer) and stage it with the commit.\n',
);

process.exit(1);
