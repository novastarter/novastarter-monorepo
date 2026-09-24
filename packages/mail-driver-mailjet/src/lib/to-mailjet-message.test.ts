/**
 * Tests of `to-mailjet-message`: how a `MailMessage` becomes one entry of Mailjet's Send API v3.1 `Messages`.
 */
import { InvalidPayloadError } from '@novastarter/errors';
import { describe, expect, test } from 'vitest';
import { toMailjetMessage } from './to-mailjet-message.js';

describe('toMailjetMessage', () => {
	test('Maps the message into Mailjet shape, inline attachments apart', async () => {
		expect(
			await toMailjetMessage({
				to: [{ name: 'Ada', address: 'ada@example.com' }],
				bcc: ['bcc@example.com'],
				from: { name: 'Acme', address: 'no-reply@acme.test' },
				replyTo: 'Support <support@acme.test>',
				subject: 'Hi',
				html: '<p>Hi</p>',
				text: 'Hi',
				headers: { 'X-Campaign': 'welcome' },
				attachments: [
					{ filename: 'a.txt', content: 'hello' },
					{ filename: 'logo.png', content: Buffer.from('png'), contentType: 'image/png', cid: 'logo' },
				],
				category: 'marketing',
				tags: ['welcome', 'v2'],
			}),
		).toStrictEqual({
			From: { Email: 'no-reply@acme.test', Name: 'Acme' },
			To: [{ Email: 'ada@example.com', Name: 'Ada' }],
			Bcc: [{ Email: 'bcc@example.com' }],
			ReplyTo: { Email: 'support@acme.test', Name: 'Support' },
			Subject: 'Hi',
			HTMLPart: '<p>Hi</p>',
			TextPart: 'Hi',
			Headers: { 'X-Campaign': 'welcome' },
			CustomCampaign: 'marketing',
			CustomID: 'welcome,v2',
			Attachments: [
				{
					ContentType: 'application/octet-stream',
					Filename: 'a.txt',
					Base64Content: Buffer.from('hello').toString('base64'),
				},
			],
			InlinedAttachments: [
				{
					ContentType: 'image/png',
					Filename: 'logo.png',
					Base64Content: Buffer.from('png').toString('base64'),
					ContentID: 'logo',
				},
			],
		});

		await expect(toMailjetMessage({ to: 'a@b.c', subject: 'x', text: 'x' })).rejects.toThrow(InvalidPayloadError);
		await expect(toMailjetMessage({ to: 'a@b.c', subject: 'x', text: 'x' })).rejects.toThrow(/"from"/);
	});

	test('Cuts the joined tags at the CustomID limit, so an over-long value never fails the send', async () => {
		// Mailjet refuses a request whose `CustomID` passes 255 characters; joined tags that long must trim the
		// analytics instead of failing the whole send
		const message = await toMailjetMessage({
			to: 'a@b.c',
			from: 'x@y.z',
			subject: 'x',
			text: 'x',
			tags: ['a'.repeat(200), 'b'.repeat(200)],
		});

		// A partial id still groups the statistics, so the value is cut rather than dropped
		expect(message.CustomID).toBe(`${'a'.repeat(200)},${'b'.repeat(54)}`);
	});
});
