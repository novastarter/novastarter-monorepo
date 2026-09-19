import { describe, expect, test } from 'vitest';
import config from '../config.js';
import type { Change, Notice, PackageVersion, Type, UntypedPackage } from '../types.js';
import { generateMarkdown } from './generate-markdown.js';

/**
 * Change with a multi-line summary and a commit, so every part of the change format is exercised.
 */
const change1: Change = {
	summary: "Made the notes even more magical\nAnd here's some additional context",
	commit: 'abcd123',
};

/**
 * Change with a single-line summary and a commit.
 */
const change2: Change = {
	summary: 'Improved some things a little',
	commit: 'efgh456',
};

test('should generate basic release notes', () => {
	const types: Type[] = [
		{
			title: config.typedTitles.minor,
			packages: [
				{
					name: '@novastarter/ui',
					changes: [change1],
				},
			],
		},
		{
			title: config.typedTitles.patch,
			packages: [
				{
					name: '@novastarter/utils',
					changes: [change1, change2],
				},
			],
		},
	];

	const untypedPackages: UntypedPackage[] = [
		{ name: config.untypedPackageTitles['docs']!, changes: [change1, change2] },
	];

	const packageVersions: PackageVersion[] = [
		{ name: '@novastarter/ui', version: '10.0.0' },
		{ name: '@novastarter/utils', version: '10.0.0' },
	];

	const markdown = generateMarkdown([], types, untypedPackages, packageVersions);

	expect(markdown).toMatchInlineSnapshot(`
		"### ✨ New Features & Improvements

		- **@novastarter/ui**
		  - Made the notes even more magical ([abcd123](https://github.com/novastarter/novastarter-monorepo/commit/abcd123))
		    And here's some additional context

		### 🐛 Bug Fixes & Optimizations

		- **@novastarter/utils**
		  - Made the notes even more magical ([abcd123](https://github.com/novastarter/novastarter-monorepo/commit/abcd123))
		    And here's some additional context
		  - Improved some things a little ([efgh456](https://github.com/novastarter/novastarter-monorepo/commit/efgh456))

		### 📝 Documentation

		- Made the notes even more magical ([abcd123](https://github.com/novastarter/novastarter-monorepo/commit/abcd123))
		  And here's some additional context
		- Improved some things a little ([efgh456](https://github.com/novastarter/novastarter-monorepo/commit/efgh456))

		### 📦 Published Versions

		- \`@novastarter/ui@10.0.0\`
		- \`@novastarter/utils@10.0.0\`"
	`);
});

describe('notices', () => {
	const notices: Notice[] = [
		{ notice: 'This is an example notice.', change: change1 },
		{ notice: 'This is another notice.', change: change2 },
	];

	test('should create section with notices when no changes', () => {
		const markdown = generateMarkdown(notices, [], [], []);

		expect(markdown).toMatchInlineSnapshot(`
			"### ⚠️ Potential Breaking Changes

			**Made the notes even more magical... ([abcd123](https://github.com/novastarter/novastarter-monorepo/commit/abcd123))**
			This is an example notice.

			**Improved some things a little ([efgh456](https://github.com/novastarter/novastarter-monorepo/commit/efgh456))**
			This is another notice."
		`);
	});

	test('should show notices along with changes', () => {
		const types: Type[] = [
			{
				title: config.typedTitles[config.noticeType],
				packages: [
					{
						name: '@novastarter/ui',
						changes: [change1],
					},
				],
			},
		];

		const markdown = generateMarkdown(notices, types, [], []);

		expect(markdown).toMatchInlineSnapshot(`
			"### ⚠️ Potential Breaking Changes

			**Made the notes even more magical... ([abcd123](https://github.com/novastarter/novastarter-monorepo/commit/abcd123))**
			This is an example notice.

			**Improved some things a little ([efgh456](https://github.com/novastarter/novastarter-monorepo/commit/efgh456))**
			This is another notice.

			- **@novastarter/ui**
			  - Made the notes even more magical ([abcd123](https://github.com/novastarter/novastarter-monorepo/commit/abcd123))
			    And here's some additional context"
		`);
	});
});
