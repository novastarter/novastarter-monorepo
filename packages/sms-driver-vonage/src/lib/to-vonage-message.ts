import { InvalidConfigError } from '@novastarter/errors';
import type { SmsMessage } from '@novastarter/sms';
import { type SMSParams, TypeEnum } from '@vonage/sms';
import { GSM_ALPHABET } from './constants.js';

/**
 * Whether a text has to go out as UCS-2 rather than in the GSM 03.38 alphabet.
 *
 * @param text - The body of the message.
 * @returns `true` as soon as one character is outside the seven-bit alphabet.
 * @example
 * ```ts
 * needsUnicode('Your code is 123456');
 * // => false
 *
 * needsUnicode('Ваш код: 123456');
 * // => true
 * ```
 */
export const needsUnicode = (text: string): boolean => {
	// One character outside the table forces the whole message to UCS-2; there is no per-character encoding.
	return [...text].some((character) => !GSM_ALPHABET.has(character));
};

/**
 * Translate a message into the parameters of Vonage's `sms.send()`.
 *
 * @param message - Ours, with the recipient already in E.164 (`sendSms()` normalises it).
 * @returns Vonage's.
 * @throws InvalidConfigError when the message has no sender — Vonage has no account-wide default to fall back on.
 * @example
 * ```ts
 * const answer = await client.send(toVonageMessage(message));
 * ```
 */
export const toVonageMessage = (message: SmsMessage): SMSParams => {
	// Vonage takes the sender per request and has no pool to pick one from, so a message without one cannot be sent.
	if (!message.from) {
		throw new InvalidConfigError({
			reason: 'The vonage sms driver needs a "from" on the message or in the sms routes',
		});
	}

	// Vonage writes numbers without the leading `+`, and expects `ttl` in milliseconds where ours is in seconds. The
	// sender loses its `+` only when it is a number — Vonage refuses a numeric sender carrying one (status 15) — while
	// an alphanumeric sender id is not a number and must go out exactly as the brand wrote it.
	return {
		to: message.to.replace(/^\+/, ''),
		from: message.from.replace(/^\+(?=\d)/, ''),
		text: message.text,
		type: needsUnicode(message.text) ? TypeEnum.UNICODE : TypeEnum.TEXT,
		...(message.ttl !== undefined ? { ttl: message.ttl * 1000 } : {}),
		...(message.reference !== undefined ? { clientRef: message.reference } : {}),
	};
};
