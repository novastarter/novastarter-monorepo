import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Project, ProjectManifest, ProjectRootDir, ProjectRootDirRealPath } from '@pnpm/types';
import { load } from 'js-yaml';

/**
 * Discovers the workspace packages declared in `pnpm-workspace.yaml`.
 *
 * @param workspaceRoot - Directory holding `pnpm-workspace.yaml`.
 * @returns Every matched directory that holds a `package.json`, sorted by path.
 * @throws When a workspace pattern uses glob syntax this module does not support.
 */
export async function findWorkspacePackages(workspaceRoot: string): Promise<Project[]> {
	// 1. Split the declared patterns into includes and excludes
	const { include, exclude } = await readWorkspacePatterns(workspaceRoot);

	// 2. Expand the excludes first, so an included directory can be dropped by name
	const expandExcluded = () => Promise.all(exclude.map((pattern) => expandPattern(workspaceRoot, pattern)));
	const excluded = new Set(await expandExcluded().then((result) => result.flat()));

	const expandIncluded = () => Promise.all(include.map((pattern) => expandPattern(workspaceRoot, pattern)));
	const included = new Set(await expandIncluded().then((result) => result.flat()));

	const directories = [...included].filter((directory) => !excluded.has(directory));

	// 3. Read the manifests in parallel and drop the directories that turned out not to be packages
	const manifests = await Promise.all(
		directories.map((directory) => readProject(join(workspaceRoot, directory, 'package.json'))),
	);

	const projects: Project[] = [];

	for (const project of manifests) {
		if (project !== null) {
			projects.push(project);
		}
	}

	// 4. Stable ordering so downstream graph traversal and release notes don't depend on FS order
	return projects.sort((a, b) => a.rootDir.localeCompare(b.rootDir));
}

/**
 * Read the `packages` patterns from `pnpm-workspace.yaml` and split them into includes and excludes.
 *
 * @param workspaceRoot - Directory holding `pnpm-workspace.yaml`.
 * @returns Include patterns as written and exclude patterns with their leading `!` removed.
 */
export async function readWorkspacePatterns(workspaceRoot: string): Promise<{ include: string[]; exclude: string[] }> {
	// 1. A missing `packages` key means no workspace packages at all, not an error
	const raw = await readFile(join(workspaceRoot, 'pnpm-workspace.yaml'), 'utf8');
	const parsed = load(raw) as { packages?: string[] } | undefined;
	const patterns = parsed?.packages ?? [];

	const include: string[] = [];
	const exclude: string[] = [];

	// 2. pnpm marks excludes with a leading `!`, the same way `.gitignore` negates patterns
	for (const pattern of patterns) {
		if (pattern.startsWith('!')) {
			exclude.push(pattern.slice(1));
		} else {
			include.push(pattern);
		}
	}

	return { include, exclude };
}

/**
 * Expands a workspace pattern into the directories it matches, relative to the workspace root.
 *
 * Only the glob syntax pnpm workspaces actually use is supported: literal segments, `*` for a
 * single segment and `**` for any depth. Anything else throws rather than quietly matching
 * nothing, which would drop a package out of the release without anyone noticing.
 *
 * @param workspaceRoot - Directory the pattern is relative to.
 * @param pattern - Workspace pattern, e.g. `packages/*`.
 * @returns Matched directories relative to the workspace root, without a trailing slash.
 * @throws When a segment mixes `*` with literal text.
 */
export async function expandPattern(workspaceRoot: string, pattern: string): Promise<string[]> {
	// 1. Drop empty and `.` segments, so `./packages/*` and `packages/*` behave the same
	const segments = pattern.split('/').filter((segment) => segment !== '' && segment !== '.');
	let directories = [''];

	// 2. Walk the pattern segment by segment, widening the candidate set at every wildcard
	for (const segment of segments) {
		if (segment === '**') {
			directories = await Promise.all(directories.map((dir) => collectDescendants(workspaceRoot, dir))).then((result) =>
				result.flat(),
			);
		} else if (segment === '*') {
			directories = await Promise.all(directories.map((dir) => readSubdirectories(workspaceRoot, dir))).then((result) =>
				result.flat(),
			);
		} else if (segment.includes('*')) {
			throw new Error(`Unsupported workspace pattern '${pattern}': partial wildcards are not handled`);
		} else {
			directories = directories.map((dir) => (dir ? `${dir}/${segment}` : segment));
		}
	}

	return directories;
}

/**
 * List the direct subdirectories of a directory, skipping `node_modules`.
 *
 * @param workspaceRoot - Directory the paths are relative to.
 * @param directory - Directory to list, relative to the workspace root; empty for the root itself.
 * @returns Subdirectories relative to the workspace root, or an empty list when the directory does not exist.
 */
export async function readSubdirectories(workspaceRoot: string, directory: string): Promise<string[]> {
	let entries;

	// 1. A pattern may point at a directory that doesn't exist in this checkout
	try {
		entries = await readdir(join(workspaceRoot, directory), { withFileTypes: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return [];
		}

		throw error;
	}

	const subdirectories: string[] = [];

	// 2. `node_modules` never holds workspace packages and would make `**` patterns crawl every dependency
	for (const entry of entries) {
		if (!entry.isDirectory() || entry.name === 'node_modules') continue;

		subdirectories.push(directory ? `${directory}/${entry.name}` : entry.name);
	}

	return subdirectories;
}

/**
 * List a directory together with all its descendants, depth first.
 *
 * @param workspaceRoot - Directory the paths are relative to.
 * @param directory - Directory to start from, relative to the workspace root.
 * @returns The directory itself followed by every nested directory.
 */
export async function collectDescendants(workspaceRoot: string, directory: string): Promise<string[]> {
	// 1. The directory itself matches `**` too, which is why it leads the result
	const children = await readSubdirectories(workspaceRoot, directory);
	const nested = await Promise.all(children.map((child) => collectDescendants(workspaceRoot, child)));

	return [directory, ...nested.flat()];
}

/**
 * Read a `package.json` into a pnpm `Project`, with a writer that preserves the file's formatting.
 *
 * @param manifestPath - Absolute path of the `package.json`.
 * @returns The project, or `null` when the file does not exist.
 */
export async function readProject(manifestPath: string): Promise<Project | null> {
	let raw: string;

	// 1. Matched directories don't necessarily hold a package
	try {
		raw = await readFile(manifestPath, 'utf8');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return null;
		}

		throw error;
	}

	// 2. Keep the original text around, so a later write can copy its indentation
	const manifest = JSON.parse(raw) as ProjectManifest;
	const rootDir = resolve(manifestPath, '..');

	return {
		rootDir: rootDir as ProjectRootDir,
		rootDirRealPath: rootDir as ProjectRootDirRealPath,
		manifest,
		writeProjectManifest: async (updated: ProjectManifest) => {
			await writeFile(manifestPath, serializeManifest(updated, raw), 'utf8');
		},
	};
}

/**
 * Writes the manifest back using the indentation and trailing newline the file already had, so
 * version bumps don't reformat every package.json in the workspace.
 *
 * @param manifest - Manifest to serialize.
 * @param original - Original file content the formatting is copied from.
 * @returns The JSON text to write.
 */
export function serializeManifest(manifest: ProjectManifest, original: string): string {
	// 1. The indentation of the second line is the indentation of the whole file; tabs when there is none
	const indentMatch = /^[^\n]*\n([ \t]+)/.exec(original);
	const indent = indentMatch?.[1] ?? '\t';
	const trailingNewline = original.endsWith('\n') ? '\n' : '';

	return `${JSON.stringify(manifest, null, indent)}${trailingNewline}`;
}
