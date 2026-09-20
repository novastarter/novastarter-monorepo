/**
 * Tests of the `smtp` and `sendmail` drivers with nodemailer mocked: what transport they build and how they map the
 * message and the result.
 */
import nodemailer from 'nodemailer';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { MailDriverSendmail } from './sendmail.js';
import { MailDriverSmtp } from './smtp.js';

const transporter = {
	sendMail: vi.fn(async () => ({
		messageId: '<id@acme>',
		accepted: ['ada@example.com'],
		rejected: [{ address: 'bob@example.com' }],
		response: '250 OK',
	})),
	verify: vi.fn(async () => true),
};

vi.mock('nodemailer', () => ({ default: { createTransport: vi.fn(() => transporter) } }));

afterEach(() => {
	vi.clearAllMocks();
});

describe('MailDriverSmtp', () => {
	test('Builds the transport from the location options, with auth only when credentials are given', () => {
		// 1. A host alone: port 587, no TLS from the first byte, no auth
		new MailDriverSmtp({ host: 'smtp.example.com' });

		expect(nodemailer.createTransport).toHaveBeenLastCalledWith({
			host: 'smtp.example.com',
			port: 587,
			secure: false,
			ignoreTLS: false,
		});

		// 2. Every option given: credentials become `auth`, the rest passes through under nodemailer's names
		new MailDriverSmtp({
			host: 'smtp.example.com',
			port: 465,
			secure: true,
			user: 'me',
			password: 'secret',
			name: 'acme.test',
			pool: true,
			tls: { rejectUnauthorized: false },
		});

		expect(nodemailer.createTransport).toHaveBeenLastCalledWith({
			host: 'smtp.example.com',
			port: 465,
			secure: true,
			ignoreTLS: false,
			auth: { user: 'me', pass: 'secret' },
			name: 'acme.test',
			pool: true,
			tls: { rejectUnauthorized: false },
		});

		// 3. The error names the option, so the reader knows what to register
		expect(() => new MailDriverSmtp({ host: '' })).toThrow(/"host"/);
	});

	test('Sends the translated message and translates the answer; verify goes to the transport', async () => {
		// 1. Every field of the message is handed to nodemailer under its own name; `tags` has no place there
		const driver = new MailDriverSmtp({ host: 'smtp.example.com' });

		const result = await driver.send({
			to: ['ada@example.com', { name: 'Bob', address: 'bob@example.com' }],
			from: 'no-reply@acme.test',
			replyTo: 'support@acme.test',
			subject: 'Hi',
			text: 'Hello',
			headers: { 'X-Campaign': 'welcome' },
			tags: ['ignored-by-smtp'],
		});

		expect(transporter.sendMail).toHaveBeenCalledWith({
			to: ['ada@example.com', { name: 'Bob', address: 'bob@example.com' }],
			from: 'no-reply@acme.test',
			replyTo: 'support@acme.test',
			subject: 'Hi',
			text: 'Hello',
			headers: { 'X-Campaign': 'welcome' },
		});

		// 2. nodemailer's answer is flattened to addresses
		expect(result).toStrictEqual({
			messageId: '<id@acme>',
			accepted: ['ada@example.com'],
			rejected: ['bob@example.com'],
			response: '250 OK',
		});

		// 3. `verify()` is the transport's handshake, nothing more
		await driver.verify();

		expect(transporter.verify).toHaveBeenCalled();
	});
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
		transporter.sendMail.mockResolvedValueOnce({ messageId: '<x>', envelope: { to: ['ada@example.com'] } } as any);

		const result = await new MailDriverSendmail().send({ to: 'ada@example.com', subject: 'Hi', text: 'x' });

		expect(result).toStrictEqual({
			messageId: '<x>',
			accepted: ['ada@example.com'],
			rejected: [],
			response: undefined,
		});
	});
});
