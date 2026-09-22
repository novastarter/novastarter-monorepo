/**
 * Tests of `to-sendgrid-mail`: how a message, its addresses and its attachments become the payload of SendGrid's
 * `send()`.
 */
import { describe, expect, test } from 'vitest';
import { toSendgridAddress, toSendgridAttachment, toSendgridMail } from './to-sendgrid-mail.js';

describe('toSendgridAddress', () => {
	test('Unwraps a display-name string and keeps the name of an object', () => {
		// 1. SendGrid wants the bare address in `email`; the display name of a string form is dropped, an object keeps its own
		expect(toSendgridAddress('Bob <bob@example.com>')).toStrictEqual({ email: 'bob@example.com' });

		expect(toSendgridAddress({ name: 'Ada', address: 'ada@example.com' })).toStrictEqual({
			email: 'ada@example.com',
			name: 'Ada',
		});
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
			to: [{ email: 'ada@example.com', name: 'Ada' }, { email: 'bob@example.com' }],
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
