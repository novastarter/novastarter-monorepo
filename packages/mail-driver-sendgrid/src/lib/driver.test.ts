/**
 * Tests of the SendGrid driver class with the SDK mocked; the message mapper has its own tests in
 * `to-sendgrid-mail.test.ts`.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import defaultExport from '../index.js';
import { MailDriverSendgrid } from './driver.js';

const send = vi.fn();
const setApiKey = vi.fn();

vi.mock('@sendgrid/mail', () => ({
	/**
	 * Stand-in for the `MailService` class of `@sendgrid/mail`: its key setter and `send()` are the shared spies, so
	 * each test can script SendGrid's answer and inspect the key and payload the driver hands over.
	 */
	MailService: class {
		/**
		 * Key setter the driver calls in its constructor, recorded so the tests can check the key it received.
		 *
		 * @internal
		 */
		setApiKey = setApiKey;

		/**
		 * Request sender the driver calls, scripted per test with SendGrid's response tuple or error.
		 *
		 * @internal
		 */
		send = send;
	},
}));

afterEach(() => {
	vi.clearAllMocks();
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
