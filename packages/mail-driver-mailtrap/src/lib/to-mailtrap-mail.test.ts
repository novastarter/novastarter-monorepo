/**
 * Tests of `to-mailtrap-mail`: how a message, its addresses and its attachments become Mailtrap's `send()` payload.
 */
import { describe, expect, test } from 'vitest';
import {
	MAILTRAP_CUSTOM_VARIABLES_MAX_BYTES,
	toMailtrapAddress,
	toMailtrapAttachment,
	toMailtrapMail,
} from './to-mailtrap-mail.js';

describe('toMailtrapAddress', () => {
	test('Splits a name from an address and keeps the name of a formatted string', () => {
		// 1. An object keeps its name; a display-name string is parsed, so the name reaches Mailtrap either way
		expect(toMailtrapAddress({ name: 'Ada', address: 'ada@example.com' })).toStrictEqual({
			email: 'ada@example.com',
			name: 'Ada',
		});

		expect(toMailtrapAddress('Ada <ada@example.com>')).toStrictEqual({
			email: 'ada@example.com',
			name: 'Ada',
		});
	});
});

describe('toMailtrapAttachment', () => {
	test('Marks an attachment with a content id as inline', async () => {
		// 1. The SDK takes the Buffer as is; the content id sets the disposition
		expect(
			await toMailtrapAttachment({
				filename: 'logo.png',
				content: Buffer.from('png'),
				contentType: 'image/png',
				cid: 'logo',
			}),
		).toStrictEqual({
			filename: 'logo.png',
			content: Buffer.from('png'),
			disposition: 'inline',
			type: 'image/png',
			content_id: 'logo',
		});
	});

	test('Reads a path', async () => {
		// 1. This very file is the attachment; a Buffer proves the path was read
		const attachment = await toMailtrapAttachment({ filename: 'self.ts', path: new URL(import.meta.url).pathname });

		expect(attachment.disposition).toBe('attachment');
		expect(Buffer.isBuffer(attachment.content)).toBe(true);
	});

	test('Throws without content or path', async () => {
		// 1. An attachment without a source is refused by name
		await expect(toMailtrapAttachment({ filename: 'x' })).rejects.toThrow('neither content nor path');
	});
});

describe('toMailtrapMail', () => {
	test('Maps the message into Mailtrap shape with the tags as a custom variable', async () => {
		// 1. Every field finds its Mailtrap name; text content is read into a Buffer like every attachment
		expect(
			await toMailtrapMail({
				to: [{ name: 'Ada', address: 'ada@example.com' }],
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
				tags: ['welcome', 'v2'],
			}),
		).toStrictEqual({
			from: { email: 'no-reply@acme.test', name: 'Acme' },
			to: [{ email: 'ada@example.com', name: 'Ada' }],
			cc: [{ email: 'cc@example.com' }],
			bcc: [{ email: 'bcc@example.com' }],
			reply_to: { email: 'support@acme.test', name: 'Support' },
			subject: 'Hi',
			html: '<p>Hi</p>',
			text: 'Hi',
			category: 'marketing',
			headers: { 'X-Campaign': 'welcome' },
			custom_variables: { tags: 'welcome,v2' },
			attachments: [
				{ filename: 'a.txt', content: Buffer.from('hello'), disposition: 'attachment', type: 'text/plain' },
			],
		});
	});

	test('Defaults the category and leaves the optional fields out', async () => {
		// 1. Nothing optional given: nothing optional sent
		expect(await toMailtrapMail({ to: 'a@example.com', from: 'me@acme.test', subject: 'S', text: 'T' })).toStrictEqual({
			from: { email: 'me@acme.test' },
			to: [{ email: 'a@example.com' }],
			subject: 'S',
			text: 'T',
			category: 'transactional',
		});
	});

	test('Cuts the joined tags until the custom_variables payload fits Mailtrap limit', async () => {
		// 1. Mailtrap caps the custom_variables payload at MAILTRAP_CUSTOM_VARIABLES_MAX_BYTES of JSON, so a tag list
		//    past it is cut rather than having the variables dropped whole
		const tags = Array.from({ length: 40 }, (_, index) => `onboarding-sequence-step-${index}`);

		const mail = await toMailtrapMail({ to: 'a@example.com', from: 'me@acme.test', subject: 'S', tags });
		const customVariables = mail.custom_variables as { tags: string };

		expect(Buffer.byteLength(JSON.stringify(customVariables), 'utf8')).toBeLessThanOrEqual(
			MAILTRAP_CUSTOM_VARIABLES_MAX_BYTES,
		);

		expect(customVariables.tags.startsWith('onboarding-sequence-step-0,')).toBe(true);
	});

	test('Leaves the custom variable out when only empty tags are given', async () => {
		// 1. Tags that record nothing send no custom variable at all
		expect(await toMailtrapMail({ to: 'a@example.com', from: 'me@acme.test', subject: 'S', tags: [''] })).toStrictEqual(
			{
				from: { email: 'me@acme.test' },
				to: [{ email: 'a@example.com' }],
				subject: 'S',
				category: 'transactional',
			},
		);
	});

	test('Requires a sender', async () => {
		// 1. A message without a sender is refused by name
		await expect(toMailtrapMail({ to: 'a@example.com', subject: 'S' })).rejects.toThrow('"from"');
	});
});
