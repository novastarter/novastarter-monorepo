/**
 * Tests of the Mailjet driver class with the SDK mocked; the message mapper is covered in `to-mailjet-message.test.ts`.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import defaultExport from '../index.js';
import { MailDriverMailjet } from './driver.js';

/**
 * Spy standing in for the request the SDK's `post().request()` chain makes, shared by every client so a test can
 * script Mailjet's answer.
 *
 * @internal
 */
const request = vi.fn();

/**
 * Spy standing in for the SDK client's `post()`, routed to the shared request spy.
 *
 * @internal
 */
const post = vi.fn(() => ({ request }));

vi.mock('node-mailjet', () => ({
	/**
	 * Stand-in for the SDK's `Client`: records the constructor options and routes `post()` to the shared spy.
	 */
	Client: class {
		/**
		 * The shared `post` spy, so the test can assert the endpoint and API version the driver asked for.
		 *
		 * @internal
		 */
		post = post;

		/**
		 * Keep the options the driver built the client with.
		 *
		 * @param options - The key pair the driver passes to the SDK.
		 */
		constructor(public options: unknown) {}
	},
}));

afterEach(() => {
	vi.clearAllMocks();
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

		// 4. A transport failure names the provider, the SDK's error as the cause
		const failure = new Error('socket hang up');

		request.mockRejectedValueOnce(failure);

		await expect(driver.send(message)).rejects.toMatchObject({
			message: 'Mailjet: socket hang up',
			cause: failure,
		});

		// 5. A missing secret is refused by name
		expect(() => new MailDriverMailjet({ apiKey: 'k', apiSecret: '' })).toThrow(/"apiSecret"/);
		expect(defaultExport).toBe(MailDriverMailjet);
	});
});
