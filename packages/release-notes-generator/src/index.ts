import { appendFile } from 'node:fs/promises';
import type { ChangelogFunctions } from '@changesets/types';
import type { Changesets } from './types.js';
import { generateMarkdown } from './utils/generate-markdown.js';
import { getInfo } from './utils/get-info.js';
import { processPackages } from './utils/process-packages.js';
import { processReleaseLines } from './utils/process-release-lines.js';

/**
 * Changelog functions and the changeset map they fill, created once at import so `changesets` and the exit hook
 * below share the same map.
 */
const releaseLines = processReleaseLines();

/**
 * Changesets collected while `changesets` versions the packages.
 */
const changesets = releaseLines.changesets;

/**
 * Changelog functions handed to `changesets`; they collect changesets into {@link changesets} instead of writing
 * changelog lines.
 */
const changelogFunctions: ChangelogFunctions = releaseLines.defaultChangelogFunctions;

// Take over control after `changesets` has finished
process.on('beforeExit', async () => {
	// 1. The event loop only drains once `changesets` has written every version, so the notes are complete now
	await run(changesets);

	// 2. The work above queued new tasks, so Node would emit `beforeExit` again and print the notes twice
	process.exit();
});

/**
 * Generate the release notes from the collected changesets and print them.
 *
 * Runs once `changesets` has written all versions. Besides printing, it writes the version and the notes to
 * `GITHUB_OUTPUT` so a workflow can pick them up.
 *
 * @param changesets - Changesets collected by the changelog functions while `changesets` ran.
 * @returns Resolves once the notes are printed and, inside a GitHub workflow, written to `GITHUB_OUTPUT`.
 * @throws When the versions written by `changesets` are inconsistent, see `processPackages`.
 * @example
 * ```ts
 * await run(new Map([['my-changeset', { summary: 'Fix it', notice: undefined, commit: 'abc1234', releases: [] }]]));
 * ```
 */
export async function run(changesets: Changesets): Promise<void> {
	// 1. Read the versions `changesets` wrote and clean up its changelog files
	const { mainVersion, isPrerelease, prereleaseId, packageVersions } = await processPackages();

	// 2. Group the collected changesets into release notes sections
	const { types, untypedPackages, notices } = await getInfo(changesets);

	// 3. Warn instead of failing, so an empty release still prints its notes and the workflow carries on
	if (types.length === 0 && untypedPackages.length === 0 && packageVersions.length === 0) {
		// eslint-disable-next-line no-console
		console.warn('WARN: No processable changesets found');
	}

	// 4. Print the notes with a headline; the version is left out when no main version is known
	const markdown = generateMarkdown(notices, types, untypedPackages, packageVersions);

	const divider = '==============================================================';
	const headline = mainVersion ? `Novastarter v${mainVersion}` : 'Novastarter release notes';
	// eslint-disable-next-line no-console
	console.log(`${divider}\n${headline}\n${divider}\n${markdown}\n${divider}`);

	// 5. Inside a GitHub workflow, expose the results as step outputs; the notes span lines, hence the heredoc form
	const githubOutput = process.env['GITHUB_OUTPUT'];

	if (githubOutput) {
		const outputs = [
			...(mainVersion ? [`NOVASTARTER_VERSION=${mainVersion}`] : []),
			`NOVASTARTER_PRERELEASE=${isPrerelease}`,
			...(prereleaseId ? [`NOVASTARTER_PRERELEASE_ID=${prereleaseId}`] : []),
			`NOVASTARTER_RELEASE_NOTES<<EOF_RELEASE_NOTES\n${markdown}\nEOF_RELEASE_NOTES`,
		];

		await appendFile(githubOutput, `${outputs.join('\n')}\n`);
	}
}

export default changelogFunctions;
