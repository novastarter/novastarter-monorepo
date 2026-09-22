/**
 * Tests of the Postmark driver class with the SDK mocked; the message mapping is tested in
 * `to-postmark-message.test.ts`.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import defaultExport from '../index.js';
import { MailDriverPostmark } from './driver.js';

/**
 * Spy standing in for `ServerClient.sendEmail()`, shared by every instance so a test can script Postmark's answer and
 * inspect the request.
 *
 * @internal
 */
const sendEmail = vi.fn();

/**
 * Spy standing in for `ServerClient.getServer()`, the call `verify()` makes.
 *
 * @internal
 */
const getServer = vi.fn();

/**
 * Spy recording every `ServerClient` construction, so a test can check the token and configuration the driver built
 * the client with.
 *
 * @internal
 */
const construct = vi.fn();

vi.mock('postmark', () => ({
	/**
	 * Stand-in for the SDK's `ServerClient`: records its construction and routes the two calls the driver makes to
	 * the shared spies.
	 */
	ServerClient: class {
		/**
		 * Spy the driver's `send()` reaches.
		 *
		 * @internal
		 */
		sendEmail = sendEmail;

		/**
		 * Spy the driver's `verify()` reaches.
		 *
		 * @internal
		 */
		getServer = getServer;

		/**
		 * Record the token and configuration the driver builds the client with.
		 *
		 * @param args - Whatever the driver passes: the token and the optional configuration.
		 */
		constructor(...args: unknown[]) {
			construct(...args);
		}
	},
}));

afterEach(() => {
	vi.clearAllMocks();
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

	test('Names the provider in a refusal, keeping the SDK error as the cause', async () => {
		// 1. The SDK's error is wrapped, not replaced: the cause keeps its code and status for the caller
		const refusal = Object.assign(new Error('Inactive recipient'), { code: 406, statusCode: 422 });

		sendEmail.mockRejectedValueOnce(refusal);

		const driver = new MailDriverPostmark({ serverToken: 'token' });

		await expect(driver.send({ to: 'a@example.com', from: 'me@acme.test', subject: 'S' })).rejects.toMatchObject({
			message: 'Postmark: Inactive recipient',
			cause: refusal,
		});
	});

	test('Verifies by reading the server', async () => {
		const driver = new MailDriverPostmark({ serverToken: 'token' });

		// 1. A server record means the token is good
		getServer.mockResolvedValueOnce({ ID: 1, Name: 'Production' });
		await expect(driver.verify()).resolves.toBeUndefined();

		// 2. A refusal passes with the provider's name, the SDK's error as the cause
		getServer.mockRejectedValueOnce(new Error('Bad token'));
		await expect(driver.verify()).rejects.toThrow('Postmark: Bad token');
	});
});
