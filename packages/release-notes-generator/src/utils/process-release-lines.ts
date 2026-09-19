import type { ChangelogFunctions, GetDependencyReleaseLine, GetReleaseLine } from '@changesets/types';
import type { Changesets } from '../types.js';

/**
 * Create the `changesets` changelog functions and the map they fill while `changesets` runs.
 *
 * `changesets` calls the changelog functions once per changeset and release to write `CHANGELOG.md` files. This
 * package does not want those files; it only uses the calls to collect every changeset into `changesets`, which
 * the release notes are generated from once `changesets` is done. Every function therefore returns an empty
 * string.
 *
 * @returns The changelog functions to hand to `changesets` and the map they fill.
 */
export function processReleaseLines(): { defaultChangelogFunctions: ChangelogFunctions; changesets: Changesets } {
	const changesets: Changesets = new Map();

	/**
	 * Collect a changeset, extracting an optional notice block from its summary.
	 *
	 * @param changeset - Changeset handed over by `changesets`.
	 * @returns Always an empty string, so `changesets` writes no changelog line.
	 */
	const getReleaseLine: GetReleaseLine = async (changeset) => {
		const { id, summary, ...rest } = changeset;

		// 1. `changesets` calls this once per affected package; the changeset itself only has to be recorded once
		if (changesets.has(id)) {
			return '';
		}

		// 2. Find text inside a notice box with the following pattern and extract it from the normal changeset
		//    summary:
		//
		//      ::: notice
		//      <my-notice>
		//      :::
		//
		//      <normal-changeset-summary>
		const finalSummary = summary.replace(/^::: notice\n[\s\S]*^:::$/m, '').trim();
		const notice = summary.match(/::: notice\n+([\s\S]*)(?<!\n)\n+:::$/m)?.[1];

		// 3. Store the cleaned summary and the notice separately, so the notice can be rendered in its own place
		changesets.set(id, { summary: finalSummary, notice, ...rest });

		return '';
	};

	/**
	 * Ignore dependency release lines.
	 *
	 * Cannot be used since there's no way to get the affected dependency.
	 *
	 * @returns Always an empty string.
	 */
	const getDependencyReleaseLine: GetDependencyReleaseLine = async () => {
		return '';
	};

	const defaultChangelogFunctions = {
		getReleaseLine,
		getDependencyReleaseLine,
	};

	return { defaultChangelogFunctions, changesets };
}
