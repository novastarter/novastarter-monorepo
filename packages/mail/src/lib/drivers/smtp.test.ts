/**
 * Tests of the `smtp` mail driver with nodemailer mocked: what transport it builds and how it maps the message and
 * the result.
 */
import nodemailer from 'nodemailer';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { MailDriverSmtp } from './smtp.js';

const transporter = {
	sendMail: vi.fn(async () => ({
		messageId: '<id@acme>',
		accepted: ['ada@example.com'],
		rejected: [{ address: 'bob@example.com' }],
		response: '250 OK',
	})),
	verify: vi.fn(async () => true),
	close: vi.fn(),
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

		// 4. `close()` hands the pooled sockets back
		await driver.close();

		expect(transporter.close).toHaveBeenCalledOnce();
	});
});
