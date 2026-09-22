/**
 * Tests of the Mailtrap driver class with the SDK mocked; the mapper has its own suite in `to-mailtrap-mail.test.ts`.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import defaultExport from '../index.js';
import { MailDriverMailtrap } from './driver.js';

/**
 * Spy standing in for `MailtrapClient.send()`, shared by every instance so a test can script the API's answer.
 *
 * @internal
 */
const send = vi.fn();

/**
 * Spy standing in for `MailtrapClient.general.accounts.getAllAccounts()`, the call `verify()` makes.
 *
 * @internal
 */
const getAllAccounts = vi.fn();

/**
 * Spy recording the options every `MailtrapClient` was built with, so a test can check the host flags.
 *
 * @internal
 */
const construct = vi.fn();

vi.mock('mailtrap', () => ({
	/**
	 * Stand-in for the SDK's `MailtrapClient`: only the surface the driver touches, wired to the shared spies.
	 */
	MailtrapClient: class {
		/**
		 * The sending call, routed to the shared spy.
		 *
		 * @internal
		 */
		send = send;

		/**
		 * The accounts API the driver verifies through, routed to the shared spy.
		 *
		 * @internal
		 */
		general = { accounts: { getAllAccounts } };

		/**
		 * Record the client options instead of opening a connection.
		 *
		 * @param options - What the driver passed to the SDK.
		 */
		constructor(options: unknown) {
			construct(options);
		}
	},
}));

afterEach(() => {
	vi.clearAllMocks();
});

describe('MailDriverMailtrap', () => {
	test('Requires the token, an inbox in sandbox mode, and not both sandbox and bulk', () => {
		// 1. Every configuration error is reported by the option's name, before the SDK gets to refuse a send
		expect(() => new MailDriverMailtrap({ token: '' })).toThrow('"token"');
		expect(() => new MailDriverMailtrap({ token: 't', sandbox: true })).toThrow('"testInboxId"');
		expect(() => new MailDriverMailtrap({ token: 't', sandbox: true, testInboxId: 1, bulk: true })).toThrow('at once');
		expect(defaultExport).toBe(MailDriverMailtrap);
	});

	test('Builds the client for sending, the sandbox and the bulk stream', () => {
		// 1. Plain sending: both flags off
		new MailDriverMailtrap({ token: 't' });

		expect(construct).toHaveBeenLastCalledWith({ token: 't', sandbox: false, bulk: false });

		// 2. Sandbox: the inbox goes along
		new MailDriverMailtrap({ token: 't', sandbox: true, testInboxId: 123 });

		expect(construct).toHaveBeenLastCalledWith({ token: 't', sandbox: true, bulk: false, testInboxId: 123 });

		// 3. Bulk: the marketing stream, so the client gets the bulk host while sandbox stays off
		new MailDriverMailtrap({ token: 't', bulk: true });

		expect(construct).toHaveBeenLastCalledWith({ token: 't', sandbox: false, bulk: true });
	});

	test('Sends and maps the result', async () => {
		// 1. Mailtrap answers a list of message ids; the first one is the message's
		send.mockResolvedValueOnce({ success: true, message_ids: ['0c7fd939-02cf-11ed-88c2-0a58a9feac02'] });

		const driver = new MailDriverMailtrap({ token: 't' });

		const result = await driver.send({
			to: ['Ada <ada@example.com>', 'bob@example.com'],
			from: 'me@acme.test',
			subject: 'S',
			text: 'T',
		});

		// 2. Recipients went out as address objects, the display name of a string form parsed, not dropped
		expect(send).toHaveBeenCalledWith(
			expect.objectContaining({
				to: [{ email: 'ada@example.com', name: 'Ada' }, { email: 'bob@example.com' }],
				subject: 'S',
			}),
		);

		// 3. Every recipient counts as accepted
		expect(result).toStrictEqual({
			messageId: '0c7fd939-02cf-11ed-88c2-0a58a9feac02',
			accepted: ['ada@example.com', 'bob@example.com'],
			rejected: [],
		});
	});

	test('Names the provider in a refusal, keeping the SDK error as the cause', async () => {
		// 1. The SDK's `MailtrapError` is wrapped, not replaced: the cause keeps its list of Mailtrap's errors
		const refusal = new Error("'to' address is required");

		send.mockRejectedValueOnce(refusal);

		const driver = new MailDriverMailtrap({ token: 't' });

		await expect(driver.send({ to: 'a@example.com', from: 'me@acme.test', subject: 'S' })).rejects.toMatchObject({
			message: "Mailtrap: 'to' address is required",
			cause: refusal,
		});
	});

	test('Verifies by listing the accounts of the token', async () => {
		const driver = new MailDriverMailtrap({ token: 't' });

		// 1. At least one account means the token can send
		getAllAccounts.mockResolvedValueOnce([{ id: 1, name: 'Acme' }]);
		await expect(driver.verify()).resolves.toBeUndefined();

		// 2. None means it cannot, even though Mailtrap answered
		getAllAccounts.mockResolvedValueOnce([]);
		await expect(driver.verify()).rejects.toThrow('no account');

		// 3. A refusal is wrapped with the provider's name, the SDK's error as the cause
		getAllAccounts.mockRejectedValueOnce(new Error('Unauthorized'));
		await expect(driver.verify()).rejects.toThrow('Mailtrap: Unauthorized');
	});
});
