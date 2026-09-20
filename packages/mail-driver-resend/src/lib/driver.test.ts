/**
 * Tests of the Resend driver with the SDK mocked.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import defaultExport from '../index.js';
import { MailDriverResend } from './driver.js';
import { toResendEmail, toResendTag } from './to-resend-email.js';

const send = vi.fn();

vi.mock('resend', () => ({
	Resend: class {
		emails = { send };

		constructor(public apiKey: string) {}
	},
}));

afterEach(() => {
	vi.clearAllMocks();
});

describe('toResendEmail', () => {
	test('Maps every field, formats addresses and turns category and tags into Resend tags', () => {
		// 1. Addresses become `Name <address>` strings; attachments pass through with Resend's key names
		expect(
			toResendEmail({
				to: [{ name: 'Ada', address: 'ada@example.com' }, 'bob@example.com'],
				cc: ['cc@example.com'],
				bcc: ['bcc@example.com'],
				from: { name: 'Acme', address: 'no-reply@acme.test' },
				replyTo: 'support@acme.test',
				subject: 'Hi',
				html: '<p>Hi</p>',
				text: 'Hi',
				headers: { 'X-Campaign': 'welcome' },
				attachments: [{ filename: 'logo.png', content: Buffer.from('png'), contentType: 'image/png', cid: 'logo' }],
				category: 'marketing',
				tags: ['welcome flow', 'v2'],
			}),
		).toStrictEqual({
			from: 'Acme <no-reply@acme.test>',
			to: ['Ada <ada@example.com>', 'bob@example.com'],
			cc: ['cc@example.com'],
			bcc: ['bcc@example.com'],
			replyTo: 'support@acme.test',
			subject: 'Hi',
			html: '<p>Hi</p>',
			text: 'Hi',
			headers: { 'X-Campaign': 'welcome' },
			attachments: [{ filename: 'logo.png', content: Buffer.from('png'), contentType: 'image/png', contentId: 'logo' }],
			tags: [
				{ name: 'category', value: 'marketing' },
				{ name: 'welcome_flow', value: '1' },
				{ name: 'v2', value: '1' },
			],
		});

		// 2. Tags are sanitised to Resend's character set; a message without a sender is refused by name
		expect(toResendTag('a b.c/d')).toBe('a_b_c_d');
		expect(() => toResendEmail({ to: 'a@b.c', subject: 'x', text: 'x' })).toThrow(/"from"/);
	});
});

describe('MailDriverResend', () => {
	test('Sends and answers the id, throws on the SDK error value', async () => {
		// 1. A successful send answers the id Resend assigned
		send.mockResolvedValueOnce({ data: { id: 'email-1' }, error: null });

		const driver = new MailDriverResend({ apiKey: 're_test' });
		const message = { to: 'ada@example.com', from: 'no-reply@acme.test', subject: 'Hi', text: 'x' };

		expect(await driver.send(message)).toStrictEqual({
			messageId: 'email-1',
			accepted: ['ada@example.com'],
			rejected: [],
		});

		expect(send).toHaveBeenCalledWith(expect.objectContaining({ from: 'no-reply@acme.test', to: ['ada@example.com'] }));

		// 2. The SDK reports failures as a value; the driver turns them into a throw naming the provider
		send.mockResolvedValueOnce({ data: null, error: { name: 'invalid_from_address', message: 'Verify the domain' } });
		await expect(driver.send(message)).rejects.toThrow('Resend: invalid_from_address: Verify the domain');

		// 3. A missing key is refused by name
		expect(() => new MailDriverResend({ apiKey: '' })).toThrow(/"apiKey"/);
		expect(defaultExport).toBe(MailDriverResend);
	});
});
