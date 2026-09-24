/**
 * Tests of `to-resend-email`: how a message and its attachments become the payload of Resend's `emails.send()`.
 */
import { InvalidPayloadError } from '@novastarter/errors';
import { describe, expect, test } from 'vitest';
import {
	RESEND_TAG_COUNT,
	RESEND_TAG_LENGTH,
	toResendAttachment,
	toResendEmail,
	toResendTag,
} from './to-resend-email.js';

describe('toResendTag', () => {
	test('Replaces everything outside Resend character set with an underscore and cuts at the length limit', () => {
		// A space, a dot and a slash are outside Resend's name set
		expect(toResendTag('a b.c/d')).toBe('a_b_c_d');

		// Resend refuses a name past 256 characters, so the tail is cut rather than taking the whole send down
		expect(toResendTag('a'.repeat(RESEND_TAG_LENGTH + 10))).toHaveLength(RESEND_TAG_LENGTH);
	});
});

describe('toResendAttachment', () => {
	test('Encodes text content as base64 instead of forwarding it as given', async () => {
		// Resend base64-decodes a string `content`; raw text would come out corrupted or be refused
		expect(await toResendAttachment({ filename: 'report.csv', content: 'id,name\n1,Ada' })).toStrictEqual({
			filename: 'report.csv',
			content: Buffer.from('id,name\n1,Ada').toString('base64'),
		});
	});

	test('Encodes bytes as base64 and keeps the content type and content id', async () => {
		expect(
			await toResendAttachment({
				filename: 'logo.png',
				content: Buffer.from('png'),
				contentType: 'image/png',
				cid: 'logo',
			}),
		).toStrictEqual({
			filename: 'logo.png',
			content: Buffer.from('png').toString('base64'),
			contentType: 'image/png',
			contentId: 'logo',
		});
	});

	test('Reads a local path instead of forwarding it as a hosted URL', async () => {
		// Base64 of its bytes proves the path was read and not passed on
		const attachment = await toResendAttachment({ filename: 'self.ts', path: new URL(import.meta.url).pathname });

		expect(attachment).not.toHaveProperty('path');
		expect(Buffer.from(attachment.content as string, 'base64').toString('utf8')).toContain('toResendAttachment');
	});

	test('Throws without content or path', async () => {
		await expect(toResendAttachment({ filename: 'x' })).rejects.toThrow('neither content nor path');
	});
});

describe('toResendEmail', () => {
	test('Maps every field, formats addresses and turns category and tags into Resend tags', async () => {
		expect(
			await toResendEmail({
				to: [{ name: 'Ada', address: 'ada@example.com' }, 'bob@example.com'],
				cc: ['cc@example.com'],
				bcc: ['bcc@example.com'],
				from: { name: 'Acme', address: 'no-reply@acme.test' },
				replyTo: 'support@acme.test',
				subject: 'Hi',
				html: '<p>Hi</p>',
				text: 'Hi',
				headers: { 'X-Campaign': 'welcome' },
				attachments: [{ filename: 'logo.png', content: Buffer.from('png'), contentType: 'image/png', cid: 'logo' }],
				category: 'marketing',
				tags: ['welcome flow', 'v2'],
			}),
		).toStrictEqual({
			from: 'Acme <no-reply@acme.test>',
			to: ['Ada <ada@example.com>', 'bob@example.com'],
			cc: ['cc@example.com'],
			bcc: ['bcc@example.com'],
			replyTo: 'support@acme.test',
			subject: 'Hi',
			html: '<p>Hi</p>',
			text: 'Hi',
			headers: { 'X-Campaign': 'welcome' },
			attachments: [
				{
					filename: 'logo.png',
					content: Buffer.from('png').toString('base64'),
					contentType: 'image/png',
					contentId: 'logo',
				},
			],
			tags: [
				{ name: 'category', value: 'marketing' },
				{ name: 'welcome_flow', value: '1' },
				{ name: 'v2', value: '1' },
			],
		});
	});

	test('Drops a tag that sanitises to nothing and caps the list at the limit', async () => {
		// A tag with no characters from Resend's set has no name at all; Resend would reject it, so the tag drops and the
		// rest of the message still sends
		expect(
			await toResendEmail({ to: 'a@b.c', from: 'x@y.z', subject: 'x', text: 'x', tags: ['', 'welcome'] }),
		).toMatchObject({
			tags: [
				{ name: 'category', value: 'transactional' },
				{ name: 'welcome', value: '1' },
			],
		});

		// The category takes one of Resend's tag slots
		const tags = Array.from({ length: RESEND_TAG_COUNT + 5 }, (_, index) => `tag_${index}`);

		const email = await toResendEmail({ to: 'a@b.c', from: 'x@y.z', subject: 'x', text: 'x', tags });

		expect(email.tags).toHaveLength(RESEND_TAG_COUNT);
		expect(email.tags?.at(-1)).toStrictEqual({ name: `tag_${RESEND_TAG_COUNT - 2}`, value: '1' });
	});

	test('Refuses a message without a sender by name', async () => {
		await expect(toResendEmail({ to: 'a@b.c', subject: 'x', text: 'x' })).rejects.toThrow(/"from"/);
		await expect(toResendEmail({ to: 'a@b.c', subject: 'x', text: 'x' })).rejects.toThrow(InvalidPayloadError);
	});
});
