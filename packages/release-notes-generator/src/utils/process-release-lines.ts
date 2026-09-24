import type { ChangelogFunctions, GetDependencyReleaseLine, GetReleaseLine } from '@changesets/types';
import type { Changesets } from '../types.js';

/**
 * Pattern of a notice block inside a changeset summary.
 *
 * The block starts with a line reading `::: notice` and ends at the first following line reading `:::`. The body is
 * matched lazily on purpose: a greedy match would run on to the last `:::` line anywhere in the summary, swallowing
 * the change text and any later fenced container. The surrounding newlines stay outside the capture group, so the
 * notice keeps its own leading indentation but no blank lines around it.
 */
const NOTICE_BLOCK = /^::: notice\n+([\s\S]*?)\n+:::$/m;

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
	// One map shared by the changelog functions and the caller, so the caller reads what `changesets` collected
	const changesets: Changesets = new Map();

	// The release line hook is the only place `changesets` hands a changeset over, so collection happens here
	/**
	 * Collect a changeset, extracting an optional notice block from its summary.
	 *
	 * @param changeset - Changeset handed over by `changesets`.
	 * @returns Always an empty string, so `changesets` writes no changelog line.
	 */
	const getReleaseLine: GetReleaseLine = async (changeset) => {
		const { id, summary, ...rest } = changeset;

		// `changesets` calls this once per affected package; the changeset itself only has to be recorded once
		if (changesets.has(id)) {
			return '';
		}

		// `changesets` hands the summary over as written, so a changeset saved on Windows still carries CRLF line
		// endings; normalise them first, or the line-anchored notice pattern below never matches
		const normalized = summary.replace(/\r\n?/g, '\n');

		// One pattern both captures the notice box and removes it from the summary, so the block is never removed
		// without being captured:
		//
		//   ::: notice
		//   <my-notice>
		//   :::
		//
		//   <normal-changeset-summary>
		const notice = normalized.match(NOTICE_BLOCK)?.[1];
		const finalSummary = normalized.replace(NOTICE_BLOCK, '').trim();

		// The notice is stored apart from the summary, so it can be rendered in its own place
		changesets.set(id, { summary: finalSummary, notice, ...rest });

		return '';
	};

	// Dependency bumps carry no changeset of their own, so there is nothing to collect from them
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

	// Hand both functions to `changesets` under the names it looks up on the changelog module
	const defaultChangelogFunctions = {
		getReleaseLine,
		getDependencyReleaseLine,
	};

	return { defaultChangelogFunctions, changesets };
}
