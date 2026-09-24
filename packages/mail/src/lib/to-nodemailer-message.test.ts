/**
 * Tests of `mail/lib/to-nodemailer-message`: which fields of a message reach nodemailer, and under which names.
 */
import { describe, expect, test } from 'vitest';
import { toNodemailerAddress, toNodemailerMessage } from './to-nodemailer-message.js';

describe('toNodemailerAddress', () => {
	test('Hands both address shapes on untouched', () => {
		// nodemailer formats and encodes both itself; quoting a name here would be quoted twice
		const named = { name: 'Ada', address: 'ada@example.com' };

		expect(toNodemailerAddress('ada@example.com')).toBe('ada@example.com');
		expect(toNodemailerAddress(named)).toBe(named);
	});
});

describe('toNodemailerMessage', () => {
	test('Sets only the fields the message carries', () => {
		expect(toNodemailerMessage({ to: 'ada@example.com', subject: 'Hi' })).toStrictEqual({
			to: 'ada@example.com',
			subject: 'Hi',
		});

		expect(
			toNodemailerMessage({
				to: ['ada@example.com', { name: 'Bob', address: 'bob@example.com' }],
				cc: ['cc@example.com'],
				bcc: [{ name: 'Hidden', address: 'bcc@example.com' }],
				from: { name: 'Acme', address: 'no-reply@acme.test' },
				replyTo: 'support@acme.test',
				subject: 'Hi',
				html: '<p>Hello</p>',
				text: 'Hello',
				headers: { 'X-Campaign': 'welcome' },
				category: 'marketing',
				tags: ['ignored'],
			}),
		).toStrictEqual({
			to: ['ada@example.com', { name: 'Bob', address: 'bob@example.com' }],
			cc: ['cc@example.com'],
			bcc: [{ name: 'Hidden', address: 'bcc@example.com' }],
			from: { name: 'Acme', address: 'no-reply@acme.test' },
			replyTo: 'support@acme.test',
			subject: 'Hi',
			html: '<p>Hello</p>',
			text: 'Hello',
			headers: { 'X-Campaign': 'welcome' },
		});

		expect(toNodemailerMessage({ to: 'ada@example.com', subject: 'Hi', text: '' })).toMatchObject({ text: '' });
	});

	test('Keeps attachments by content or by path, without undefined keys', () => {
		// `path` stays a path: nodemailer reads the file itself when it builds the message
		expect(
			toNodemailerMessage({
				to: 'ada@example.com',
				subject: 'Hi',
				attachments: [
					{ filename: 'a.txt', content: 'inline', contentType: 'text/plain' },
					{ filename: 'logo.png', path: '/tmp/logo.png', cid: 'logo' },
				],
			}).attachments,
		).toStrictEqual([
			{ filename: 'a.txt', content: 'inline', contentType: 'text/plain' },
			{ filename: 'logo.png', path: '/tmp/logo.png', cid: 'logo' },
		]);
	});
});
