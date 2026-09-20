/**
 * Tests of the Mailjet driver with the SDK mocked.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import defaultExport, { MailDriverMailjet, toMailjetMessage } from './index.js';

const request = vi.fn();
const post = vi.fn(() => ({ request }));

vi.mock('node-mailjet', () => ({
	Client: class {
		post = post;

		constructor(public options: unknown) {}
	},
}));

afterEach(() => {
	vi.clearAllMocks();
});

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
			ReplyTo: { Email: 'support@acme.test' },
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

describe('MailDriverMailjet', () => {
	test('Posts to send v3.1 and reads the per-recipient ids; a non-success status throws', async () => {
		// 1. A successful send answers the first recipient's message id
		request.mockResolvedValueOnce({
			body: { Messages: [{ Status: 'success', To: [{ Email: 'ada@example.com', MessageID: 123, MessageUUID: 'u' }] }] },
		});

		const driver = new MailDriverMailjet({ apiKey: 'k', apiSecret: 's', sandbox: true });
		const message = { to: 'ada@example.com', from: 'no-reply@acme.test', subject: 'Hi', text: 'x' };

		expect(await driver.send(message)).toStrictEqual({
			messageId: '123',
			accepted: ['ada@example.com'],
			rejected: [],
			response: 'success',
		});

		// 2. The request went to Send API v3.1 with the sandbox flag on the body
		expect(post).toHaveBeenCalledWith('send', { version: 'v3.1' });

		expect(request).toHaveBeenCalledWith(
			expect.objectContaining({ SandboxMode: true, Messages: [expect.objectContaining({ Subject: 'Hi' })] }),
		);

		// 3. A 200 with `Status: 'error'` is a failure; Mailjet's messages are listed
		request.mockResolvedValueOnce({
			body: { Messages: [{ Status: 'error', Errors: [{ ErrorMessage: 'Sender not validated' }] }] },
		});

		await expect(driver.send(message)).rejects.toThrow('Mailjet: Sender not validated');

		// 4. A missing secret is refused by name
		expect(() => new MailDriverMailjet({ apiKey: 'k', apiSecret: '' })).toThrow(/"apiSecret"/);
		expect(defaultExport).toBe(MailDriverMailjet);
	});
});
