/**
 * Tests of the Mailgun driver class with the SDK mocked; the message mapper has its own tests in
 * `to-mailgun-message.test.ts`.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import defaultExport from '../index.js';
import { DEFAULT_MAILGUN_HOST } from './constants.js';
import { MailDriverMailgun } from './driver.js';

/**
 * Spy standing in for the messages API's `create()`, shared by every client so a test can script Mailgun's answer and
 * inspect the request.
 *
 * @internal
 */
const create = vi.fn();

/**
 * Spy standing in for the domains API's `get()`, the call `verify()` makes.
 *
 * @internal
 */
const get = vi.fn();

/**
 * Stand-in for the `Mailgun` class's `client()` factory: hands out a client whose messages and domains APIs are the
 * shared spies.
 */
const client = vi.fn(() => ({ messages: { create }, domains: { get } }));

vi.mock('mailgun.js', () => ({
	/**
	 * Stand-in for the `Mailgun` class of `mailgun.js`: hands out a client whose messages and domains APIs are the
	 * shared spies, so each test can script Mailgun's answer and inspect the request.
	 */
	default: class {
		/**
		 * Client factory the driver calls, recorded so the tests can check the key, region and timeout it received.
		 *
		 * @internal
		 */
		client = client;

		/**
		 * Take the FormData implementation the way the real SDK does.
		 *
		 * @param formData - The FormData class the driver passes; unused by the mock.
		 */
		constructor(public formData: unknown) {}
	},
}));

afterEach(() => {
	vi.clearAllMocks();
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
