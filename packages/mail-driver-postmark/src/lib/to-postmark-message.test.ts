/**
 * Tests of `to-postmark-message`: how a message and its attachments become Postmark's `sendEmail()` payload.
 */
import { describe, expect, test } from 'vitest';
import {
	POSTMARK_METADATA_FIELDS,
	POSTMARK_METADATA_VALUE_LENGTH,
	toPostmarkAttachment,
	toPostmarkMessage,
	toPostmarkTagsMetadata,
} from './to-postmark-message.js';

describe('toPostmarkAttachment', () => {
	test('Encodes inline content as base64 and prefixes the content id', async () => {
		// 1. Postmark keeps the `cid:` prefix in the field, unlike the other providers
		expect(
			await toPostmarkAttachment({
				filename: 'logo.png',
				content: Buffer.from('png'),
				contentType: 'image/png',
				cid: 'logo',
			}),
		).toStrictEqual({
			Name: 'logo.png',
			Content: Buffer.from('png').toString('base64'),
			ContentType: 'image/png',
			ContentID: 'cid:logo',
		});
	});

	test('Reads a path and defaults the content type', async () => {
		// 1. This very file is the attachment; its content proves the path was read
		const attachment = await toPostmarkAttachment({ filename: 'self.ts', path: new URL(import.meta.url).pathname });

		expect(attachment.ContentType).toBe('application/octet-stream');
		expect(attachment.ContentID).toBeNull();
		expect(Buffer.from(attachment.Content, 'base64').toString()).toContain('toPostmarkAttachment');
	});

	test('Throws without content or path', async () => {
		// 1. An attachment without a source is refused by name
		await expect(toPostmarkAttachment({ filename: 'x' })).rejects.toThrow('neither content nor path');
	});
});

describe('toPostmarkTagsMetadata', () => {
	test('Joins short tags into one value and none at all without tags', () => {
		// 1. No tags past the first: no field, so `Metadata` keeps only the category
		expect(toPostmarkTagsMetadata([])).toStrictEqual({});

		// 2. Tags that fit in one value stay comma-joined under the plain `tags` name
		expect(toPostmarkTagsMetadata(['v2', 'eu'])).toStrictEqual({ tags: 'v2,eu' });
	});

	test('Skips a tag left empty by the cut, so no stray comma lands in a value', () => {
		// 1. An empty tag joins nothing: the value keeps only the tags that record something
		expect(toPostmarkTagsMetadata(['', 'a'])).toStrictEqual({ tags: 'a' });

		// 2. Nothing but empty tags: no field at all
		expect(toPostmarkTagsMetadata([''])).toStrictEqual({});
	});

	test('Splits tags across values so none passes the length limit', () => {
		// 1. Four ordinary tags and three commas fill 84 characters: past what one value may hold
		const tags = ['onboarding-sequence-step-2', 'region-europe-west', 'experiment-variant-b', 'source-web-signup'];
		const metadata = toPostmarkTagsMetadata(tags);

		expect(metadata).toStrictEqual({
			tags: 'onboarding-sequence-step-2,region-europe-west,experiment-variant-b',
			tags2: 'source-web-signup',
		});

		// 2. Every value stays within the limit and no tag is lost
		for (const value of Object.values(metadata)) {
			expect(value.length).toBeLessThanOrEqual(POSTMARK_METADATA_VALUE_LENGTH);
		}

		expect(Object.values(metadata).join(',').split(',')).toStrictEqual(tags);
	});

	test('Cuts a tag longer than one value and drops what the fields cannot hold', () => {
		// 1. A tag past the limit cannot fit any value: its prefix is kept rather than the whole message failing
		const long = 'x'.repeat(POSTMARK_METADATA_VALUE_LENGTH + 5);

		expect(toPostmarkTagsMetadata([long, 'a'])).toStrictEqual({
			tags: 'x'.repeat(POSTMARK_METADATA_VALUE_LENGTH),
			tags2: 'a',
		});

		// 2. The category takes one field, so one more full value than the fields left over is dropped
		const full = 'y'.repeat(POSTMARK_METADATA_VALUE_LENGTH);
		const metadata = toPostmarkTagsMetadata(Array.from({ length: POSTMARK_METADATA_FIELDS }, () => full));

		expect(Object.keys(metadata)).toHaveLength(POSTMARK_METADATA_FIELDS - 1);
		expect(Object.keys(metadata).at(-1)).toBe(`tags${POSTMARK_METADATA_FIELDS - 1}`);
	});
});

describe('toPostmarkMessage', () => {
	test('Maps the message into Postmark shape: one tag, the rest in metadata, a broadcast stream for marketing', async () => {
		// 1. Recipients are comma-joined, the first tag is `Tag`, the rest and the category go to `Metadata`
		expect(
			await toPostmarkMessage(
				{
					to: [{ name: 'Ada', address: 'ada@example.com' }, 'bob@example.com'],
					cc: ['cc@example.com'],
					bcc: ['bcc@example.com'],
					from: { name: 'Acme', address: 'no-reply@acme.test' },
					replyTo: 'Support <support@acme.test>',
					subject: 'Hi',
					html: '<p>Hi</p>',
					text: 'Hi',
					headers: { 'X-Campaign': 'welcome' },
					attachments: [{ filename: 'a.txt', content: 'hello', contentType: 'text/plain' }],
					category: 'marketing',
					tags: ['welcome', 'v2', 'eu'],
				},
				{ messageStream: 'outbound', broadcastStream: 'newsletter' },
			),
		).toStrictEqual({
			From: 'Acme <no-reply@acme.test>',
			To: 'Ada <ada@example.com>,bob@example.com',
			Cc: 'cc@example.com',
			Bcc: 'bcc@example.com',
			ReplyTo: 'Support <support@acme.test>',
			Subject: 'Hi',
			HtmlBody: '<p>Hi</p>',
			TextBody: 'Hi',
			Tag: 'welcome',
			MessageStream: 'newsletter',
			Metadata: { category: 'marketing', tags: 'v2,eu' },
			Headers: [{ Name: 'X-Campaign', Value: 'welcome' }],
			Attachments: [
				{
					Name: 'a.txt',
					Content: Buffer.from('hello').toString('base64'),
					ContentType: 'text/plain',
					ContentID: null,
				},
			],
		});
	});

	test('Spreads a long tag list over metadata fields instead of one value Postmark refuses', async () => {
		// 1. The scenario of a handful of ordinary tags: joined they pass 80 characters, so they take two fields
		const message = await toPostmarkMessage({
			to: 'a@example.com',
			from: 'me@acme.test',
			subject: 'S',
			tags: [
				'welcome',
				'onboarding-sequence-step-2',
				'region-europe-west',
				'experiment-variant-b',
				'source-web-signup',
			],
		});

		expect(message.Tag).toBe('welcome');

		expect(message.Metadata).toStrictEqual({
			category: 'transactional',
			tags: 'onboarding-sequence-step-2,region-europe-west,experiment-variant-b',
			tags2: 'source-web-signup',
		});
	});

	test('Drops empty tags before the first becomes Tag', async () => {
		// 1. An empty tag records nothing in Postmark, so the first non-empty one takes `Tag` and the rest skip the
		//    metadata values without leaving stray commas
		expect(
			await toPostmarkMessage({ to: 'a@example.com', from: 'me@acme.test', subject: 'S', text: 'T', tags: ['', 'v2'] }),
		).toStrictEqual({
			From: 'me@acme.test',
			To: 'a@example.com',
			Subject: 'S',
			TextBody: 'T',
			Tag: 'v2',
			Metadata: { category: 'transactional' },
		});
	});

	test('Leaves the stream to Postmark without settings and marketing on the transactional stream without a broadcast one', async () => {
		// 1. No streams registered: no `MessageStream`, Postmark picks its default
		expect(
			await toPostmarkMessage({ to: 'a@example.com', from: 'me@acme.test', subject: 'S', text: 'T' }),
		).toStrictEqual({
			From: 'me@acme.test',
			To: 'a@example.com',
			Subject: 'S',
			TextBody: 'T',
			Metadata: { category: 'transactional' },
		});

		// 2. Marketing without a broadcast stream falls back to the message stream
		expect(
			await toPostmarkMessage(
				{ to: 'a@example.com', from: 'me@acme.test', subject: 'S', category: 'marketing' },
				{ messageStream: 'outbound' },
			),
		).toMatchObject({ MessageStream: 'outbound' });
	});

	test('Requires a sender', async () => {
		// 1. A message without a sender is refused by name
		await expect(toPostmarkMessage({ to: 'a@example.com', subject: 'S' })).rejects.toThrow('"from"');
	});
});
