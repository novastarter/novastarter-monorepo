/**
 * Tests of `to-sendgrid-mail`: how a message, its addresses and its attachments become the payload of SendGrid's
 * `send()`.
 */
import { describe, expect, test } from 'vitest';
import {
	SENDGRID_CATEGORY_COUNT,
	SENDGRID_CATEGORY_LENGTH,
	toSendgridAddress,
	toSendgridAttachment,
	toSendgridCategories,
	toSendgridMail,
} from './to-sendgrid-mail.js';

describe('toSendgridCategories', () => {
	test('Cuts every label to the length limit, drops an empty one and caps the count, the category first', () => {
		// 1. SendGrid refuses a message past its category limits, so the labels are adapted instead: the category
		//    leads, an empty tag drops out and the tail past ten is left off
		const tags = Array.from({ length: SENDGRID_CATEGORY_COUNT + 3 }, (_, index) => `tag-${index}`);

		expect(toSendgridCategories({ to: 'a@b.c', subject: 'x', category: 'marketing', tags })).toStrictEqual([
			'marketing',
			...tags.slice(0, SENDGRID_CATEGORY_COUNT - 1).map((_, index) => `tag-${index}`),
		]);

		// 2. A tag past the 255-character name limit is cut to its prefix, not refused
		expect(
			toSendgridCategories({ to: 'a@b.c', subject: 'x', tags: ['x'.repeat(SENDGRID_CATEGORY_LENGTH + 10)] }),
		).toStrictEqual(['transactional', 'x'.repeat(SENDGRID_CATEGORY_LENGTH)]);

		// 3. An empty tag drops out; the category alone fits
		expect(toSendgridCategories({ to: 'a@b.c', subject: 'x', tags: ['', 'welcome'] })).toStrictEqual([
			'transactional',
			'welcome',
		]);
	});
});

describe('toSendgridAddress', () => {
	test('Parses a display-name string and keeps the name of an object', () => {
		// 1. SendGrid takes name and address apart; a display-name string is parsed, so its name is kept
		expect(toSendgridAddress('Bob <bob@example.com>')).toStrictEqual({
			email: 'bob@example.com',
			name: 'Bob',
		});

		expect(toSendgridAddress({ name: 'Ada', address: 'ada@example.com' })).toStrictEqual({
			email: 'ada@example.com',
			name: 'Ada',
		});

		expect(toSendgridAddress('ada@example.com')).toStrictEqual({ email: 'ada@example.com' });
	});
});

describe('toSendgridAttachment', () => {
	test('Encodes content to base64 and marks an attachment with a content id inline', async () => {
		// 1. A plain attachment carries its type and is sent as a regular attachment
		expect(
			await toSendgridAttachment({ filename: 'a.txt', content: 'hello', contentType: 'text/plain' }),
		).toStrictEqual({
			filename: 'a.txt',
			content: Buffer.from('hello').toString('base64'),
			type: 'text/plain',
			disposition: 'attachment',
		});

		// 2. A content id turns the attachment inline, so `cid:` references from the html resolve
		expect(
			await toSendgridAttachment({ filename: 'logo.png', content: Buffer.from('png'), cid: 'logo' }),
		).toStrictEqual({
			filename: 'logo.png',
			content: Buffer.from('png').toString('base64'),
			disposition: 'inline',
			contentId: 'logo',
		});
	});

	test('Reads a path', async () => {
		// 1. This very file is the attachment; base64 of a non-empty file proves the path was read
		const attachment = await toSendgridAttachment({
			filename: 'self.ts',
			path: new URL(import.meta.url).pathname,
		});

		expect(attachment.filename).toBe('self.ts');
		expect(Buffer.from(attachment.content, 'base64').length).toBeGreaterThan(0);
	});

	test('Throws without content or path', async () => {
		// 1. An attachment without a source is refused by name
		await expect(toSendgridAttachment({ filename: 'x' })).rejects.toThrow(/neither content nor path/);
	});
});

describe('toSendgridMail', () => {
	test('Maps addresses to objects, category and tags to categories, attachments to base64', async () => {
		// 1. Every field of the message finds its SendGrid name; the sandbox flag rides in `mailSettings`
		expect(
			await toSendgridMail(
				{
					to: [{ name: 'Ada', address: 'ada@example.com' }, 'Bob <bob@example.com>'],
					cc: ['cc@example.com'],
					from: { name: 'Acme', address: 'no-reply@acme.test' },
					replyTo: 'support@acme.test',
					subject: 'Hi',
					html: '<p>Hi</p>',
					headers: { 'X-Campaign': 'welcome' },
					attachments: [
						{ filename: 'a.txt', content: 'hello', contentType: 'text/plain' },
						{ filename: 'logo.png', content: Buffer.from('png'), cid: 'logo' },
					],
					tags: ['welcome'],
				},
				true,
			),
		).toStrictEqual({
			to: [
				{ email: 'ada@example.com', name: 'Ada' },
				{ email: 'bob@example.com', name: 'Bob' },
			],
			from: { email: 'no-reply@acme.test', name: 'Acme' },
			cc: [{ email: 'cc@example.com' }],
			replyTo: { email: 'support@acme.test' },
			subject: 'Hi',
			html: '<p>Hi</p>',
			headers: { 'X-Campaign': 'welcome' },
			categories: ['transactional', 'welcome'],
			mailSettings: { sandboxMode: { enable: true } },
			attachments: [
				{
					filename: 'a.txt',
					content: Buffer.from('hello').toString('base64'),
					type: 'text/plain',
					disposition: 'attachment',
				},
				{
					filename: 'logo.png',
					content: Buffer.from('png').toString('base64'),
					disposition: 'inline',
					contentId: 'logo',
				},
			],
		});
	});

	test('Leaves optional fields out and keeps sandbox off by default', async () => {
		// 1. A minimal message carries no `undefined` keys and no `mailSettings`, so the request stays what the API expects
		expect(
			await toSendgridMail({ to: 'a@b.c', from: 'x@y.z', subject: 'x', text: 'x', category: 'marketing' }),
		).toStrictEqual({
			to: [{ email: 'a@b.c' }],
			from: { email: 'x@y.z' },
			subject: 'x',
			text: 'x',
			categories: ['marketing'],
		});
	});

	test('Throws without a sender', async () => {
		// 1. SendGrid requires `from`; the mapper refuses the message by name before any request goes out
		await expect(toSendgridMail({ to: 'a@b.c', subject: 'x', text: 'x' })).rejects.toThrow(/"from"/);
	});
});
