/**
 * Tests of `to-vonage-message`: how a message becomes the parameters of Vonage's `sms.send()`, and when the text has
 * to go out as UCS-2.
 */
import { describe, expect, test } from 'vitest';
import { needsUnicode, toVonageMessage } from './to-vonage-message.js';

describe('needsUnicode', () => {
	test('Keeps the GSM alphabet, including its extension characters, in seven bits', () => {
		expect(needsUnicode('Your code is 123456')).toBe(false);
		expect(needsUnicode('Preis: 10€ für Ihre Bestellung — ')).toBe(true);
		expect(needsUnicode('{[~]}^|€')).toBe(false);
		expect(needsUnicode('Grüße, Åke')).toBe(false);
	});

	test('Reports anything outside it, since Vonage does not detect the encoding itself', () => {
		// 1. A Cyrillic or emoji message sent as `text` arrives mangled; one character is enough to force UCS-2
		expect(needsUnicode('Ваш код: 123456')).toBe(true);
		expect(needsUnicode('Done ✅')).toBe(true);
	});
});

describe('toVonageMessage', () => {
	test('Drops the plus of the recipient and names the encoding', () => {
		expect(toVonageMessage({ to: '+14155550123', from: 'Acme', text: 'Hi' })).toStrictEqual({
			to: '14155550123',
			from: 'Acme',
			text: 'Hi',
			type: 'text',
		});

		expect(toVonageMessage({ to: '+79001234567', from: 'Acme', text: 'Ваш код' })).toMatchObject({
			type: 'unicode',
		});
	});

	test('Drops the plus of a numeric sender, keeps an alphanumeric sender id', () => {
		// 1. Vonage refuses a numeric sender carrying a `+` (status 15), so a sender in E.164 loses it like the
		//    recipient does
		expect(toVonageMessage({ to: '+14155550123', from: '+14155550100', text: 'Hi' })).toMatchObject({
			from: '14155550100',
		});

		// 2. An alphanumeric sender id is not a number: the `+` rule does not apply to it and it goes out unchanged
		expect(toVonageMessage({ to: '+14155550123', from: 'Acme', text: 'Hi' })).toMatchObject({ from: 'Acme' });
	});

	test('Turns the ttl into milliseconds and carries the reference over', () => {
		// 1. Ours is in seconds, Vonage's `ttl` in milliseconds
		expect(
			toVonageMessage({ to: '+14155550123', from: 'Acme', text: 'Hi', ttl: 600, reference: 'signup-1' }),
		).toMatchObject({ ttl: 600_000, clientRef: 'signup-1' });
	});

	test('Refuses a message without a sender', () => {
		// 1. Vonage takes the sender per request and has no pool to fall back on
		expect(() => toVonageMessage({ to: '+14155550123', text: 'Hi' })).toThrow(/"from"/);
	});
});
