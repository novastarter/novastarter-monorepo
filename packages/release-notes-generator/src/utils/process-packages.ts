import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { Project } from '@pnpm/types';
import { createPkgGraph, type PackageNode } from '@pnpm/workspace.pkgs-graph';
import semver from 'semver';
import config from '../config.js';
import type { PackageVersion } from '../types.js';
import { findWorkspacePackages } from './find-workspace-packages.js';
import { sortByExternalOrder } from './sort.js';

/**
 * Collect the versions `changesets` wrote, remove its changelog files and apply the extra bumps from the config.
 *
 * Runs after `changesets` has versioned the workspace. A package counts as bumped when `changesets` generated a
 * `CHANGELOG.md` for it; that file is removed again because the release notes replace it. The headline version
 * comes from `NOVASTARTER_VERSION` or from the configured main package, and may be unknown when neither is set.
 *
 * @returns The headline version, its prerelease state and the published packages with their new versions.
 * @throws When the main package is configured but its version is missing or invalid, or when a prerelease version
 * is used outside of the `changesets` prerelease mode or with a different prerelease tag.
 */
export async function processPackages(): Promise<{
	mainVersion: string | undefined;
	isPrerelease: boolean;
	prereleaseId: string | undefined;
	packageVersions: PackageVersion[];
}> {
	// 1. The workspace is read once up front; the version map and the dependents graph are filled in on the way
	const workspacePackages = await findWorkspacePackages(process.cwd());
	const packageVersions = new Map<string, string>();
	let dependentsMap: Record<string, string[]> | undefined;

	// 2. A package counts as bumped when `changesets` generated a changelog for it, which also catches packages
	//    bumped solely because an internal dependency changed
	for (const localPackage of workspacePackages) {
		const { name, version } = localPackage.manifest;

		if (!name) {
			continue;
		}

		const changelogPath = join(localPackage.rootDir, 'CHANGELOG.md');

		if (existsSync(changelogPath)) {
			if (version && !localPackage.manifest.private) {
				packageVersions.set(name, version);
			}

			// 3. The release notes replace the changelog, so the file `changesets` generated is removed again
			unlinkSync(changelogPath);
		}
	}

	// 4. Work out the headline version before bumping anything, as the bumps depend on its prerelease state
	const { mainVersion, manualMainVersion, isPrerelease, prereleaseId } = getVersionInfo();

	// 5. A forced version overrides whatever `changesets` gave the main package, dependents included
	if (manualMainVersion && config.mainPackage) {
		await bumpPackage(config.mainPackage, mainVersion, true);
	}

	// 6. Linked packages follow their trigger with a patch bump unless `changesets` bumped them already
	for (const [trigger, target] of config.linkedPackages) {
		if (packageVersions.has(trigger) && !packageVersions.has(target)) {
			await bumpPackage(target, null, true);
		}
	}

	// 7. The main package and the untyped packages are not listed under the published versions
	return {
		mainVersion,
		isPrerelease,
		prereleaseId,
		packageVersions: Array.from(packageVersions, ([name, version]) => ({
			name,
			version,
		}))
			.filter(({ name }) => ![config.mainPackage, ...Object.keys(config.untypedPackageTitles)].includes(name))
			.sort(sortByExternalOrder(config.packageOrder, 'name')),
	};

	/**
	 * Determine the headline version and whether the release is a prerelease.
	 *
	 * @returns The headline version (if known), whether it was forced, and the prerelease state.
	 * @throws When the main package is configured but has no valid version, or the prerelease state is inconsistent.
	 */
	function getVersionInfo() {
		const manualMainVersion = process.env['NOVASTARTER_VERSION'];

		// 1. The forced version wins over the version `changesets` gave the main package
		const mainPackageVersion = config.mainPackage ? packageVersions.get(config.mainPackage) : undefined;
		const rawMainVersion = manualMainVersion ?? mainPackageVersion;

		// 2. Without a main package there is nothing to demand a version from; the prerelease state then comes from
		//    the `changesets` prerelease mode alone
		if (!rawMainVersion && !config.mainPackage) {
			const tag = readPrereleaseTag();

			return {
				mainVersion: undefined,
				manualMainVersion,
				isPrerelease: tag !== undefined,
				prereleaseId: tag,
			};
		}

		const mainVersion = semver.parse(rawMainVersion);

		if (!mainVersion) {
			// 3. Name the source the bad value came from: the forced variable, or the main package `changesets` was
			//    expected to version — either way the message must never print an undefined package
			const versionSource = manualMainVersion
				? `the NOVASTARTER_VERSION environment variable ("${manualMainVersion}")`
				: `the '${config.mainPackage}' package`;

			throw new Error(`Main version of ${versionSource} is missing or invalid`);
		}

		// 4. A prerelease version is only valid while `changesets` is in prerelease mode with the same tag
		const isPrerelease = mainVersion.prerelease.length > 0;
		let prereleaseId;

		if (isPrerelease) {
			const tag = readPrereleaseTag();

			if (tag === undefined) {
				throw new Error(`Main version is a prerelease but changesets isn't in prerelease mode`);
			}

			prereleaseId = mainVersion.prerelease[0];

			if (typeof prereleaseId !== 'string') {
				throw new Error(`Expected a string for prerelease identifier`);
			}

			if (prereleaseId !== tag) {
				throw new Error(`Prerelease identifier of main version doesn't match tag of changesets prerelease mode`);
			}
		}

		return { mainVersion: mainVersion.version, manualMainVersion, isPrerelease, prereleaseId };
	}

	/**
	 * Read the prerelease tag `changesets` stores while in prerelease mode.
	 *
	 * @returns The tag from `.changeset/pre.json`, or `undefined` when `changesets` is not in prerelease mode.
	 */
	function readPrereleaseTag(): string | undefined {
		// 1. The file only exists in prerelease mode; any read or parse failure means "not in prerelease mode"
		try {
			const changesetPreFile = join(process.cwd(), '.changeset', 'pre.json');
			const { tag } = JSON.parse(readFileSync(changesetPreFile, 'utf8'));

			return typeof tag === 'string' ? tag : undefined;
		} catch {
			return undefined;
		}
	}

	/**
	 * Write a new version into a workspace package, optionally bumping everything that depends on it.
	 *
	 * @param packageName - Package to bump.
	 * @param version - Version to set; when omitted, the current version is patch (or prerelease) incremented.
	 * @param bumpDependents - Whether packages depending on this one get a bump of their own.
	 */
	async function bumpPackage(packageName: string, version?: string | null, bumpDependents?: boolean) {
		const workspacePackage = workspacePackages.find((p) => p.manifest.name === packageName);

		// 1. Unknown and private packages are never published, so there is no version to bump
		if (!workspacePackage) return;

		if (workspacePackage.manifest.private) return;

		// 2. Either take the given version or step the current one, keeping the prerelease tag in prerelease mode
		let newVersion: string | null = null;

		if (version) {
			newVersion = version;
		} else if (workspacePackage.manifest.version) {
			newVersion = semver.inc(workspacePackage.manifest.version, isPrerelease ? 'prerelease' : 'patch', prereleaseId!);
		}

		if (!newVersion) return;

		// 3. Persist the bump and record it, so the package ends up in the published versions list
		workspacePackage.manifest.version = newVersion;
		await workspacePackage.writeProjectManifest(workspacePackage.manifest);
		packageVersions.set(packageName, newVersion);

		// 4. Dependents that `changesets` did not touch get a bump too, so they pick up the new version
		if (bumpDependents) {
			const dependents = findDependents(packageName);

			for (const dependent of dependents) {
				if (!packageVersions.has(dependent)) await bumpPackage(dependent);
			}
		}
	}

	/**
	 * Build the dependents map once and reuse it, as the package graph is costly to compute.
	 *
	 * @returns Package name to the names of packages depending on it.
	 */
	function getDependentsMap() {
		// 1. Lazy, because most runs never bump dependents and never need the graph
		if (!dependentsMap) {
			const { graph } = createPkgGraph(workspacePackages);
			dependentsMap = transformGraph(graph);
		}

		return dependentsMap;
	}

	/**
	 * Collect every package that transitively depends on the given one.
	 *
	 * @param packageName - Package to start from.
	 * @param dependentsMap - Package name to direct dependents.
	 * @param dependents - Accumulator for the result across recursive calls.
	 * @param visited - Packages already expanded, guarding against dependency cycles.
	 * @returns Names of all transitive dependents.
	 */
	function findDependents(
		packageName: string,
		dependentsMap = getDependentsMap(),
		dependents: string[] = [],
		visited = new Set<string>(),
	) {
		// 1. Workspace graphs can contain cycles, so every package is expanded at most once
		if (visited.has(packageName)) return dependents;
		visited.add(packageName);

		const packageDependents = dependentsMap[packageName];

		if (!packageDependents || packageDependents.length === 0) return dependents;

		// 2. Depth first, so a dependent is listed before its own dependents
		for (const dependent of packageDependents) {
			if (visited.has(dependent)) continue;

			dependents.push(dependent);

			findDependents(dependent, dependentsMap, dependents, visited);
		}

		return dependents;
	}

	/**
	 * Invert the pnpm package graph from "package → dependencies" into "package → dependents".
	 *
	 * @param graph - Graph produced by `createPkgGraph`, keyed by package root directory.
	 * @returns Package name to the names of packages depending on it.
	 */
	function transformGraph(graph: Record<string, PackageNode<Project>>) {
		const dependentsMap: Record<string, string[]> = {};

		// 1. Every node is a dependent; nodes without a name cannot be bumped, so they add nothing to the map
		for (const dependentNodeId of Object.keys(graph)) {
			const dependentPackage = graph[dependentNodeId];
			const dependentPackageName = dependentPackage?.package.manifest.name;

			if (!dependentPackageName) continue;

			// 2. Graph nodes are keyed by directory, so every dependency is mapped back to its package name
			for (const dependencyNodeId of dependentPackage.dependencies) {
				const dependencyPackage = workspacePackages.find((p) => p.rootDir === dependencyNodeId);
				const dependencyPackageName = dependencyPackage?.manifest.name;

				if (!dependencyPackageName) continue;

				// 3. Register the current package as a dependent of each of its dependencies
				if (!dependentsMap[dependencyPackageName]) {
					dependentsMap[dependencyPackageName] = [dependentPackageName];
				} else {
					dependentsMap[dependencyPackageName]?.push(dependentPackageName);
				}
			}
		}

		return dependentsMap;
	}
}
