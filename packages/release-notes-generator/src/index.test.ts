/**
 * Tests of `release-notes-generator/index`.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NewChangesetWithCommit } from '@changesets/types';
import { afterEach, beforeEach, describe, expect, type MockInstance, test, vi } from 'vitest';
import type { Changesets, PackageVersion } from './types.js';

/**
 * Result the stubbed `processPackages` resolves to; single tests overwrite its fields to drive the headline and
 * the GitHub outputs.
 *
 * Hoisted because `vi.mock` factories run before the imports of this file are evaluated.
 */
const mockVersions = vi.hoisted(() => ({
	mainVersion: undefined as string | undefined,
	isPrerelease: false,
	prereleaseId: undefined as string | undefined,
	packageVersions: [] as PackageVersion[],
}));

// `processPackages` walks the workspace on disk and rewrites manifests, so it is the one dependency that is stubbed
vi.mock('./utils/process-packages.js', () => ({ processPackages: async () => mockVersions }));

/**
 * Listeners on `beforeExit` before the module under test was imported, so the one it adds can be told apart.
 */
const listenersBefore = process.listeners('beforeExit');

// Imported after the listeners are captured, since the module registers its hook at import
const { run, default: changelogFunctions } = await import('./index.js');

/**
 * The hook the module registered at import.
 *
 * It is taken off the process again, so the test runner never triggers it on its way out; the tests call it by
 * hand instead.
 */
const beforeExitHook = process.listeners('beforeExit').find((listener) => !listenersBefore.includes(listener))!;

process.removeListener('beforeExit', beforeExitHook);

/**
 * Temporary directory holding the fake `GITHUB_OUTPUT` file.
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
	// 1. The notes go to stdout, so they are captured instead of cluttering the test output
	log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
	warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

	// 2. A GitHub runner sets `GITHUB_OUTPUT` for real; it is unset here so no test appends to the workflow's file
	vi.stubEnv('GITHUB_OUTPUT', undefined);

	mockVersions.mainVersion = undefined;
	mockVersions.isPrerelease = false;
	mockVersions.prereleaseId = undefined;
	mockVersions.packageVersions = [];

	outputDir = await mkdtemp(join(tmpdir(), 'release-notes-generator-'));
});

afterEach(async () => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	await rm(outputDir, { recursive: true, force: true });
});

describe('run', () => {
	test('should print the notes under the main version headline', async () => {
		mockVersions.mainVersion = '1.2.3';
		mockVersions.packageVersions = [{ name: '@novastarter/ui', version: '2.0.1' }];

		await run(changesetsWith('Fix the thing'));

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
		await run(changesetsWith('Fix the thing'));

		expect(printed()).toContain('\nNovastarter release notes\n');
		expect(printed()).not.toContain('Novastarter v');
	});

	test('should warn but still print when nothing was released', async () => {
		await run(new Map());

		expect(warn).toHaveBeenCalledWith('WARN: No processable changesets found');
		expect(printed()).toContain('Novastarter release notes');
	});

	test('should not warn when only versions were published', async () => {
		// 1. A dependency-only bump has versions but no changeset text, which is still something to release
		mockVersions.packageVersions = [{ name: '@novastarter/ui', version: '2.0.1' }];

		await run(new Map());

		expect(warn).not.toHaveBeenCalled();
	});

	test('should write the version, prerelease state and notes to GITHUB_OUTPUT', async () => {
		const outputFile = join(outputDir, 'output');

		vi.stubEnv('GITHUB_OUTPUT', outputFile);
		mockVersions.mainVersion = '1.2.3';
		mockVersions.packageVersions = [{ name: '@novastarter/ui', version: '2.0.1' }];

		await run(changesetsWith('Fix the thing'));

		await expect(readFile(outputFile, 'utf8')).resolves.toMatchInlineSnapshot(`
			"NOVASTARTER_VERSION=1.2.3
			NOVASTARTER_PRERELEASE=false
			NOVASTARTER_RELEASE_NOTES<<EOF_RELEASE_NOTES
			### 🐛 Bug Fixes & Optimizations

			- **@novastarter/ui**
			  - Fix the thing ([abc1234](https://github.com/novastarter/novastarter-monorepo/commit/abc1234))

			### 📦 Published Versions

			- \`@novastarter/ui@2.0.1\`
			EOF_RELEASE_NOTES
			"
		`);
	});

	test('should leave out the version outputs that are unknown', async () => {
		const outputFile = join(outputDir, 'output');

		vi.stubEnv('GITHUB_OUTPUT', outputFile);

		await run(new Map());

		const output = await readFile(outputFile, 'utf8');

		expect(output).not.toContain('NOVASTARTER_VERSION=');
		expect(output).not.toContain('NOVASTARTER_PRERELEASE_ID=');
		expect(output).toContain('NOVASTARTER_PRERELEASE=false\n');
	});

	test('should expose the prerelease id in GITHUB_OUTPUT', async () => {
		const outputFile = join(outputDir, 'output');

		vi.stubEnv('GITHUB_OUTPUT', outputFile);
		mockVersions.mainVersion = '1.2.3-beta.0';
		mockVersions.isPrerelease = true;
		mockVersions.prereleaseId = 'beta';

		await run(new Map());

		const output = await readFile(outputFile, 'utf8');

		expect(output).toContain(
			'NOVASTARTER_VERSION=1.2.3-beta.0\nNOVASTARTER_PRERELEASE=true\nNOVASTARTER_PRERELEASE_ID=beta\n',
		);
	});

	test('should append to an existing GITHUB_OUTPUT file', async () => {
		// 1. Earlier workflow steps already wrote their outputs; overwriting the file would lose them
		const outputFile = join(outputDir, 'output');

		vi.stubEnv('GITHUB_OUTPUT', outputFile);

		await run(new Map());
		await run(new Map());

		const output = await readFile(outputFile, 'utf8');

		expect(output.match(/NOVASTARTER_PRERELEASE=false/g)).toHaveLength(2);
	});

	test('should not touch the filesystem outside a GitHub workflow', async () => {
		await run(changesetsWith('Fix the thing'));

		await expect(readFile(join(outputDir, 'output'), 'utf8')).rejects.toThrow(/ENOENT/);
	});
});

describe('beforeExit hook', () => {
	test('should be registered at import', () => {
		expect(beforeExitHook).toBeTypeOf('function');
	});

	test('should print the changesets collected through the default export and exit', async () => {
		const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

		const changeset: NewChangesetWithCommit = {
			id: 'random-changeset-name',
			summary: 'Fix the thing',
			commit: 'abc1234',
			releases: [{ name: '@novastarter/ui', type: 'patch' }],
		};

		// 1. `changesets` feeds the changelog functions; the hook must see the very same map afterwards
		await changelogFunctions.getReleaseLine(changeset, 'patch', null);

		await (beforeExitHook as () => Promise<void>)();

		expect(printed()).toContain('Fix the thing ([abc1234]');
		expect(exit).toHaveBeenCalledTimes(1);
	});
});
