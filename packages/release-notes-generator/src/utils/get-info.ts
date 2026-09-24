import { config } from '../config.js';
import type { Change, Changesets, Notice, Type, UntypedPackage } from '../types.js';
import { sortByExternalOrder, sortByObjectValues } from './sort.js';

/**
 * Group the collected changesets into the sections the release notes are built from.
 *
 * Every changeset is filed under a version type section per affected package, or under an untyped package title when
 * the package has one. Notices are collected separately because they are rendered under a fixed section regardless of
 * the affected packages.
 *
 * @param changesets - Changesets collected while `changesets` ran.
 * @returns Version type sections, untyped packages and notices, each sorted as the config dictates.
 */
export async function getInfo(changesets: Changesets): Promise<{
	types: Type[];
	untypedPackages: UntypedPackage[];
	notices: Notice[];
}> {
	const types: Type[] = [];
	const untypedPackages: UntypedPackage[] = [];
	const notices: Notice[] = [];

	for (const { summary, notice, commit, releases } of changesets.values()) {
		const change: Change = { summary, commit };

		// Notices are kept apart from the change list, as they are rendered under the notice section on their own
		if (notice) {
			notices.push({ notice, change });
		}

		for (const { type, name } of releases) {
			// The main package only carries the headline version, and a changeset without summary has nothing to
			// show
			if (name === config.mainPackage || !summary) {
				continue;
			}

			// Untyped packages are listed under their own title instead of the version type sections
			const untypedTitle = config.untypedPackageTitles[name];

			if (untypedTitle) {
				const packageInUntypedPackages = untypedPackages.find((p) => p.name === untypedTitle);

				if (packageInUntypedPackages) {
					packageInUntypedPackages.changes.push(change);
				} else {
					untypedPackages.push({
						name: untypedTitle,
						changes: [change],
					});
				}

				continue;
			}

			const typeTitle = config.typedTitles[type];
			const typeInTypes = types.find((t) => t.title === typeTitle);

			if (typeInTypes) {
				const packageInPackages = typeInTypes.packages.find((p) => p.name === name);

				if (packageInPackages) {
					packageInPackages.changes.push(change);
				} else {
					typeInTypes.packages.push({
						name,
						changes: [change],
					});
				}
			} else {
				types.push({ title: typeTitle, packages: [{ name, changes: [change] }] });
			}
		}
	}

	types.sort(sortByObjectValues(config.typedTitles, 'title'));

	for (const { packages } of types) {
		packages.sort(sortByExternalOrder(config.packageOrder, 'name'));
	}

	untypedPackages.sort(sortByObjectValues(config.untypedPackageTitles, 'name'));

	return { types, untypedPackages, notices };
}
