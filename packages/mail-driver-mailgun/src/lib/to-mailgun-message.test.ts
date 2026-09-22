/**
 * Tests of `to-mailgun-message`: how a message and its attachments become the form fields of Mailgun's
 * `messages.create()`.
 */
import { describe, expect, test } from 'vitest';
import { toMailgunFile, toMailgunMessage } from './to-mailgun-message.js';

describe('toMailgunFile', () => {
	test('Keeps inline content and takes the content id as the filename', async () => {
		// 1. Mailgun matches `cid:` references by filename, so the content id stands in for it
		expect(await toMailgunFile({ filename: 'logo.png', content: Buffer.from('png'), cid: 'logo' })).toStrictEqual({
			filename: 'logo',
			data: Buffer.from('png'),
		});
	});

	test('Reads a path', async () => {
		// 1. This very file is the attachment; a Buffer proves the path was read
		const file = await toMailgunFile({ filename: 'self.ts', path: new URL(import.meta.url).pathname });

		expect(file.filename).toBe('self.ts');
		expect(Buffer.isBuffer(file.data)).toBe(true);
	});

	test('Throws without content or path', async () => {
		// 1. An attachment without a source is refused by name
		await expect(toMailgunFile({ filename: 'x' })).rejects.toThrow('neither content nor path');
	});
});

describe('toMailgunMessage', () => {
	test('Maps the message into Mailgun form fields, inline files apart', async () => {
		// 1. Headers become `h:` fields, tags `o:tag`; text content is read into a Buffer like every attachment
		expect(
			await toMailgunMessage(
				{
					to: [{ name: 'Ada', address: 'ada@example.com' }],
					cc: ['cc@example.com'],
					bcc: ['bcc@example.com'],
					from: { name: 'Acme', address: 'no-reply@acme.test' },
					replyTo: 'Support <support@acme.test>',
					subject: 'Hi',
					html: '<p>Hi</p>',
					text: 'Hi',
					headers: { 'X-Campaign': 'welcome' },
					attachments: [
						{ filename: 'a.txt', content: 'hello', contentType: 'text/plain' },
						{ filename: 'logo.png', content: Buffer.from('png'), contentType: 'image/png', cid: 'logo' },
					],
					category: 'marketing',
					tags: ['welcome', 'v2'],
				},
				true,
			),
		).toStrictEqual({
			from: 'Acme <no-reply@acme.test>',
			to: ['Ada <ada@example.com>'],
			cc: ['cc@example.com'],
			bcc: ['bcc@example.com'],
			subject: 'Hi',
			html: '<p>Hi</p>',
			text: 'Hi',
			'o:tag': ['marketing', 'welcome', 'v2'],
			'o:testmode': true,
			'h:Reply-To': 'Support <support@acme.test>',
			'h:X-Campaign': 'welcome',
			attachment: [{ filename: 'a.txt', data: Buffer.from('hello'), contentType: 'text/plain' }],
			inline: [{ filename: 'logo', data: Buffer.from('png'), contentType: 'image/png' }],
		});
	});

	test('Defaults the tag to the transactional category and leaves the optional fields out', async () => {
		// 1. Nothing optional given: nothing optional sent, the category is still a tag
		expect(
			await toMailgunMessage({ to: 'a@example.com', from: 'me@acme.test', subject: 'S', text: 'T' }),
		).toStrictEqual({
			from: 'me@acme.test',
			to: ['a@example.com'],
			subject: 'S',
			text: 'T',
			'o:tag': ['transactional'],
		});
	});

	test('Requires a sender', async () => {
		// 1. A message without a sender is refused by name
		await expect(toMailgunMessage({ to: 'a@example.com', subject: 'S' })).rejects.toThrow('"from"');
	});
});
