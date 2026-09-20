/**
 * Tests of the Postmark driver with the SDK mocked.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import defaultExport, { MailDriverPostmark, toPostmarkAttachment, toPostmarkMessage } from './index.js';

const sendEmail = vi.fn();
const getServer = vi.fn();
const construct = vi.fn();

vi.mock('postmark', () => ({
	ServerClient: class {
		sendEmail = sendEmail;

		getServer = getServer;

		constructor(...args: unknown[]) {
			construct(...args);
		}
	},
}));

afterEach(() => {
	vi.clearAllMocks();
});

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

describe('MailDriverPostmark', () => {
	test('Requires the server token and is the default export', () => {
		// 1. A missing token is refused by name
		expect(() => new MailDriverPostmark({ serverToken: '' })).toThrow('"serverToken"');
		expect(defaultExport).toBe(MailDriverPostmark);
	});

	test('Builds the client with the token and the timeout', () => {
		// 1. Without a timeout the SDK gets no configuration at all
		new MailDriverPostmark({ serverToken: 'token' });

		expect(construct).toHaveBeenLastCalledWith('token', undefined);

		// 2. With one, only the timeout is set
		new MailDriverPostmark({ serverToken: 'token', timeout: 30 });

		expect(construct).toHaveBeenLastCalledWith('token', { timeout: 30 });
	});

	test('Sends and maps the result', async () => {
		// 1. Postmark answers one id and a message line per send
		sendEmail.mockResolvedValueOnce({
			To: 'ada@example.com',
			SubmittedAt: '2026-09-12T00:00:00Z',
			MessageID: 'b7bc2f4a-e38e-4336-ac7d-e6d5e1f9b2c1',
			ErrorCode: 0,
			Message: 'OK',
		});

		const driver = new MailDriverPostmark({ serverToken: 'token', messageStream: 'outbound' });

		const result = await driver.send({
			to: ['Ada <ada@example.com>'],
			from: 'me@acme.test',
			subject: 'S',
			text: 'T',
			tags: ['welcome'],
		});

		// 2. The location's stream and the first tag went out with the message
		expect(sendEmail).toHaveBeenCalledWith(
			expect.objectContaining({ To: 'Ada <ada@example.com>', Tag: 'welcome', MessageStream: 'outbound' }),
		);

		// 3. Every recipient counts as accepted; the message line is the response
		expect(result).toStrictEqual({
			messageId: 'b7bc2f4a-e38e-4336-ac7d-e6d5e1f9b2c1',
			accepted: ['ada@example.com'],
			rejected: [],
			response: 'OK',
		});
	});

	test('Lets a refusal of the API through', async () => {
		// 1. The SDK's error keeps its code and status for the caller
		sendEmail.mockRejectedValueOnce(Object.assign(new Error('Inactive recipient'), { code: 406, statusCode: 422 }));

		const driver = new MailDriverPostmark({ serverToken: 'token' });

		await expect(driver.send({ to: 'a@example.com', from: 'me@acme.test', subject: 'S' })).rejects.toMatchObject({
			message: 'Inactive recipient',
			code: 406,
		});
	});

	test('Verifies by reading the server', async () => {
		const driver = new MailDriverPostmark({ serverToken: 'token' });

		// 1. A server record means the token is good
		getServer.mockResolvedValueOnce({ ID: 1, Name: 'Production' });
		await expect(driver.verify()).resolves.toBeUndefined();

		// 2. A refusal passes through
		getServer.mockRejectedValueOnce(new Error('Bad token'));
		await expect(driver.verify()).rejects.toThrow('Bad token');
	});
});
