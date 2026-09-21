/**
 * Tests of the `sendmail` mail driver with nodemailer mocked: what transport it builds and how it maps the result.
 */
import nodemailer from 'nodemailer';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { MailDriverSendmail } from './sendmail.js';

const transporter = {
	sendMail: vi.fn(async () => ({ messageId: '<x>', envelope: { to: ['ada@example.com'] } })),
};

vi.mock('nodemailer', () => ({ default: { createTransport: vi.fn(() => transporter) } }));

afterEach(() => {
	vi.clearAllMocks();
});

describe('MailDriverSendmail', () => {
	test('Builds the sendmail transport with defaults and overrides', () => {
		// 1. No options: the stock Unix binary with Unix line endings
		new MailDriverSendmail();

		expect(nodemailer.createTransport).toHaveBeenLastCalledWith({
			sendmail: true,
			newline: 'unix',
			path: '/usr/sbin/sendmail',
		});

		// 2. Both options override the defaults
		new MailDriverSendmail({ path: '/usr/bin/msmtp', newLine: 'windows' });

		expect(nodemailer.createTransport).toHaveBeenLastCalledWith({
			sendmail: true,
			newline: 'windows',
			path: '/usr/bin/msmtp',
		});
	});

	test('Takes the envelope as accepted when the transport reports nothing', async () => {
		// 1. sendmail answers no acceptance list; the envelope is all the driver has
		const result = await new MailDriverSendmail().send({ to: 'ada@example.com', subject: 'Hi', text: 'x' });

		expect(result).toStrictEqual({
			messageId: '<x>',
			accepted: ['ada@example.com'],
			rejected: [],
			response: undefined,
		});
	});
});
