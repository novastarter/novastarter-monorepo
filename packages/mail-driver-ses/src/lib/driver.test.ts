/**
 * Tests of the SES driver class with the AWS SDK and nodemailer mocked; the tag mapper has its own suite in
 * `to-ses-message-tags.test.ts`.
 */
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
 * Spy standing in for the transport's `close()`, so a test can check the driver releases the transport at shutdown.
 *
 * @internal
 */
const close = vi.fn();

/**
 * Spy recording every `SESv2Client.destroy()`, so a test can check the driver releases the SDK client at shutdown.
 *
 * @internal
 */
const destroy = vi.fn();

vi.mock('nodemailer', () => ({ default: { createTransport: vi.fn(() => ({ sendMail, close })) } }));

vi.mock('@aws-sdk/client-sesv2', () => ({
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
	},

	/**
	 * Stand-in for the SDK's `SendEmailCommand`; the driver only hands the class to nodemailer, never calls it.
	 */
	SendEmailCommand: class {},
}));

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

		// 4. `close()` releases the transport and the SDK client's agents
		await driver.close();

		expect(close).toHaveBeenCalledOnce();
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
});
