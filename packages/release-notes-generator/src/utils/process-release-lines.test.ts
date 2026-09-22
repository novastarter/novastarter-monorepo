/**
 * Tests of `release-notes-generator/utils/process-release-lines`.
 */
import type { NewChangesetWithCommit } from '@changesets/types';
import { describe, expect, test } from 'vitest';
import { processReleaseLines } from './process-release-lines.js';

/**
 * Run a single summary through the `getReleaseLine` hook and return what was stored for it.
 *
 * @param summary - Changeset summary as `changesets` would hand it over.
 * @returns The stored `summary` and `notice`.
 */
async function collect(summary: string): Promise<{ summary: string; notice: string | undefined }> {
	const { defaultChangelogFunctions, changesets } = processReleaseLines();

	const changeset: NewChangesetWithCommit = {
		id: 'random-changeset-name',
		summary,
		commit: 'abcdefg',
		releases: [{ name: '@novastarter/ui', type: 'patch' }],
	};

	await defaultChangelogFunctions.getReleaseLine(changeset, 'patch', null);

	// 1. The map is keyed by id, so the single entry is the one just collected
	const stored = changesets.get(changeset.id)!;

	return { summary: stored.summary, notice: stored.notice };
}

test('should process release lines', async () => {
	const { defaultChangelogFunctions, changesets } = processReleaseLines();

	const changeset: NewChangesetWithCommit = {
		id: 'random-changeset-name',
		summary: 'Example summary',
		commit: 'abcdefg',
		releases: [
			{
				name: '@novastarter/ui',
				type: 'patch',
			},
		],
	};

	await defaultChangelogFunctions.getReleaseLine(changeset, 'patch', null);

	const result = Array.from(changesets, ([key, value]) => ({ key, value }));

	// 1. Strict equality, so a `notice` key that goes missing or gets renamed fails the test instead of being ignored
	expect(result[0]).toStrictEqual({
		key: 'random-changeset-name',
		value: {
			commit: 'abcdefg',
			notice: undefined,
			releases: [
				{
					name: '@novastarter/ui',
					type: 'patch',
				},
			],
			summary: 'Example summary',
		},
	});
});

test('should record a changeset only once across its releases', async () => {
	const { defaultChangelogFunctions, changesets } = processReleaseLines();

	const changeset: NewChangesetWithCommit = {
		id: 'random-changeset-name',
		summary: 'Example summary',
		commit: 'abcdefg',
		releases: [
			{ name: '@novastarter/ui', type: 'patch' },
			{ name: '@novastarter/utils', type: 'patch' },
		],
	};

	await defaultChangelogFunctions.getReleaseLine(changeset, 'patch', null);
	await defaultChangelogFunctions.getReleaseLine(changeset, 'patch', null);

	expect(changesets.size).toBe(1);
});

test('should return an empty line for dependency releases', async () => {
	const { defaultChangelogFunctions } = processReleaseLines();

	await expect(defaultChangelogFunctions.getDependencyReleaseLine([], [], null)).resolves.toBe('');
});

describe('notice extraction', () => {
	test('should extract notice from summary', async () => {
		await expect(collect('::: notice\nInfo text\n:::\n\nSummary text')).resolves.toStrictEqual({
			summary: 'Summary text',
			notice: 'Info text',
		});
	});

	test('should keep a multi-line notice with blank lines and indentation', async () => {
		await expect(collect('::: notice\n\n  - First\n\n  - Second\n\n:::\n\nSummary text')).resolves.toStrictEqual({
			summary: 'Summary text',
			notice: '  - First\n\n  - Second',
		});
	});

	test('should stop at the first closing line when the summary holds a later ::: line', async () => {
		// 1. A greedy match would run on to the last `:::` and swallow the change text, dropping it from the notes
		const summary = '::: notice\nBreaking\n:::\n\nAdds a docs admonition:\n\n::: tip\nUse it\n:::';

		await expect(collect(summary)).resolves.toStrictEqual({
			summary: 'Adds a docs admonition:\n\n::: tip\nUse it\n:::',
			notice: 'Breaking',
		});
	});

	test('should extract a notice from a summary with CRLF line endings', async () => {
		await expect(collect('::: notice\r\nInfo text\r\n:::\r\n\r\nSummary text')).resolves.toStrictEqual({
			summary: 'Summary text',
			notice: 'Info text',
		});
	});

	test('should normalise line endings of a summary without a notice', async () => {
		await expect(collect('First line\r\nSecond line\r\n')).resolves.toStrictEqual({
			summary: 'First line\nSecond line',
			notice: undefined,
		});
	});

	test('should leave an empty summary for a notice-only changeset', async () => {
		await expect(collect('::: notice\nDrop Node 18\n:::')).resolves.toStrictEqual({
			summary: '',
			notice: 'Drop Node 18',
		});
	});

	test('should not treat an unclosed notice as one', async () => {
		await expect(collect('::: notice\nInfo text\n\nSummary text')).resolves.toStrictEqual({
			summary: '::: notice\nInfo text\n\nSummary text',
			notice: undefined,
		});
	});
});
