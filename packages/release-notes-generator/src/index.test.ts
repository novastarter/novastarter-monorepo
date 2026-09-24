/**
 * Tests of `release-notes-generator/index`.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NewChangesetWithCommit } from '@changesets/types';
import { afterEach, beforeEach, describe, expect, type MockInstance, test, vi } from 'vitest';
import type { Changesets, PackageVersion } from './types.js';
import { processPackages } from './utils/process-packages.js';

/**
 * Result the stubbed `processPackages` resolves to, plus an optional failure it rejects with; single tests
 * overwrite its fields to drive the headline, the GitHub outputs and the error path.
 *
 * Hoisted because `vi.mock` factories run before the imports of this file are evaluated.
 */
const mockVersions = vi.hoisted(() => ({
	mainVersion: undefined as string | undefined,
	isPrerelease: false,
	prereleaseId: undefined as string | undefined,
	packageVersions: [] as PackageVersion[],
	failure: undefined as Error | undefined,
}));

// `processPackages` walks the workspace on disk and rewrites manifests, so it is the one dependency that is stubbed
vi.mock('./utils/process-packages.js', () => ({
	processPackages: vi.fn(async () => {
		// Tests simulate a failing `changesets` run by setting `failure`; every other call resolves the versions
		if (mockVersions.failure) throw mockVersions.failure;

		return mockVersions;
	}),
}));

/**
 * Listeners on `beforeExit` before the module under test was imported, so the one it adds can be told apart.
 */
const listenersBefore = process.listeners('beforeExit');

// Imported after the listeners are captured, since the module registers its hook at import
const { run, getReleaseLine } = await import('./index.js');

/**
 * The hook the module registered at import.
 *
 * It is taken off the process again, so the test runner never triggers it on its way out; the tests call it by
 * hand instead.
 */
const beforeExitHook = process.listeners('beforeExit').find((listener) => !listenersBefore.includes(listener))!;

process.removeListener('beforeExit', beforeExitHook);

/**
 * Temporary directory holding the fake step output file.
 */
let outputDir: string;

/**
 * Spy on the standard output the notes are printed to, replaced for every test.
 */
let log: MockInstance;

/**
 * Spy on the warning output, replaced for every test.
 */
let warn: MockInstance;

/**
 * Everything the notes printer was called with during the test, joined into one string.
 *
 * @returns The printed text.
 */
function printed(): string {
	return log.mock.calls.map((call) => call.join(' ')).join('\n');
}

/**
 * Build the changeset map the way the changelog functions fill it.
 *
 * @param summary - Summary of the single changeset.
 * @returns A map with one changeset for `@novastarter/ui`.
 */
function changesetsWith(summary: string): Changesets {
	return new Map([
		[
			'random-changeset-name',
			{
				summary,
				notice: undefined,
				commit: 'abc1234',
				releases: [{ name: '@novastarter/ui', type: 'patch' as const }],
			},
		],
	]);
}

beforeEach(async () => {
	// The notes go to stdout, so they are captured instead of cluttering the test output
	log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
	warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

	mockVersions.mainVersion = undefined;
	mockVersions.isPrerelease = false;
	mockVersions.prereleaseId = undefined;
	mockVersions.packageVersions = [];
	mockVersions.failure = undefined;

	outputDir = await mkdtemp(join(tmpdir(), 'release-notes-generator-'));
});

afterEach(async () => {
	vi.restoreAllMocks();

	// The hook failure test sets a failing exit code; it must not leak into the test runner's own exit
	process.exitCode = undefined;

	await rm(outputDir, { recursive: true, force: true });
});

describe('run', () => {
	test('should print the notes under the main version headline', async () => {
		mockVersions.mainVersion = '1.2.3';
		mockVersions.packageVersions = [{ name: '@novastarter/ui', version: '2.0.1' }];

		await run(changesetsWith('Fix the thing'), { workspaceRoot: 'mock-workspace' });

		expect(printed()).toMatchInlineSnapshot(`
			"==============================================================
			Novastarter v1.2.3
			==============================================================
			### 🐛 Bug Fixes & Optimizations

			- **@novastarter/ui**
			  - Fix the thing ([abc1234](https://github.com/novastarter/novastarter-monorepo/commit/abc1234))

			### 📦 Published Versions

			- \`@novastarter/ui@2.0.1\`
			=============================================================="
		`);

		expect(warn).not.toHaveBeenCalled();
	});

	test('should fall back to a generic headline without a main version', async () => {
		await run(changesetsWith('Fix the thing'), { workspaceRoot: 'mock-workspace' });

		expect(printed()).toContain('\nNovastarter release notes\n');
		expect(printed()).not.toContain('Novastarter v');
	});

	test('should warn but still print when nothing was released', async () => {
		await run(new Map(), { workspaceRoot: 'mock-workspace' });

		expect(warn).toHaveBeenCalledWith('WARN: No processable changesets found');
		expect(printed()).toContain('Novastarter release notes');
	});

	test('should not warn when only versions were published', async () => {
		// A dependency-only bump has versions but no changeset text, which is still something to release
		mockVersions.packageVersions = [{ name: '@novastarter/ui', version: '2.0.1' }];

		await run(new Map(), { workspaceRoot: 'mock-workspace' });

		expect(warn).not.toHaveBeenCalled();
	});

	test('should forward the forced version and the workspace root to processPackages', async () => {
		// The deployment inputs are read by the caller and handed down; `run` must pass them on untouched
		await run(new Map(), { workspaceRoot: 'mock-workspace', forcedVersion: '2.0.0' });

		expect(processPackages).toHaveBeenCalledWith({ workspaceRoot: 'mock-workspace', forcedVersion: '2.0.0' });
	});

	test('should write the version, prerelease state and notes to the step output file', async () => {
		const outputFile = join(outputDir, 'output');

		mockVersions.mainVersion = '1.2.3';
		mockVersions.packageVersions = [{ name: '@novastarter/ui', version: '2.0.1' }];

		await run(changesetsWith('Fix the thing'), { workspaceRoot: 'mock-workspace', githubOutput: outputFile });

		const output = await readFile(outputFile, 'utf8');

		// The heredoc delimiter is random per run, so it is captured here and stitched into the expectation
		const delimiter = output.match(/^NOVASTARTER_RELEASE_NOTES<<(\S+)$/m)?.[1];

		expect(delimiter).toMatch(/^EOF_RELEASE_NOTES_[0-9a-f]{16}$/);

		expect(output).toBe(
			`NOVASTARTER_VERSION=1.2.3\nNOVASTARTER_PRERELEASE=false\nNOVASTARTER_RELEASE_NOTES<<${delimiter}\n### 🐛 Bug Fixes & Optimizations\n\n- **@novastarter/ui**\n  - Fix the thing ([abc1234](https://github.com/novastarter/novastarter-monorepo/commit/abc1234))\n\n### 📦 Published Versions\n\n- \`@novastarter/ui@2.0.1\`\n${delimiter}\n`,
		);
	});

	test('should use a fresh heredoc delimiter on every run', async () => {
		const outputFile = join(outputDir, 'output');

		await run(new Map(), { workspaceRoot: 'mock-workspace', githubOutput: outputFile });
		await run(new Map(), { workspaceRoot: 'mock-workspace', githubOutput: outputFile });

		const output = await readFile(outputFile, 'utf8');

		// Two runs append two note blocks; a delimiter that repeats could be forged by the first run's notes
		const delimiters = output.match(/^NOVASTARTER_RELEASE_NOTES<<(\S+)$/gm) ?? [];

		expect(delimiters).toHaveLength(2);
		expect(new Set(delimiters).size).toBe(2);
	});

	test('should keep a forged delimiter line inside the notes', async () => {
		const outputFile = join(outputDir, 'output');

		// A crafted summary whose line equals the old fixed delimiter must not end the heredoc early and spill
		// the lines after it into step outputs
		await run(changesetsWith('Honest change\nEOF_RELEASE_NOTES\nFORGED_OUTPUT=1'), {
			workspaceRoot: 'mock-workspace',
			githubOutput: outputFile,
		});

		const output = await readFile(outputFile, 'utf8');

		// The forged lines survive verbatim inside the notes, no bare delimiter line exists, and the block ends
		// at the random delimiter
		expect(output).toMatch(/^ {4}EOF_RELEASE_NOTES$/m);
		expect(output).toMatch(/^ {4}FORGED_OUTPUT=1$/m);
		expect(output).not.toMatch(/^EOF_RELEASE_NOTES$/m);
		expect(output).toMatch(/EOF_RELEASE_NOTES_[0-9a-f]{16}\n$/);
	});

	test('should leave out the version outputs that are unknown', async () => {
		const outputFile = join(outputDir, 'output');

		await run(new Map(), { workspaceRoot: 'mock-workspace', githubOutput: outputFile });

		const output = await readFile(outputFile, 'utf8');

		expect(output).not.toContain('NOVASTARTER_VERSION=');
		expect(output).not.toContain('NOVASTARTER_PRERELEASE_ID=');
		expect(output).toContain('NOVASTARTER_PRERELEASE=false\n');
	});

	test('should expose the prerelease id in the step outputs', async () => {
		const outputFile = join(outputDir, 'output');

		mockVersions.mainVersion = '1.2.3-beta.0';
		mockVersions.isPrerelease = true;
		mockVersions.prereleaseId = 'beta';

		await run(new Map(), { workspaceRoot: 'mock-workspace', githubOutput: outputFile });

		const output = await readFile(outputFile, 'utf8');

		expect(output).toContain(
			'NOVASTARTER_VERSION=1.2.3-beta.0\nNOVASTARTER_PRERELEASE=true\nNOVASTARTER_PRERELEASE_ID=beta\n',
		);
	});

	test('should append to an existing step output file', async () => {
		// Earlier workflow steps already wrote their outputs; overwriting the file would lose them
		const outputFile = join(outputDir, 'output');

		await run(new Map(), { workspaceRoot: 'mock-workspace', githubOutput: outputFile });
		await run(new Map(), { workspaceRoot: 'mock-workspace', githubOutput: outputFile });

		const output = await readFile(outputFile, 'utf8');

		expect(output.match(/NOVASTARTER_PRERELEASE=false/g)).toHaveLength(2);
	});

	test('should not touch the filesystem outside a GitHub workflow', async () => {
		await run(changesetsWith('Fix the thing'), { workspaceRoot: 'mock-workspace' });

		await expect(readFile(join(outputDir, 'output'), 'utf8')).rejects.toThrow(/ENOENT/);
	});
});

describe('beforeExit hook', () => {
	test('should be registered at import', () => {
		expect(beforeExitHook).toBeTypeOf('function');
	});

	test('should print the changesets collected through the release line hook and exit', async () => {
		const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

		const changeset: NewChangesetWithCommit = {
			id: 'random-changeset-name',
			summary: 'Fix the thing',
			commit: 'abc1234',
			releases: [{ name: '@novastarter/ui', type: 'patch' }],
		};

		// `changesets` feeds the changelog functions; the hook must see the very same map afterwards
		await getReleaseLine(changeset, 'patch', null);

		await (beforeExitHook as () => Promise<void>)();

		expect(printed()).toContain('Fix the thing ([abc1234]');
		expect(exit).toHaveBeenCalledTimes(1);
	});

	test('should report the error and exit with a failure code when the run fails', async () => {
		const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		// `run` throws when the versions on disk are inconsistent; the hook must surface that instead of dying
		// on an unhandled rejection inside `beforeExit`, which would print nothing
		mockVersions.failure = new Error(
			'Main version of the NOVASTARTER_VERSION environment variable ("nope") is missing or invalid',
		);

		await (beforeExitHook as () => Promise<void>)();

		expect(error).toHaveBeenCalledTimes(1);
		expect(exit).toHaveBeenCalledTimes(1);
		expect(process.exitCode).toBe(1);
	});
});
