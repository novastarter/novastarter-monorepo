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

let packages: Partial<Project>[] = [];

vi.doMock('./find-workspace-packages.js', () => ({
	findWorkspacePackages: () => packages,
}));

beforeEach(() => {
	vi.unstubAllEnvs();
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

// Imported after the mocks are registered, so the module picks up the stubbed `node:fs`
// @ts-ignore
const { processPackages } = await import('./process-packages.js');

test('should return main version and package versions', async () => {
	packages = [generatePackage('main', '1.0.0'), generatePackage('example', '1.1.0')];

	const { mainVersion, isPrerelease, packageVersions } = await processPackages();

	expect(mainVersion).toEqual('1.0.0');
	expect(isPrerelease).toEqual(false);
	expect(packageVersions).toEqual([{ name: 'example', version: '1.1.0' }]);
});

test('should fail if main version is missing', async () => {
	await expect(() => processPackages()).rejects.toThrow(/Main version .* is missing or invalid/);
});

test('should work without a main package', async () => {
	delete mockConfig.mainPackage;
	packages = [generatePackage('example', '1.1.0')];

	const { mainVersion, isPrerelease, prereleaseId, packageVersions } = await processPackages();

	expect(mainVersion).toBeUndefined();
	expect(isPrerelease).toEqual(false);
	expect(prereleaseId).toBeUndefined();
	expect(packageVersions).toEqual([{ name: 'example', version: '1.1.0' }]);
});

test('should take the prerelease state from changesets without a main package', async () => {
	delete mockConfig.mainPackage;
	mockChangesetPreFile = JSON.stringify({ tag: 'beta' });
	packages = [generatePackage('example', '1.1.0-beta.0')];

	const { mainVersion, isPrerelease, prereleaseId } = await processPackages();

	expect(mainVersion).toBeUndefined();
	expect(isPrerelease).toEqual(true);
	expect(prereleaseId).toEqual('beta');
});

test('should respect manually defined version', async () => {
	packages = [generatePackage('main', '1.0.0'), generatePackage('example', '1.1.0')];

	vi.stubEnv('NOVASTARTER_VERSION', '2.0.0');

	const { mainVersion, packageVersions } = await processPackages();

	expect(mainVersion).toEqual('2.0.0');
	expect(packageVersions).toEqual([{ name: 'example', version: '1.1.0' }]);
});

test('should respect manually defined version without a main package', async () => {
	delete mockConfig.mainPackage;
	packages = [generatePackage('example', '1.1.0')];

	vi.stubEnv('NOVASTARTER_VERSION', '2.0.0');

	const { mainVersion, packageVersions } = await processPackages();

	expect(mainVersion).toEqual('2.0.0');
	expect(packageVersions).toEqual([{ name: 'example', version: '1.1.0' }]);
});

test('should fail with manually defined version when not in prerelease mode', async () => {
	vi.stubEnv('NOVASTARTER_VERSION', '2.0.0-beta.0');

	await expect(() => processPackages()).rejects.toThrow(
		`Main version is a prerelease but changesets isn't in prerelease mode`,
	);
});

test('should work with manually defined version when in prerelease mode', async () => {
	mockChangesetPreFile = JSON.stringify({ tag: 'beta' });
	vi.stubEnv('NOVASTARTER_VERSION', '2.0.0-beta.0');

	const { mainVersion, isPrerelease, prereleaseId } = await processPackages();

	expect(mainVersion).toEqual('2.0.0-beta.0');
	expect(isPrerelease).toEqual(true);
	expect(prereleaseId).toEqual('beta');
});

test('should pass in prerelease mode', async () => {
	mockChangesetPreFile = JSON.stringify({ tag: 'beta' });
	packages = [generatePackage('main', '1.0.0-beta.0')];

	const { mainVersion, isPrerelease, prereleaseId } = await processPackages();

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

	const { packageVersions } = await processPackages();

	expect(packageVersions).toEqual(expect.arrayContaining([{ name: 'target', version: '1.1.1' }]));
});

test('should return correct version for linked packages in prerelease mode', async () => {
	mockChangesetPreFile = JSON.stringify({ tag: 'beta' });

	packages = [
		generatePackage('main', '1.0.0-beta.0'),
		generatePackage('trigger', '2.0.0-beta.0'),
		generatePackage('target', '1.1.0', { bumped: false }),
	];

	const { packageVersions } = await processPackages();

	expect(packageVersions).toEqual(expect.arrayContaining([{ name: 'target', version: '1.1.1-beta.0' }]));
});

test('should return correct version for linked packages in prerelease mode with existing prerelease version', async () => {
	mockChangesetPreFile = JSON.stringify({ tag: 'beta' });

	packages = [
		generatePackage('main', '1.0.0-beta.0'),
		generatePackage('trigger', '2.0.0-beta.0'),
		generatePackage('target', '1.1.1-beta.0', { bumped: false }),
	];

	const { packageVersions } = await processPackages();

	expect(packageVersions).toEqual(expect.arrayContaining([{ name: 'target', version: '1.1.1-beta.1' }]));
});

test('should ignore private packages', async () => {
	mockChangesetPreFile = JSON.stringify({ tag: 'beta' });

	const privatePackage = generatePackage('private', '0.0.1', { additional: { private: true } });

	packages = [generatePackage('main', '1.0.0'), privatePackage];

	const { packageVersions } = await processPackages();

	expect(privatePackage.writeProjectManifest).not.toHaveBeenCalled();
	expect(packageVersions).not.toContainEqual(expect.objectContaining({ name: 'private' }));
});
