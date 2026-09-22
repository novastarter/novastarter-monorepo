/**
 * Tests of the Vonage driver class with the SDK's `SMS` client replaced; the message mapper and the error
 * description have their own tests in `to-vonage-message.test.ts` and `describe-error.test.ts`.
 */
import { MessageSendAllFailure } from '@vonage/sms';
import { afterEach, describe, expect, test, vi } from 'vitest';
import defaultExport from '../index.js';
import { BALANCE_URL } from './constants.js';
import { SmsDriverVonage } from './driver.js';

const send = vi.fn();
const client = vi.fn();

// Only the client is replaced: `TypeEnum` of the mapper and the error classes of `describeError` stay the real ones
vi.mock('@vonage/sms', async (importOriginal) => {
	const original = await importOriginal<typeof import('@vonage/sms')>();

	/**
	 * Stand-in for the SDK's `SMS` client: exposes `send` as the shared spy and records how it was built.
	 */
	class SMS {
		/**
		 * The send API the driver calls, recorded so the tests can check the parameters it received.
		 */
		send = send;

		/**
		 * Take the credentials and the options the way the real client does.
		 *
		 * @param credentials - The key pair the driver passes.
		 * @param options - The client options the driver passes.
		 */
		constructor(credentials: unknown, options: unknown) {
			client(credentials, options);
		}
	}

	return { ...original, SMS };
});

afterEach(() => {
	vi.clearAllMocks();
	vi.unstubAllGlobals();
});

describe('SmsDriverVonage', () => {
	test('Sends and answers the id, the status, the part count and the balance', async () => {
		// 1. Vonage answers one entry per part of the message, each with the balance left after it
		send.mockResolvedValueOnce({
			messageCount: 2,
			messages: [
				{ to: '14155550123', messageId: 'm-1', status: '0', remainingBalance: '9.50' },
				{ to: '14155550123', messageId: 'm-2', status: '0', remainingBalance: '9.40' },
			],
		});

		const driver = new SmsDriverVonage({ apiKey: 'key', apiSecret: 'secret', timeout: 5_000 });

		expect(await driver.send({ to: '+14155550123', from: 'Acme', text: 'Hi' })).toStrictEqual({
			messageId: 'm-1',
			status: '0',
			segments: 2,
			response: 'balance 9.50',
		});

		expect(send).toHaveBeenCalledWith({ to: '14155550123', from: 'Acme', text: 'Hi', type: 'text' });
		expect(client).toHaveBeenCalledWith({ apiKey: 'key', apiSecret: 'secret' }, { timeout: 5_000 });
		expect(defaultExport).toBe(SmsDriverVonage);
	});

	test('Describes a refused message by Vonage status and wording', async () => {
		// 1. The SDK throws for an answer whose parts all failed; the status is what the application matches on
		send.mockRejectedValueOnce(
			new MessageSendAllFailure({
				messageCount: 1,
				messages: [{ status: '15', errorText: 'Illegal Sender Address - rejected' }],
			} as never),
		);

		const driver = new SmsDriverVonage({ apiKey: 'key', apiSecret: 'secret' });

		await expect(driver.send({ to: '+14155550123', from: 'Acme', text: 'Hi' })).rejects.toThrow(
			'Vonage: 15: Illegal Sender Address - rejected',
		);
	});

	test('Refuses an incomplete credential by the option name', () => {
		expect(() => new SmsDriverVonage({ apiKey: '', apiSecret: 'secret' })).toThrow(/"apiKey"/);
		expect(() => new SmsDriverVonage({ apiKey: 'key', apiSecret: '' })).toThrow(/"apiSecret"/);
	});

	test('Verifies the credentials by reading the account balance', async () => {
		const fetch = vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK' }));

		vi.stubGlobal('fetch', fetch);

		const driver = new SmsDriverVonage({ apiKey: 'key', apiSecret: 'secret' });

		// 1. The credentials travel as query parameters, and nothing is created or billed
		await expect(driver.verify()).resolves.toBeUndefined();
		expect(fetch).toHaveBeenCalledWith(`${BALANCE_URL}?api_key=key&api_secret=secret`);

		// 2. Bad credentials answer 401, which is reported with the status
		fetch.mockResolvedValueOnce({ ok: false, status: 401, statusText: 'Unauthorized' });
		await expect(driver.verify()).rejects.toThrow('Vonage: 401: Unauthorized');

		// 3. A network failure never reached the API and is described as it is
		fetch.mockRejectedValueOnce(new Error('ENOTFOUND'));
		await expect(driver.verify()).rejects.toThrow('Vonage: ENOTFOUND');
	});
});
