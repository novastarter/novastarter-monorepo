/**
 * Tests of the Resend driver class with the SDK mocked; the message mapper has its own tests in
 * `to-resend-email.test.ts`.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import defaultExport from '../index.js';
import { MailDriverResend } from './driver.js';

/**
 * Spy standing in for `Emails.send()`, shared by every instance so a test can script Resend's answer and inspect the
 * payload the driver hands over.
 *
 * @internal
 */
const send = vi.fn();

vi.mock('resend', () => ({
	/**
	 * Stand-in for the `Resend` class of the SDK: exposes the emails API as the shared spy, so each test can script
	 * Resend's answer and inspect the request.
	 */
	Resend: class {
		/**
		 * Emails API the driver calls, recorded so the tests can check the payload it received.
		 *
		 * @internal
		 */
		emails = { send };

		/**
		 * Take the API key the way the real SDK does.
		 *
		 * @param apiKey - The key the driver passes; unused by the mock.
		 */
		constructor(public apiKey: string) {}
	},
}));

afterEach(() => {
	vi.clearAllMocks();
});

describe('MailDriverResend', () => {
	test('Sends and answers the id, throws on the SDK error value with it as the cause', async () => {
		// 1. A successful send answers the id Resend assigned
		send.mockResolvedValueOnce({ data: { id: 'email-1' }, error: null });

		const driver = new MailDriverResend({ apiKey: 're_test' });
		const message = { to: 'ada@example.com', from: 'no-reply@acme.test', subject: 'Hi', text: 'x' };

		expect(await driver.send(message)).toStrictEqual({
			messageId: 'email-1',
			accepted: ['ada@example.com'],
			rejected: [],
		});

		expect(send).toHaveBeenCalledWith(expect.objectContaining({ from: 'no-reply@acme.test', to: ['ada@example.com'] }));

		// 2. The SDK reports failures as a value; the driver turns them into a throw naming the provider and keeps the
		//    value as the cause, so the caller can read the status code
		const error = { name: 'invalid_from_address', message: 'Verify the domain', statusCode: 422 };

		send.mockResolvedValueOnce({ data: null, error });

		await expect(driver.send(message)).rejects.toMatchObject({
			message: 'Resend: invalid_from_address: Verify the domain',
			cause: error,
		});

		// 3. A missing key is refused by name
		expect(() => new MailDriverResend({ apiKey: '' })).toThrow(/"apiKey"/);
		expect(defaultExport).toBe(MailDriverResend);
	});

	test('Sends attachments base64-encoded, a text body read into bytes first', async () => {
		// 1. The mapper runs unmocked: the payload Resend receives must carry base64, never raw text or a local path
		send.mockResolvedValueOnce({ data: { id: 'email-2' }, error: null });

		const driver = new MailDriverResend({ apiKey: 're_test' });

		await driver.send({
			to: 'ada@example.com',
			from: 'no-reply@acme.test',
			subject: 'Hi',
			text: 'x',
			attachments: [{ filename: 'report.csv', content: 'id,name\n1,Ada' }],
		});

		expect(send).toHaveBeenCalledWith(
			expect.objectContaining({
				attachments: [{ filename: 'report.csv', content: Buffer.from('id,name\n1,Ada').toString('base64') }],
			}),
		);
	});
});
