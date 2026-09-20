/**
 * Tests of the Mailgun driver with the SDK mocked.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import defaultExport, { DEFAULT_MAILGUN_HOST, MailDriverMailgun, toMailgunFile, toMailgunMessage } from './index.js';

const create = vi.fn();
const get = vi.fn();
const client = vi.fn(() => ({ messages: { create }, domains: { get } }));

vi.mock('mailgun.js', () => ({
	default: class {
		client = client;

		constructor(public formData: unknown) {}
	},
}));

afterEach(() => {
	vi.clearAllMocks();
});

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

describe('MailDriverMailgun', () => {
	test('Requires the key and the domain, and is the default export', () => {
		// 1. Either missing option is refused by name
		expect(() => new MailDriverMailgun({ apiKey: '', domain: 'mg.acme.test' })).toThrow('"apiKey"');
		expect(() => new MailDriverMailgun({ apiKey: 'key', domain: '' })).toThrow('"domain"');
		expect(defaultExport).toBe(MailDriverMailgun);
	});

	test('Builds the client for the US region by default and for the host given', () => {
		// 1. No host: the US API over https
		new MailDriverMailgun({ apiKey: 'key', domain: 'mg.acme.test' });

		expect(client).toHaveBeenLastCalledWith({ username: 'api', key: 'key', url: `https://${DEFAULT_MAILGUN_HOST}` });

		// 2. A bare host gets https; the timeout goes along
		new MailDriverMailgun({ apiKey: 'key', domain: 'mg.acme.test', host: 'api.eu.mailgun.net', timeout: 5000 });

		expect(client).toHaveBeenLastCalledWith({
			username: 'api',
			key: 'key',
			url: 'https://api.eu.mailgun.net',
			timeout: 5000,
		});

		// 3. A full URL is taken as is, for a local stand-in
		new MailDriverMailgun({ apiKey: 'key', domain: 'mg.acme.test', host: 'http://localhost:8080' });

		expect(client).toHaveBeenLastCalledWith(expect.objectContaining({ url: 'http://localhost:8080' }));
	});

	test('Sends on the domain and maps the result', async () => {
		// 1. Mailgun answers an id in angle brackets and a `Queued.` line
		create.mockResolvedValueOnce({ id: '<20260912.1@mg.acme.test>', message: 'Queued. Thank you.', status: 200 });

		const driver = new MailDriverMailgun({ apiKey: 'key', domain: 'mg.acme.test', testMode: true });

		const result = await driver.send({
			to: ['Ada <ada@example.com>', 'bob@example.com'],
			from: 'me@acme.test',
			subject: 'S',
			text: 'T',
		});

		// 2. The request went to the location's domain with the test mode on
		expect(create).toHaveBeenCalledWith(
			'mg.acme.test',
			expect.objectContaining({ to: ['Ada <ada@example.com>', 'bob@example.com'], 'o:testmode': true }),
		);

		// 3. The brackets are stripped from the id; every recipient counts as accepted
		expect(result).toStrictEqual({
			messageId: '20260912.1@mg.acme.test',
			accepted: ['ada@example.com', 'bob@example.com'],
			rejected: [],
			response: 'Queued. Thank you.',
		});
	});

	test('Names the provider in a refusal, keeping the SDK error as the cause', async () => {
		// 1. The SDK's error is wrapped, not replaced: the cause keeps its status and details
		const refusal = Object.assign(new Error('Forbidden'), { status: 401, details: 'Invalid private key' });

		create.mockRejectedValueOnce(refusal);

		const driver = new MailDriverMailgun({ apiKey: 'bad', domain: 'mg.acme.test' });

		await expect(driver.send({ to: 'a@example.com', from: 'me@acme.test', subject: 'S' })).rejects.toMatchObject({
			message: 'Mailgun: Forbidden',
			cause: refusal,
		});
	});

	test('Verifies the domain is active', async () => {
		const driver = new MailDriverMailgun({ apiKey: 'key', domain: 'mg.acme.test' });

		// 1. An active domain passes
		get.mockResolvedValueOnce({ name: 'mg.acme.test', state: 'active' });
		await expect(driver.verify()).resolves.toBeUndefined();
		expect(get).toHaveBeenCalledWith('mg.acme.test');

		// 2. Any other state fails, even though Mailgun answered 200
		get.mockResolvedValueOnce({ name: 'mg.acme.test', state: 'unverified' });
		await expect(driver.verify()).rejects.toThrow('is unverified, not active');

		// 3. A refusal is wrapped with the provider's name
		get.mockRejectedValueOnce(new Error('Domain not found'));
		await expect(driver.verify()).rejects.toThrow('Mailgun: Domain not found');
	});
});
