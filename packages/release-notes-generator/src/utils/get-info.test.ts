import { expect, test, vi } from 'vitest';
import type { Changesets, Config } from '../types.js';
import { getInfo } from './get-info.js';

// The config is stubbed with plain titles, so the expectations don't depend on the emoji in the real one
vi.mock('../config.js', () => {
	const config: Partial<Config> = {
		mainPackage: 'main',
		typedTitles: {
			major: 'Major',
			minor: 'Minor',
			patch: 'Patch',
			none: 'None',
		},
		untypedPackageTitles: { docs: 'Docs' },
		packageOrder: [],
	};

	return { default: config };
});

/**
 * Two changesets: a plain patch for a typed package and a minor with a notice for the untyped `docs` package.
 */
const changesets: Changesets = new Map([
	[
		'1',
		{
			commit: 'abcd123',
			summary: 'Made the notes even more magical',
			notice: undefined,
			releases: [{ name: '@novastarter/ui', type: 'patch' }],
		},
	],
	[
		'2',
		{
			commit: 'efgh456',
			summary: 'Improved some things a little',
			notice: 'This is an example notice.',
			releases: [{ name: 'docs', type: 'minor' }],
		},
	],
]);

test('should compose info from changesets', async () => {
	const info = await getInfo(changesets);

	expect(info).toMatchInlineSnapshot(`
		{
		  "notices": [
		    {
		      "change": {
		        "commit": "efgh456",
		        "summary": "Improved some things a little",
		      },
		      "notice": "This is an example notice.",
		    },
		  ],
		  "types": [
		    {
		      "packages": [
		        {
		          "changes": [
		            {
		              "commit": "abcd123",
		              "summary": "Made the notes even more magical",
		            },
		          ],
		          "name": "@novastarter/ui",
		        },
		      ],
		      "title": "Patch",
		    },
		  ],
		  "untypedPackages": [
		    {
		      "changes": [
		        {
		          "commit": "efgh456",
		          "summary": "Improved some things a little",
		        },
		      ],
		      "name": "Docs",
		    },
		  ],
		}
	`);
});
