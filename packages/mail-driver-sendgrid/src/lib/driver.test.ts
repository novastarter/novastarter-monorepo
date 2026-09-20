/**
 * Tests of the SendGrid driver with the SDK mocked.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import defaultExport from '../index.js';
import { MailDriverSendgrid } from './driver.js';
import { toSendgridAttachment, toSendgridMail } from './to-sendgrid-mail.js';

const send = vi.fn();
const setApiKey = vi.fn();

vi.mock('@sendgrid/mail', () => ({
	MailService: class {
		setApiKey = setApiKey;

		send = send;
	},
}));

afterEach(() => {
	vi.clearAllMocks();
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

		// 2. A message without a sender and an attachment without a source are refused by name
		await expect(toSendgridMail({ to: 'a@b.c', subject: 'x', text: 'x' })).rejects.toThrow(/"from"/);
		await expect(toSendgridAttachment({ filename: 'x' })).rejects.toThrow(/neither content nor path/);
	});
});

describe('MailDriverSendgrid', () => {
	test('Sets the key, sends and reads the message id from the response headers', async () => {
		// 1. The key goes to a client of the driver's own
		send.mockResolvedValueOnce([{ statusCode: 202, headers: { 'x-message-id': 'sg-1' } }, {}]);

		const driver = new MailDriverSendgrid({ apiKey: 'SG.test' });

		expect(setApiKey).toHaveBeenCalledWith('SG.test');

		// 2. The message id is the response header; the status code is the response line
		expect(
			await driver.send({ to: 'ada@example.com', from: 'no-reply@acme.test', subject: 'Hi', text: 'x' }),
		).toStrictEqual({
			messageId: 'sg-1',
			accepted: ['ada@example.com'],
			rejected: [],
			response: '202',
		});

		// 3. The SDK's error passes through untouched; a missing key is refused by name
		send.mockRejectedValueOnce(new Error('Forbidden'));
		await expect(driver.send({ to: 'a@b.c', from: 'x@y.z', subject: 'x', text: 'x' })).rejects.toThrow('Forbidden');

		expect(() => new MailDriverSendgrid({ apiKey: '' })).toThrow(/"apiKey"/);
		expect(defaultExport).toBe(MailDriverSendgrid);
	});
});
