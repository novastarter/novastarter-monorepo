/**
 * Tests of `to-ses-message-tags`: how the category and the tags become SES message tags that SES will accept.
 */
import { describe, expect, test } from 'vitest';
import {
	SES_MESSAGE_TAG_COUNT,
	SES_MESSAGE_TAG_LENGTH,
	toSesMessageTag,
	toSesMessageTags,
} from './to-ses-message-tags.js';

describe('toSesMessageTag', () => {
	test('Replaces everything outside the SES character set and cuts at the length limit', () => {
		// 1. Letters, digits, `_` and `-` pass as given; a space, a dot, a slash and a non-ASCII letter each become `_`
		expect(toSesMessageTag('welcome_flow-2')).toBe('welcome_flow-2');
		expect(toSesMessageTag('welcome flow')).toBe('welcome_flow');
		expect(toSesMessageTag('v2.1/beta é')).toBe('v2_1_beta__');

		// 2. SES refuses a name past 256 characters, so the tail is cut rather than sent
		expect(toSesMessageTag('a'.repeat(SES_MESSAGE_TAG_LENGTH + 10))).toHaveLength(SES_MESSAGE_TAG_LENGTH);

		// 3. An empty tag stays empty; the caller decides to drop it
		expect(toSesMessageTag('')).toBe('');
	});
});

describe('toSesMessageTags', () => {
	test('Records the category first and every tag as `<tag>=1`, sanitised', () => {
		// 1. The default category applies without one; no tags means the category alone
		expect(toSesMessageTags({ to: 'ada@example.com', subject: 'Hi' })).toStrictEqual([
			{ Name: 'category', Value: 'transactional' },
		]);

		// 2. A tag valid for every other provider comes out in SES's character set instead of failing the send
		expect(
			toSesMessageTags({ to: 'ada@example.com', subject: 'Hi', category: 'marketing', tags: ['welcome flow', 'v2.1'] }),
		).toStrictEqual([
			{ Name: 'category', Value: 'marketing' },
			{ Name: 'welcome_flow', Value: '1' },
			{ Name: 'v2_1', Value: '1' },
		]);
	});

	test('Drops a tag left with no name and keeps the others', () => {
		// 1. An empty tag has no name SES would take; the message still goes out with the tags that do
		expect(toSesMessageTags({ to: 'ada@example.com', subject: 'Hi', tags: ['', 'welcome'] })).toStrictEqual([
			{ Name: 'category', Value: 'transactional' },
			{ Name: 'welcome', Value: '1' },
		]);
	});

	test('Drops a tag whose sanitised name is already on the list', () => {
		// 1. SES refuses two tags of one name; tags the sanitiser folds together, a repeated tag and a tag named
		//    `category` each keep only the first name, so the message still goes out
		expect(
			toSesMessageTags({
				to: 'ada@example.com',
				subject: 'Hi',
				tags: ['welcome flow', 'welcome_flow', 'v2.1', 'v2_1', 'category', 'v2_1'],
			}),
		).toStrictEqual([
			{ Name: 'category', Value: 'transactional' },
			{ Name: 'welcome_flow', Value: '1' },
			{ Name: 'v2_1', Value: '1' },
		]);
	});

	test('Caps the list at the tag count, the category taking one slot', () => {
		// 1. SES refuses a message past its tag count, so the tail past the cap is left off rather than failing the send
		const tags = Array.from({ length: SES_MESSAGE_TAG_COUNT + 5 }, (_, index) => `tag_${index}`);

		const result = toSesMessageTags({ to: 'ada@example.com', subject: 'Hi', tags });

		expect(result).toHaveLength(SES_MESSAGE_TAG_COUNT);
		expect(result.at(-1)).toStrictEqual({ Name: `tag_${SES_MESSAGE_TAG_COUNT - 2}`, Value: '1' });
	});
});
