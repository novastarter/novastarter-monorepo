/**
 * Tests of `messenger-driver-telegram/lib/to-telegram-request`.
 */
import { describe, expect, test } from 'vitest';
import { toParseMode, toTelegramRequest } from './to-telegram-request.js';

describe('toParseMode', () => {
	test('Maps the formats to Telegram’s parse modes', () => {
		expect(toParseMode('markdown')).toBe('MarkdownV2');
		expect(toParseMode('html')).toBe('HTML');
		expect(toParseMode('text')).toBeUndefined();
		expect(toParseMode(undefined)).toBeUndefined();
	});
});

describe('toTelegramRequest', () => {
	test('Sends text with sendMessage, its format, silence and raw parameters', () => {
		// `raw` comes last, so it can add or override anything
		expect(
			toTelegramRequest({
				to: '42',
				text: '*Paid*',
				format: 'markdown',
				silent: true,
				raw: { message_effect_id: 'e1', disable_notification: false },
			}),
		).toStrictEqual({
			method: 'sendMessage',
			params: {
				chat_id: '42',
				disable_notification: false,
				text: '*Paid*',
				parse_mode: 'MarkdownV2',
				message_effect_id: 'e1',
			},
		});
	});

	test('Uses the default format only when the message names none', () => {
		expect(toTelegramRequest({ to: '42', text: 'x' }, 'html').params['parse_mode']).toBe('HTML');
		expect(toTelegramRequest({ to: '42', text: 'x', format: 'text' }, 'html').params['parse_mode']).toBeUndefined();
	});

	test('Sends one photo with sendPhoto and one document with sendDocument, the text as caption', () => {
		expect(
			toTelegramRequest({
				to: '42',
				text: 'Chart',
				attachments: [{ kind: 'photo', source: 'https://example.com/a.png' }],
			}),
		).toStrictEqual({
			method: 'sendPhoto',
			params: { chat_id: '42', photo: 'https://example.com/a.png', caption: 'Chart' },
		});

		const { method, params } = toTelegramRequest({
			to: '42',
			attachments: [
				{ kind: 'document', source: new Blob(['%PDF'], { type: 'application/pdf' }), filename: 'invoice.pdf' },
			],
		});

		expect(method).toBe('sendDocument');
		expect(params['document']).toBeInstanceOf(File);
		expect((params['document'] as File).name).toBe('invoice.pdf');
		expect((params['document'] as File).type).toBe('application/pdf');
		expect(params).not.toHaveProperty('caption');
	});

	test('Sends several files as an album, files as attach:// parts and the text on the first', () => {
		const file = new File(['png'], 'b.png');

		expect(
			toTelegramRequest({
				to: '42',
				text: 'Two',
				format: 'html',
				attachments: [
					{ kind: 'photo', source: 'https://example.com/a.png' },
					{ kind: 'photo', source: file },
				],
			}),
		).toStrictEqual({
			method: 'sendMediaGroup',
			params: {
				chat_id: '42',
				media: [
					{ type: 'photo', media: 'https://example.com/a.png', caption: 'Two', parse_mode: 'HTML' },
					{ type: 'photo', media: 'attach://file1' },
				],
				file1: file,
			},
		});
	});
});
