/**
 * Tests of the SES driver class with the AWS SDK and nodemailer mocked; the tag mapper has its own suite in
 * `to-ses-message-tags.test.ts`.
 */
import { SESv2ServiceException } from '@aws-sdk/client-sesv2';
import { HitRateLimitError, ProviderCallError } from '@novastarter/errors';
import { TimeoutError } from '@novastarter/utils';
import nodemailer from 'nodemailer';
import { afterEach, describe, expect, test, vi } from 'vitest';
import defaultExport from '../index.js';
import { MailDriverSes } from './driver.js';

/**
 * Spy standing in for the transport's `sendMail()`, shared by every instance so a test can script nodemailer's answer.
 *
 * @internal
 */
const sendMail = vi.fn();

/**
 * Spy recording every `SESv2Client.destroy()`, so a test can check the driver releases the SDK client at shutdown.
 *
 * @internal
 */
const destroy = vi.fn();

/**
 * Spy standing in for `SESv2Client.send()`, the call `call()` makes, shared by every instance.
 *
 * @internal
 */
const send = vi.fn();

vi.mock('nodemailer', () => ({ default: { createTransport: vi.fn(() => ({ sendMail })) } }));

vi.mock('@aws-sdk/client-sesv2', () => {
	/**
	 * Stand-in for the SDK's base command class, the one `call()` checks an export against.
	 */
	class $Command {
		/**
		 * Keep the action's input, so a test can check what the driver passed.
		 *
		 * @param input - The action's input.
		 */
		constructor(public input: unknown) {}
	}

	/**
	 * Stand-in for the SDK's exception base class, with the HTTP status in `$metadata`.
	 */
	class SESv2ServiceException extends Error {
		/**
		 * The response metadata the SDK attaches to a refusal.
		 *
		 * @internal
		 */
		$metadata: { httpStatusCode?: number };

		/**
		 * Build a refusal with its name, message and status.
		 *
		 * @param options - The exception's name, message and metadata.
		 */
		constructor(options: { name: string; message: string; $metadata: { httpStatusCode?: number } }) {
			// 1. Named like the SDK's exceptions, so the driver reads the name the same way
			super(options.message);
			this.name = options.name;
			this.$metadata = options.$metadata;
		}
	}

	return {
		$Command,
		SESv2ServiceException,

		/**
		 * Stand-in for the SDK's `GetAccountCommand`: a real subclass of the base command.
		 */
		GetAccountCommand: class extends $Command {},

		/**
		 * Stand-in for a non-command export that happens to be a class, which `call()` must refuse to run.
		 */
		SomethingCommand: class {},

		/**
		 * Stand-in for the SDK's `SESv2Client`: only the surface the driver touches, with the options kept for inspection.
		 */
		SESv2Client: class {
			/**
			 * Keep the client options instead of opening a connection, so a test can check what the driver built.
			 *
			 * @param config - What the driver passed to the SDK.
			 */
			constructor(public config: unknown) {}

			/**
			 * Record the shutdown on the shared spy.
			 */
			destroy(): void {
				destroy();
			}

			/**
			 * Route the request to the shared spy.
			 *
			 * @param command - The command the driver built.
			 * @param options - The SDK's per-request options, the abort signal among them.
			 * @returns What the spy answers.
			 */
			send(command: unknown, options: unknown): Promise<unknown> {
				// 1. Nothing is sent; the spy scripts SES's answer
				return send(command, options);
			}
		},

		/**
		 * Stand-in for the SDK's `SendEmailCommand`; the driver only hands the class to nodemailer, never calls it.
		 */
		SendEmailCommand: class {},
	};
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('MailDriverSes', () => {
	test('Refuses half a credential pair before building a client', () => {
		// 1. The constructor is where the check lives, so a broken location fails at registration, not on the first send
		expect(() => new MailDriverSes({ accessKeyId: 'AKIA' })).toThrow(
			'The ses mail driver needs "accessKeyId" and "secretAccessKey" together',
		);

		// 2. Either half alone is refused the same way; the SDK chain is never a silent fallback
		expect(() => new MailDriverSes({ secretAccessKey: 'secret' })).toThrow(
			'The ses mail driver needs "accessKeyId" and "secretAccessKey" together',
		);
	});

	test('Builds the SES transport and sends with tags and the configuration set', async () => {
		// 1. The transport is nodemailer's SES one, on a client built from the location options
		sendMail.mockResolvedValueOnce({ messageId: '<ses-1>', envelope: { to: ['ada@example.com'] }, response: '0100…' });

		const driver = new MailDriverSes({ region: 'eu-west-1', configurationSet: 'main' });

		expect(nodemailer.createTransport).toHaveBeenCalledWith({
			SES: expect.objectContaining({ sesClient: expect.objectContaining({ config: { region: 'eu-west-1' } }) }),
		});

		// 2. Category and tags become SES message tags next to the configuration set
		const result = await driver.send({
			to: 'ada@example.com',
			from: 'no-reply@acme.test',
			subject: 'Hi',
			text: 'x',
			category: 'marketing',
			tags: ['welcome'],
		});

		expect(sendMail).toHaveBeenCalledWith({
			to: 'ada@example.com',
			from: 'no-reply@acme.test',
			subject: 'Hi',
			text: 'x',
			ses: {
				EmailTags: [
					{ Name: 'category', Value: 'marketing' },
					{ Name: 'welcome', Value: '1' },
				],
				ConfigurationSetName: 'main',
			},
		});

		// 3. The envelope is what SES reports as accepted
		expect(result).toStrictEqual({
			messageId: '<ses-1>',
			accepted: ['ada@example.com'],
			rejected: [],
			response: '0100…',
		});

		expect(defaultExport).toBe(MailDriverSes);

		// 4. `close()` releases the SDK client's agents; the SES transport holds nothing of its own
		await driver.close();

		expect(destroy).toHaveBeenCalledOnce();
	});

	test('Sanitises tag names to the SES character set and drops one left empty', async () => {
		// 1. A tag with a space or a dot is valid for every other provider; SES would refuse the whole request over it
		sendMail.mockResolvedValueOnce({ messageId: '<ses-2>', envelope: { to: ['ada@example.com'] } });

		const driver = new MailDriverSes();

		await driver.send({
			to: 'ada@example.com',
			from: 'no-reply@acme.test',
			subject: 'Hi',
			text: 'x',
			tags: ['welcome flow', 'v2.1', ''],
		});

		// 2. The names come out sanitised, the empty tag is gone, and no configuration set is named
		expect(sendMail).toHaveBeenCalledWith(
			expect.objectContaining({
				ses: {
					EmailTags: [
						{ Name: 'category', Value: 'transactional' },
						{ Name: 'welcome_flow', Value: '1' },
						{ Name: 'v2_1', Value: '1' },
					],
				},
			}),
		);
	});

	test('Names the provider in a refusal, keeping the error as the cause', async () => {
		// 1. A refusal of the transport or the SDK is wrapped, not replaced: the cause keeps its details
		const refusal = new Error('Message rejected: Email address is not verified.');

		sendMail.mockRejectedValueOnce(refusal);

		const driver = new MailDriverSes();

		await expect(driver.send({ to: 'a@b.c', from: 'x@y.z', subject: 'x', text: 'x' })).rejects.toMatchObject({
			message: 'SES: Message rejected: Email address is not verified.',
			cause: refusal,
		});
	});
});

describe('call', () => {
	test('Runs an action by name, with or without the suffix, and answers its output without $metadata', async () => {
		send.mockResolvedValue({
			$metadata: { httpStatusCode: 200 },
			SendingEnabled: true,
			ProductionAccessEnabled: false,
		});

		const driver = new MailDriverSes({ region: 'eu-west-1' });

		// 1. The command class of the action, built on the input, sent on the location's client with a signal
		await expect(driver.call('GetAccount', { Foo: 1 })).resolves.toStrictEqual({
			status: 200,
			headers: {},
			data: { SendingEnabled: true, ProductionAccessEnabled: false },
		});

		const [command, options] = send.mock.calls[0] as [{ input: unknown; constructor: { name: string } }, unknown];

		expect(command.input).toStrictEqual({ Foo: 1 });
		expect(command.constructor.name).toBe('GetAccountCommand');
		expect(options).toStrictEqual({ abortSignal: expect.any(AbortSignal) });

		// 2. The SDK's own class name works as well; no input means an empty one
		await driver.call('GetAccountCommand');

		expect((send.mock.calls[1]?.[0] as { input: unknown }).input).toStrictEqual({});
	});

	test('Refuses an unknown name or a non-command export before anything is sent', async () => {
		const driver = new MailDriverSes();

		// 1. A typo, a class of the SDK that is not a command, and a malformed name are all refused
		await expect(driver.call('GetAcount')).rejects.toThrow('is not an SESv2 action');
		await expect(driver.call('Something')).rejects.toThrow('is not an SESv2 action');
		await expect(driver.call('GET /v2/email/account')).rejects.toThrow('is not an SESv2 action');

		expect(send).not.toHaveBeenCalled();
	});

	test('Refuses headers before anything is sent, rather than dropping them', async () => {
		const driver = new MailDriverSes();

		// 1. The SDK signs its own request; a header of the call or the location could never reach it
		await expect(driver.call('GetAccount', {}, { headers: { 'x-trace': '1' } })).rejects.toThrow(
			'SES call() sends no extra headers; use the SDK client',
		);

		expect(send).not.toHaveBeenCalled();
	});

	test('Turns a refusal into ProviderCallError without the credentials in the message', async () => {
		const refusal = new SESv2ServiceException({
			name: 'NotFoundException',
			message: 'Email identity not found',
			$metadata: { httpStatusCode: 404 },
			$fault: 'client',
		});

		send.mockRejectedValueOnce(refusal);

		// 1. The status from the metadata, the name and message as the body, the SDK's exception as the cause
		const error = (await new MailDriverSes({ accessKeyId: 'AKIA-ID', secretAccessKey: 'SECRET' })
			.call('GetAccount')
			.catch((caught: unknown) => caught)) as InstanceType<typeof ProviderCallError>;

		expect(error).toBeInstanceOf(ProviderCallError);

		expect(error.extensions).toStrictEqual({
			provider: 'ses',
			method: 'GetAccount',
			status: 404,
			body: { name: 'NotFoundException', message: 'Email identity not found' },
		});

		expect(error.cause).toBe(refusal);
		expect(error.message).toBe('ses refused GetAccount: 404 Email identity not found');

		// 2. The key pair never reaches the message
		expect(error.message).not.toContain('SECRET');
		expect(error.message).not.toContain('AKIA-ID');
	});

	test('Turns throttling into HitRateLimitError, by status or by name', async () => {
		const driver = new MailDriverSes();

		// 1. A 429 status
		send.mockRejectedValueOnce(
			new SESv2ServiceException({
				name: 'LimitExceededException',
				message: 'slow down',
				$metadata: { httpStatusCode: 429 },
				$fault: 'client',
			}),
		);

		await expect(driver.call('GetAccount')).rejects.toBeInstanceOf(HitRateLimitError);

		// 2. SES's throttling exception, whatever its status
		send.mockRejectedValueOnce(
			new SESv2ServiceException({
				name: 'TooManyRequestsException',
				message: 'Too many requests',
				$metadata: { httpStatusCode: 400 },
				$fault: 'client',
			}),
		);

		await expect(driver.call('GetAccount')).rejects.toBeInstanceOf(HitRateLimitError);
	});

	test('Gives up at the timeout and aborts the request; other errors pass through', async () => {
		// 1. A request that only ends when its signal aborts
		send.mockImplementationOnce(
			(_command: unknown, { abortSignal }: { abortSignal: AbortSignal }) =>
				new Promise((_resolve, reject) => abortSignal.addEventListener('abort', () => reject(abortSignal.reason))),
		);

		const driver = new MailDriverSes();

		await expect(driver.call('GetAccount', {}, { timeout: 10 })).rejects.toBeInstanceOf(TimeoutError);
		expect((send.mock.calls[0]?.[1] as { abortSignal: AbortSignal }).abortSignal.aborted).toBe(true);

		// 2. A network failure is not SES refusing: it is thrown as it came
		const failure = new Error('getaddrinfo ENOTFOUND');

		send.mockRejectedValueOnce(failure);

		await expect(driver.call('GetAccount')).rejects.toBe(failure);
	});

	test('Exposes the SDK client the driver sends through', () => {
		// 1. The client is public, for what `call()` does not cover
		const driver = new MailDriverSes({ region: 'eu-west-1' });

		expect(driver.client).toMatchObject({ config: { region: 'eu-west-1' } });
	});
});
