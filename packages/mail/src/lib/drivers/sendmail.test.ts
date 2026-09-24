/**
 * Tests of the `sendmail` mail driver with nodemailer mocked: what transport it builds and how it maps the result.
 */
import nodemailer from 'nodemailer';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { MailDriverSendmail } from './sendmail.js';

/**
 * Stand-in for the sendmail transport `createTransport()` hands out: its `sendMail()` is the shared spy, so a test can
 * script nodemailer's answer.
 */
const transporter = {
	sendMail: vi.fn(async () => ({ messageId: '<x>', envelope: { to: ['ada@example.com'] } })),
};

vi.mock('nodemailer', () => ({ default: { createTransport: vi.fn(() => transporter) } }));

afterEach(() => {
	vi.clearAllMocks();
});

describe('MailDriverSendmail', () => {
	test('Builds the sendmail transport with defaults and overrides', () => {
		new MailDriverSendmail();

		expect(nodemailer.createTransport).toHaveBeenLastCalledWith({
			sendmail: true,
			newline: 'unix',
			path: '/usr/sbin/sendmail',
		});

		new MailDriverSendmail({ path: '/usr/bin/msmtp', newLine: 'windows' });

		expect(nodemailer.createTransport).toHaveBeenLastCalledWith({
			sendmail: true,
			newline: 'windows',
			path: '/usr/bin/msmtp',
		});
	});

	test('Takes the envelope as accepted when the transport reports nothing', async () => {
		// sendmail answers no acceptance list; the envelope is all the driver has
		const result = await new MailDriverSendmail().send({ to: 'ada@example.com', subject: 'Hi', text: 'x' });

		expect(result).toStrictEqual({
			messageId: '<x>',
			accepted: ['ada@example.com'],
			rejected: [],
			response: undefined,
		});
	});
});
