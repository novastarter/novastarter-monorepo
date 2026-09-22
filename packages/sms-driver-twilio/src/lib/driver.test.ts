/**
 * Tests of the Twilio driver class with the SDK mocked; the message mapper and the error description have their own
 * tests in `to-twilio-message.test.ts` and `describe-error.test.ts`.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import defaultExport from '../index.js';
import { SmsDriverTwilio } from './driver.js';

const create = vi.fn();
const fetch = vi.fn();

vi.mock('twilio', () => {
	/**
	 * Stand-in for the SDK's `RestException`, so `describeError` recognises a refused request in these tests too.
	 */
	class RestException extends Error {
		/** HTTP status Twilio answered with. */
		status = 400;
		/** Twilio's own error code. */
		code = 21211;
	}

	/**
	 * Stand-in for the `twilio()` factory: hands out a client whose messages and balance APIs are the shared spies,
	 * so each test can script Twilio's answer and inspect the request.
	 */
	const factory = vi.fn(() => ({ messages: { create }, balance: { fetch } }));

	return { default: Object.assign(factory, { RestException }) };
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('SmsDriverTwilio', () => {
	test('Sends and answers the SID, the status and the segment count', async () => {
		// 1. A successful send answers what Twilio queued the message as
		create.mockResolvedValueOnce({ sid: 'SM1', status: 'queued', numSegments: '2', errorCode: null });

		const driver = new SmsDriverTwilio({ accountSid: 'AC1', authToken: 'token' });

		expect(await driver.send({ to: '+14155550123', from: '+14155550100', text: 'Hi' })).toStrictEqual({
			messageId: 'SM1',
			status: 'queued',
			segments: 2,
		});

		expect(create).toHaveBeenCalledWith({ to: '+14155550123', body: 'Hi', from: '+14155550100' });
		expect(defaultExport).toBe(SmsDriverTwilio);
	});

	test('Adds the location messaging service and status callback to a message without a sender', async () => {
		create.mockResolvedValueOnce({ sid: 'SM2', status: 'accepted', numSegments: '1' });

		const driver = new SmsDriverTwilio({
			accountSid: 'AC1',
			authToken: 'token',
			messagingServiceSid: 'MG1',
			statusCallback: 'https://acme.test/hook',
		});

		await driver.send({ to: '+14155550123', text: 'Hi', ttl: 600 });

		// 1. The pool of the messaging service supplies the sender, and the validity period is the message's `ttl`
		expect(create).toHaveBeenCalledWith({
			to: '+14155550123',
			body: 'Hi',
			messagingServiceSid: 'MG1',
			validityPeriod: 600,
			statusCallback: 'https://acme.test/hook',
		});
	});

	test('Throws on a refusal and on a message Twilio accepted but already failed', async () => {
		const driver = new SmsDriverTwilio({ accountSid: 'AC1', authToken: 'token' });
		const message = { to: '+14155550123', from: '+14155550100', text: 'Hi' };

		// 1. A rejected request is described by its status and Twilio's own code, the SDK error kept as the cause
		const refusal = new Error('The "To" number is not a valid phone number.');

		create.mockRejectedValueOnce(refusal);

		await expect(driver.send(message)).rejects.toMatchObject({
			message: 'Twilio: The "To" number is not a valid phone number.',
			cause: refusal,
		});

		// 2. An answer carrying an error code is a failure too, however accepted it looks: the caller must not record
		//    it as sent
		create.mockResolvedValueOnce({
			sid: 'SM3',
			status: 'failed',
			numSegments: '1',
			errorCode: 21610,
			errorMessage: 'Unsubscribed recipient',
		});

		await expect(driver.send(message)).rejects.toThrow('Twilio: 21610: Unsubscribed recipient');
	});

	test('Authenticates with an API key pair when one is given, and refuses half a configuration', async () => {
		const twilio = (await import('twilio')).default;

		// 1. A key pair signs for the account named in the options
		new SmsDriverTwilio({ accountSid: 'AC1', apiKey: 'SK1', apiSecret: 'secret', timeout: 5_000 });

		expect(twilio).toHaveBeenCalledWith('SK1', 'secret', { timeout: 5_000, accountSid: 'AC1' });

		// 2. Without a key pair the account's auth token is the credential
		new SmsDriverTwilio({ accountSid: 'AC1', authToken: 'token' });

		expect(twilio).toHaveBeenLastCalledWith('AC1', 'token', {});

		// 3. Missing or incomplete credentials are refused by the option's name
		expect(() => new SmsDriverTwilio({ accountSid: '', authToken: 'token' })).toThrow(/"accountSid"/);
		expect(() => new SmsDriverTwilio({ accountSid: 'AC1' })).toThrow(/"authToken"/);
		expect(() => new SmsDriverTwilio({ accountSid: 'AC1', apiKey: 'SK1' })).toThrow(/"apiSecret"/);
	});

	test('Verifies the credentials by reading the account balance', async () => {
		const driver = new SmsDriverTwilio({ accountSid: 'AC1', authToken: 'token' });

		// 1. Nothing is sent and nothing is billed; the read either authenticates or throws
		fetch.mockResolvedValueOnce({ balance: '10.00', currency: 'USD' });
		await expect(driver.verify()).resolves.toBeUndefined();

		fetch.mockRejectedValueOnce(new Error('Authenticate'));
		await expect(driver.verify()).rejects.toThrow('Twilio: Authenticate');
	});
});
