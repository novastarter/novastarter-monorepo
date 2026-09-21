/**
 * Tests of the SES driver with the AWS SDK and nodemailer mocked.
 */
import nodemailer from 'nodemailer';
import { afterEach, describe, expect, test, vi } from 'vitest';
import defaultExport from '../index.js';
import { MailDriverSes } from './driver.js';
import { toSesClientConfig } from './to-ses-client-config.js';

const sendMail = vi.fn();
const close = vi.fn();
const destroy = vi.fn();

vi.mock('nodemailer', () => ({ default: { createTransport: vi.fn(() => ({ sendMail, close })) } }));

vi.mock('@aws-sdk/client-sesv2', () => ({
	SESv2Client: class {
		constructor(public config: unknown) {}

		/**
		 * Record the shutdown on the shared spy.
		 */
		destroy(): void {
			destroy();
		}
	},
	SendEmailCommand: class {},
}));

afterEach(() => {
	vi.clearAllMocks();
});

describe('toSesClientConfig', () => {
	test('Passes region and endpoint through and builds credentials only from a full key pair', () => {
		// 1. Nothing given, nothing set: the SDK's default chain decides
		expect(toSesClientConfig({})).toStrictEqual({});

		// 2. Everything given: credentials include the session token
		expect(
			toSesClientConfig({
				region: 'eu-west-1',
				accessKeyId: 'AKIA',
				secretAccessKey: 'secret',
				sessionToken: 'tok',
				endpoint: 'http://localhost:4566',
			}),
		).toStrictEqual({
			region: 'eu-west-1',
			endpoint: 'http://localhost:4566',
			credentials: { accessKeyId: 'AKIA', secretAccessKey: 'secret', sessionToken: 'tok' },
		});
	});

	test('Refuses half a credential pair instead of falling back to the SDK chain', () => {
		expect(() => toSesClientConfig({ accessKeyId: 'AKIA' })).toThrow(
			'The ses mail driver needs "accessKeyId" and "secretAccessKey" together',
		);

		expect(() => toSesClientConfig({ secretAccessKey: 'secret' })).toThrow(
			'The ses mail driver needs "accessKeyId" and "secretAccessKey" together',
		);
	});
});

describe('MailDriverSes', () => {
	test('Refuses half a credential pair before building a client', () => {
		expect(() => new MailDriverSes({ accessKeyId: 'AKIA' })).toThrow(
			'The ses mail driver needs "accessKeyId" and "secretAccessKey" together',
		);

		expect(() => new MailDriverSes({ secretAccessKey: 'secret' })).toThrow(
			'The ses mail driver needs "accessKeyId" and "secretAccessKey" together',
		);
	});

	test('Builds the SES transport and sends with tags and the configuration set', async () => {
		sendMail.mockResolvedValueOnce({ messageId: '<ses-1>', envelope: { to: ['ada@example.com'] }, response: '0100…' });

		// 1. The transport is nodemailer's SES one, on a client built from the location options
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
});
