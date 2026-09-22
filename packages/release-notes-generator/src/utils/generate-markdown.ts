import config from '../config.js';
import type { Change, Notice, Package, PackageVersion, Type, UntypedPackage } from '../types.js';

/**
 * A version type section together with the notices rendered at its top.
 */
type Section = Type & { notices: Notice[] };

/**
 * Render the grouped changes as the Markdown body of the release notes.
 *
 * The output is made of the version type sections (with notices inside the section picked by
 * {@link Config.noticeType}), the untyped package sections and the list of published versions. Empty parts are
 * left out, so a release without notices or untyped changes gets no empty headings.
 *
 * @param notices - Notices to render under the notice section.
 * @param types - Version type sections with their packages and changes.
 * @param untypedPackages - Packages rendered under a custom title.
 * @param packageVersions - Published packages with their new versions.
 * @returns The release notes in Markdown.
 */
export function generateMarkdown(
	notices: Notice[],
	types: Type[],
	untypedPackages: UntypedPackage[],
	packageVersions: PackageVersion[],
): string {
	// 1. Turn the version type sections into output sections, attaching the notices to the configured one
	let foundNoticeSection = false;

	const noticeTypeTitle = config.typedTitles[config.noticeType];

	let sections: Section[] = types.map((type) => {
		if (type.title === noticeTypeTitle) {
			foundNoticeSection = true;
			return { title: type.title, packages: type.packages, notices };
		}

		return { title: type.title, packages: type.packages, notices: [] };
	});

	// 2. The notice section may not exist yet when no package had a change of that type; create it up front so
	//    notices are never lost
	if (notices.length > 0 && !foundNoticeSection) {
		sections = [{ title: noticeTypeTitle, packages: [], notices }, ...sections];
	}

	// 3. Assemble the parts and drop the empty ones, so no stray blank lines end up between them
	const output = [];

	output.push(formatSections(sections));

	output.push(formatUntypedPackages(untypedPackages));

	output.push(formatPackageVersions(packageVersions));

	return output.filter((o) => o).join('\n\n');
}

/**
 * Render the version type sections, each as a heading followed by its notices and packages.
 *
 * @param sections - Sections to render.
 * @returns Markdown of all non-empty sections.
 */
function formatSections(sections: Section[]): string {
	const output = [];

	for (const { title, packages, notices } of sections) {
		// 1. A section with nothing in it would only leave a dangling heading
		if (packages.length === 0 && notices.length === 0) {
			continue;
		}

		let lines = `### ${title}`;

		// 2. Notices come first, as they are the part readers must not miss
		if (notices.length > 0) {
			lines += '\n\n';
			lines += formatNotices(notices);
		}

		// 3. Then the regular changes, grouped by package
		if (packages.length > 0) {
			lines += '\n\n';
			lines += formatPackages(packages);
		}

		output.push(lines);
	}

	return output.join('\n\n');
}

/**
 * Render notices as a bold one-line change title followed by the notice body.
 *
 * A changeset that consists of a notice block alone has no summary left; its notice is then rendered without a
 * title (or with the bare commit link when one is known) instead of an empty bold span.
 *
 * @param notices - Notices to render.
 * @returns Markdown of the notices.
 */
function formatNotices(notices: Notice[]): string {
	const output = notices.map((notice) => {
		// 1. The short change form keeps the title on one line, so the bold heading never spans multiple lines;
		//    trimming drops the space the commit link is joined with when there is no summary in front of it
		const title = formatChange(notice.change, true).trim();

		// 2. `**` around nothing is not emphasis in CommonMark and would be printed literally, so the wrapper is
		//    left out when there is nothing to wrap
		return title ? `**${title}**\n${notice.notice}` : notice.notice;
	});

	return output.join('\n\n');
}

/**
 * Render packages as a nested list: the package name, then its changes indented underneath.
 *
 * @param packages - Packages to render.
 * @returns Markdown list of packages and their changes.
 */
function formatPackages(packages: Package[]): string {
	const output = packages.map(({ name, changes }) => {
		let lines = '';

		// 1. Indent every line of every change by two spaces, so multi-line summaries stay inside the nested list
		if (changes.length > 0) {
			lines += `- **${name}**\n`;

			lines += formatChanges(changes)
				.map((change) =>
					change
						.split('\n')
						.map((line) => `  ${line}`)
						.join('\n'),
				)
				.join('\n');
		}

		return lines;
	});

	return output.join('\n');
}

/**
 * Render untyped packages as their own sections, titled by the configured title instead of the package name.
 *
 * @param untypedPackages - Untyped packages to render.
 * @returns Markdown of all non-empty untyped sections.
 */
function formatUntypedPackages(untypedPackages: UntypedPackage[]): string {
	const output = [];

	for (const { name, changes } of untypedPackages) {
		// 1. Skip packages without changes to avoid empty headings
		if (changes.length == 0) {
			continue;
		}

		let lines = `### ${name}\n\n`;
		lines += formatChanges(changes).join('\n');

		output.push(lines);
	}

	return output.join('\n\n');
}

/**
 * Render changes as list items, continuing multi-line summaries indented under the bullet.
 *
 * @param changes - Changes to render.
 * @returns One Markdown list item per change.
 */
function formatChanges(changes: Change[]): string[] {
	return changes.map((change) => {
		const lines = [];

		// 1. Only the first line gets the bullet; the rest is indented to stay part of the same item
		const [firstLine, ...remainingLines] = formatChange(change).split('\n');

		lines.push(`- ${firstLine}`);

		if (remainingLines.length > 0) {
			lines.push(...remainingLines.map((line) => `  ${line}`));
		}

		return lines.join('\n');
	});
}

/**
 * Render a single change as its summary followed by a link to the commit that added the changeset.
 *
 * The link is built from {@link Config.repo} and the commit hash `changesets` resolved through `git log`; a
 * changeset that is not committed yet gets no link.
 *
 * @param change - Change to render.
 * @param short - When `true`, only the first summary line is used (marked with `...` if more follow); used for
 * notice titles.
 * @returns The change as Markdown text.
 */
function formatChange(change: Change, short?: boolean): string {
	// 1. Reference the commit when `changesets` could resolve one
	const ref = change.commit ? ` ([${change.commit}](https://github.com/${config.repo}/commit/${change.commit}))` : '';

	// 2. The reference goes after the first summary line; further lines follow only in the long form
	const [firstSummaryLine, ...remainingSummaryLines] = change.summary.split('\n');

	const title = short && remainingSummaryLines.length > 0 ? `${firstSummaryLine}...` : firstSummaryLine;
	const additionalLines = !short && remainingSummaryLines.length > 0 ? `\n${remainingSummaryLines.join('\n')}` : '';

	return `${title}${ref}${additionalLines}`;
}

/**
 * Render the published versions as a list under the configured title.
 *
 * @param packageVersions - Published packages with their versions.
 * @returns Markdown list of `name@version`, or an empty string when nothing was published.
 */
function formatPackageVersions(packageVersions: PackageVersion[]): string {
	let lines = '';

	// 1. Only add the heading when there is something to list under it
	if (packageVersions.length > 0) {
		lines += `### ${config.versionTitle}\n`;
	}

	for (const { name, version } of packageVersions) {
		lines += `\n- \`${name}@${version}\``;
	}

	return lines;
}
