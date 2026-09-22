/**
 * Tests of `to-mailjet-message`: how a `MailMessage` becomes one entry of Mailjet's Send API v3.1 `Messages`.
 */
import { describe, expect, test } from 'vitest';
import { toMailjetMessage } from './to-mailjet-message.js';

describe('toMailjetMessage', () => {
	test('Maps the message into Mailjet shape, inline attachments apart', async () => {
		// 1. Every field finds its Mailjet name; the attachment with a content id lands in `InlinedAttachments`
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

		// 2. A message without a sender is refused by name
		await expect(toMailjetMessage({ to: 'a@b.c', subject: 'x', text: 'x' })).rejects.toThrow(/"from"/);
	});
});
