#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

/**
 * Fail when a workspace `package.json` pins an external dependency inline instead of through the pnpm catalog.
 *
 * Every version lives in `pnpm-workspace.yaml` (`catalog:` or a named `catalogs:` entry), so one bump updates every
 * package at once. The check reads `packages/*\/package.json` and `apps/*\/package.json` and accepts only
 * `catalog:`, `catalog:<name>` and `workspace:*` in `dependencies`, `devDependencies`, `peerDependencies` and
 * `optionalDependencies`. Run it with `pnpm check:catalog`; lefthook runs it when a `package.json` is staged.
 */

/**
 * Directories whose direct children are workspace packages.
 */
const WORKSPACE_ROOTS = ['packages', 'apps'];

/**
 * Dependency fields of `package.json` that carry version specifiers.
 */
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

/**
 * The only version specifiers a workspace package may use.
 */
const ALLOWED_SPECIFIER = /^(catalog:([\w@./-]+)?|workspace:\*)$/;

/**
 * List the `package.json` path of every workspace package, sorted so the report is stable.
 *
 * @returns Paths relative to the repository root.
 */
function listManifests() {
	// A root may be missing in a trimmed checkout, and a child without a manifest is not a package
	return WORKSPACE_ROOTS.filter((root) => existsSync(root))
		.flatMap((root) =>
			readdirSync(root, { withFileTypes: true })
				.filter((entry) => entry.isDirectory())
				.map((entry) => join(root, entry.name, 'package.json')),
		)
		.filter((path) => existsSync(path))
		.sort();
}

/**
 * Collect every dependency of one manifest whose specifier is not a catalog or workspace reference.
 *
 * @param {string} path - Path of the `package.json` to check.
 * @returns {string[]} One human-readable line per offending dependency.
 */
function findInlineVersions(path) {
	// A broken manifest is reported by pnpm itself, so here it is a hard error.
	const manifest = JSON.parse(readFileSync(path, 'utf8'));
	const problems = [];

	// Walk every dependency field, since a peer or optional pin drifts from the catalog just like a regular one
	for (const field of DEPENDENCY_FIELDS) {
		for (const [name, specifier] of Object.entries(manifest[field] ?? {})) {
			if (!ALLOWED_SPECIFIER.test(specifier)) {
				problems.push(`${path}: ${field}.${name} is "${specifier}"`);
			}
		}
	}

	return problems;
}

// All problems are gathered, so one run lists everything to fix.
const problems = listManifests().flatMap((path) => findInlineVersions(path));

if (problems.length > 0) {
	process.stderr.write(
		`check-catalog: use "catalog:", "catalog:<name>" or "workspace:*"; add the version to pnpm-workspace.yaml\n` +
			`${problems.map((line) => `  ${line}`).join('\n')}\n`,
	);

	process.exit(1);
}
