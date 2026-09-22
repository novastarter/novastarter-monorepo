/**
 * Tests of `release-notes-generator/utils/process-packages`.
 */
import type { Project } from '@pnpm/types';
import { beforeEach, expect, test, vi } from 'vitest';
import type { Config } from '../types.js';

/**
 * Mutable config shared with the module under test, so single tests can drop the main package.
 *
 * Hoisted because `vi.mock` factories run before the imports of this file are evaluated.
 */
const mockConfig = vi.hoisted((): Partial<Config> => ({
	mainPackage: 'main',
	untypedPackageTitles: {},
	packageOrder: [],
	linkedPackages: [['trigger', 'target']],
}));

vi.mock('../config.js', () => ({ default: mockConfig }));

/**
 * Content served for `.changeset/pre.json`; `undefined` means `changesets` is not in prerelease mode.
 */
let mockChangesetPreFile: string | undefined = undefined;

// Only the file system calls the module makes are stubbed: a package counts as bumped when its root starts with
// `mock`, changelog removal is a no-op, and `pre.json` holds whatever the test put into `mockChangesetPreFile`
vi.doMock('node:fs', () => {
	return {
		existsSync: (path: string) => {
			if (path.startsWith('mock')) return true;
			return false;
		},
		unlinkSync: () => null,
		readFileSync: (path: string) => {
			if (path.endsWith('pre.json')) return mockChangesetPreFile;
			return;
		},
	};
});

/**
 * Workspace packages the stubbed `findWorkspacePackages` returns.
 */
let packages: Partial<Project>[] = [];

vi.doMock('./find-workspace-packages.js', () => ({
	findWorkspacePackages: () => packages,
}));

beforeEach(() => {
	mockChangesetPreFile = undefined;
	packages = [];
	mockConfig.mainPackage = 'main';
});

/**
 * Build a fake workspace package.
 *
 * @param name - Package name.
 * @param version - Package version as written by `changesets`.
 * @param opts - `bumped: false` makes the package look untouched by `changesets`; `additional` is merged into the
 * manifest.
 * @returns A partial pnpm project with a spied manifest writer.
 */
const generatePackage = (name: string, version: string, opts?: Record<string, any>): Partial<Project> => ({
	rootDir: (opts?.['bumped'] !== false ? 'mock' : 'nomock') as Project['rootDir'],
	manifest: {
		name,
		version,
		...opts?.['additional'],
	},
	writeProjectManifest: vi.fn(),
});

/**
 * Function under test, imported after the mocks are registered so the module picks up the stubbed `node:fs`.
 */
const { processPackages } = await import('./process-packages.js');

test('should return main version and package versions', async () => {
	packages = [generatePackage('main', '1.0.0'), generatePackage('example', '1.1.0')];

	const { mainVersion, isPrerelease, packageVersions } = await processPackages({ workspaceRoot: 'mock-workspace' });

	expect(mainVersion).toEqual('1.0.0');
	expect(isPrerelease).toEqual(false);
	expect(packageVersions).toEqual([{ name: 'example', version: '1.1.0' }]);
});

test('should fail if main version is missing', async () => {
	await expect(() => processPackages({ workspaceRoot: 'mock-workspace' })).rejects.toThrow(
		`Main version of the 'main' package is missing or invalid`,
	);
});

test('should name the environment variable when the forced version is invalid', async () => {
	// 1. A malformed forced version is blamed on its source, never on an undefined main package
	await expect(() =>
		processPackages({ workspaceRoot: 'mock-workspace', forcedVersion: 'not-a-version' }),
	).rejects.toThrow(
		'Main version of the NOVASTARTER_VERSION environment variable ("not-a-version") is missing or invalid',
	);
});

test('should work without a main package', async () => {
	delete mockConfig.mainPackage;
	packages = [generatePackage('example', '1.1.0')];

	const { mainVersion, isPrerelease, prereleaseId, packageVersions } = await processPackages({
		workspaceRoot: 'mock-workspace',
	});

	expect(mainVersion).toBeUndefined();
	expect(isPrerelease).toEqual(false);
	expect(prereleaseId).toBeUndefined();
	expect(packageVersions).toEqual([{ name: 'example', version: '1.1.0' }]);
});

test('should take the prerelease state from changesets without a main package', async () => {
	delete mockConfig.mainPackage;
	mockChangesetPreFile = JSON.stringify({ mode: 'pre', tag: 'beta' });
	packages = [generatePackage('example', '1.1.0-beta.0')];

	const { mainVersion, isPrerelease, prereleaseId } = await processPackages({ workspaceRoot: 'mock-workspace' });

	expect(mainVersion).toBeUndefined();
	expect(isPrerelease).toEqual(true);
	expect(prereleaseId).toEqual('beta');
});

test('should not read a prerelease tag from a finished prerelease cycle', async () => {
	// 1. `changesets pre exit` keeps `pre.json` on disk with `mode: "exit"`, so the stable release right after a
	//    prerelease cycle must not be reported as a prerelease
	delete mockConfig.mainPackage;
	mockChangesetPreFile = JSON.stringify({ mode: 'exit', tag: 'beta' });
	packages = [generatePackage('example', '1.1.0')];

	const { mainVersion, isPrerelease, prereleaseId } = await processPackages({ workspaceRoot: 'mock-workspace' });

	expect(mainVersion).toBeUndefined();
	expect(isPrerelease).toEqual(false);
	expect(prereleaseId).toBeUndefined();
});

test('should respect manually defined version', async () => {
	packages = [generatePackage('main', '1.0.0'), generatePackage('example', '1.1.0')];

	const { mainVersion, packageVersions } = await processPackages({
		workspaceRoot: 'mock-workspace',
		forcedVersion: '2.0.0',
	});

	expect(mainVersion).toEqual('2.0.0');
	expect(packageVersions).toEqual([{ name: 'example', version: '1.1.0' }]);
});

test('should respect manually defined version without a main package', async () => {
	delete mockConfig.mainPackage;
	packages = [generatePackage('example', '1.1.0')];

	const { mainVersion, packageVersions } = await processPackages({
		workspaceRoot: 'mock-workspace',
		forcedVersion: '2.0.0',
	});

	expect(mainVersion).toEqual('2.0.0');
	expect(packageVersions).toEqual([{ name: 'example', version: '1.1.0' }]);
});

test('should fail with manually defined version when not in prerelease mode', async () => {
	await expect(() =>
		processPackages({ workspaceRoot: 'mock-workspace', forcedVersion: '2.0.0-beta.0' }),
	).rejects.toThrow(`Main version is a prerelease but changesets isn't in prerelease mode`);
});

test('should work with manually defined version when in prerelease mode', async () => {
	mockChangesetPreFile = JSON.stringify({ mode: 'pre', tag: 'beta' });

	const { mainVersion, isPrerelease, prereleaseId } = await processPackages({
		workspaceRoot: 'mock-workspace',
		forcedVersion: '2.0.0-beta.0',
	});

	expect(mainVersion).toEqual('2.0.0-beta.0');
	expect(isPrerelease).toEqual(true);
	expect(prereleaseId).toEqual('beta');
});

test('should pass in prerelease mode', async () => {
	mockChangesetPreFile = JSON.stringify({ mode: 'pre', tag: 'beta' });
	packages = [generatePackage('main', '1.0.0-beta.0')];

	const { mainVersion, isPrerelease, prereleaseId } = await processPackages({ workspaceRoot: 'mock-workspace' });

	expect(mainVersion).toEqual('1.0.0-beta.0');
	expect(isPrerelease).toEqual(true);
	expect(prereleaseId).toEqual('beta');
});

test('should return correct version for linked packages', async () => {
	packages = [
		generatePackage('main', '1.0.0'),
		generatePackage('trigger', '2.0.0'),
		generatePackage('target', '1.1.0', { bumped: false }),
	];

	const { packageVersions } = await processPackages({ workspaceRoot: 'mock-workspace' });

	expect(packageVersions).toEqual(expect.arrayContaining([{ name: 'target', version: '1.1.1' }]));
});

test('should return correct version for linked packages in prerelease mode', async () => {
	mockChangesetPreFile = JSON.stringify({ mode: 'pre', tag: 'beta' });

	packages = [
		generatePackage('main', '1.0.0-beta.0'),
		generatePackage('trigger', '2.0.0-beta.0'),
		generatePackage('target', '1.1.0', { bumped: false }),
	];

	const { packageVersions } = await processPackages({ workspaceRoot: 'mock-workspace' });

	expect(packageVersions).toEqual(expect.arrayContaining([{ name: 'target', version: '1.1.1-beta.0' }]));
});

test('should return correct version for linked packages in prerelease mode with existing prerelease version', async () => {
	mockChangesetPreFile = JSON.stringify({ mode: 'pre', tag: 'beta' });

	packages = [
		generatePackage('main', '1.0.0-beta.0'),
		generatePackage('trigger', '2.0.0-beta.0'),
		generatePackage('target', '1.1.1-beta.0', { bumped: false }),
	];

	const { packageVersions } = await processPackages({ workspaceRoot: 'mock-workspace' });

	expect(packageVersions).toEqual(expect.arrayContaining([{ name: 'target', version: '1.1.1-beta.1' }]));
});

test('should ignore private packages', async () => {
	mockChangesetPreFile = JSON.stringify({ mode: 'pre', tag: 'beta' });

	const privatePackage = generatePackage('private', '0.0.1', { additional: { private: true } });

	packages = [generatePackage('main', '1.0.0'), privatePackage];

	const { packageVersions } = await processPackages({ workspaceRoot: 'mock-workspace' });

	expect(privatePackage.writeProjectManifest).not.toHaveBeenCalled();
	expect(packageVersions).not.toContainEqual(expect.objectContaining({ name: 'private' }));
});
