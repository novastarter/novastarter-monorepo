import { randomBytes } from 'node:crypto';
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

// Take over control after `changesets` has finished. The hook is the composition root of this entry: the
// deployment inputs are read here, once, and passed into `run` as plain arguments
process.on('beforeExit', async () => {
	try {
		// 1. The event loop only drains once `changesets` has written every version, so the notes are complete now
		await run(changesets, {
			githubOutput: process.env['GITHUB_OUTPUT'],
			forcedVersion: process.env['NOVASTARTER_VERSION'],
			workspaceRoot: process.cwd(),
		});
	} catch (error) {
		// 2. A rejection inside `beforeExit` is unhandled and would kill the process without a useful message, so
		//    the error is printed and remembered as the exit code
		// eslint-disable-next-line no-console
		console.error(error);
		process.exitCode = 1;
	} finally {
		// 3. The work above queued new tasks, so Node would emit `beforeExit` again and print the notes twice
		process.exit();
	}
});

/**
 * Inputs of {@link run} that only the deployment environment can provide, read by the caller — the `beforeExit`
 * hook of this entry — rather than by the package itself.
 */
export interface RunOptions {
	/**
	 * Path of the GitHub step output file (`GITHUB_OUTPUT`); when set, the version and the notes are appended to
	 * it so a workflow can pick them up.
	 *
	 * @defaultValue none
	 */
	githubOutput?: string | undefined;
	/**
	 * Version forced for the release (`NOVASTARTER_VERSION`), overriding the version `changesets` wrote.
	 *
	 * @defaultValue none
	 */
	forcedVersion?: string | undefined;
	/**
	 * Root of the workspace `changesets` just versioned.
	 */
	workspaceRoot: string;
}

/**
 * Generate the release notes from the collected changesets and print them.
 *
 * Runs once `changesets` has written all versions. Besides printing, it appends the version and the notes to the
 * GitHub step output file of the options, when one is given.
 *
 * @param changesets - Changesets collected by the changelog functions while `changesets` ran.
 * @param options - Deployment inputs read by the caller: the step output file, the forced version, the workspace root.
 * @returns Resolves once the notes are printed and, inside a GitHub workflow, written to the step output file.
 * @throws When the versions written by `changesets` are inconsistent, see `processPackages`.
 * @example
 * ```ts
 * await run(new Map([['my-changeset', { summary: 'Fix it', notice: undefined, commit: 'abc1234', releases: [] }]]), {
 * 	workspaceRoot: '/repo',
 * });
 * ```
 */
export async function run(changesets: Changesets, options: RunOptions): Promise<void> {
	// 1. Read the versions `changesets` wrote and clean up its changelog files
	const { mainVersion, isPrerelease, prereleaseId, packageVersions } = await processPackages({
		forcedVersion: options.forcedVersion,
		workspaceRoot: options.workspaceRoot,
	});

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
	if (options.githubOutput) {
		// 6. Summaries are arbitrary contributor markdown and a line equal to the delimiter would end the heredoc
		//    early, spilling the rest into step outputs, so the delimiter is random per run and cannot be forged in
		//    advance. Nothing is percent-escaped: GitHub only unescapes `%0A`/`%0D`/`%25` for single-line values,
		//    so escaping would corrupt the notes, and the single-line values are semver-validated and hold no
		//    characters that need escaping
		const delimiter = `EOF_RELEASE_NOTES_${randomBytes(8).toString('hex')}`;

		const outputs = [
			...(mainVersion ? [`NOVASTARTER_VERSION=${mainVersion}`] : []),
			`NOVASTARTER_PRERELEASE=${isPrerelease}`,
			...(prereleaseId ? [`NOVASTARTER_PRERELEASE_ID=${prereleaseId}`] : []),
			`NOVASTARTER_RELEASE_NOTES<<${delimiter}\n${markdown}\n${delimiter}`,
		];

		await appendFile(options.githubOutput, `${outputs.join('\n')}\n`);
	}
}

export default changelogFunctions;
