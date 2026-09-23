/**
 * Tests of `messenger-driver-telegram/lib/to-telegram-error`.
 */
import { HitRateLimitError } from '@novastarter/errors';
import { MessengerTargetGoneError } from '@novastarter/messenger';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { toTelegramError } from './to-telegram-error.js';

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(Date.UTC(2026, 0, 1));
});

afterEach(() => {
	vi.useRealTimers();
});

describe('toTelegramError', () => {
	test('Makes a blocked bot or a gone chat a MessengerTargetGoneError', () => {
		// 1. Every 403, and the 400s that mean the chat is gone
		const blocked = toTelegramError(
			'sendMessage',
			{ error_code: 403, description: 'Forbidden: bot was blocked by the user' },
			403,
		);

		expect(blocked).toBeInstanceOf(MessengerTargetGoneError);

		expect((blocked as InstanceType<typeof MessengerTargetGoneError>).extensions.reason).toBe(
			'Forbidden: bot was blocked by the user',
		);

		expect(
			toTelegramError('sendMessage', { error_code: 400, description: 'Bad Request: chat not found' }, 400),
		).toBeInstanceOf(MessengerTargetGoneError);
	});

	test('Makes a 429 a HitRateLimitError reset at retry_after', () => {
		// 1. The wait Telegram names, in seconds
		const error = toTelegramError('sendMessage', { error_code: 429, parameters: { retry_after: 5 } }, 429);

		expect(error).toBeInstanceOf(HitRateLimitError);

		expect((error as InstanceType<typeof HitRateLimitError>).extensions.reset.getTime()).toBe(
			Date.UTC(2026, 0, 1) + 5_000,
		);
	});

	test('Makes anything else an Error with Telegram’s description, or the HTTP status without one', () => {
		// 1. A broken request is told in Telegram's words
		expect(
			toTelegramError('sendMessage', { error_code: 400, description: "Bad Request: can't parse entities" }, 400)
				.message,
		).toBe("Telegram refused sendMessage: Bad Request: can't parse entities");

		// 2. No answer body: the status stands in
		expect(toTelegramError('getMe', {}, 502).message).toBe('Telegram refused getMe: HTTP 502');
	});
});
