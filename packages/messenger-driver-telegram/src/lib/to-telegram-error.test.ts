/**
 * Tests of `messenger-driver-telegram/lib/to-telegram-error`.
 */
import { HitRateLimitError, ProviderCallError } from '@novastarter/errors';
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
		const error = toTelegramError('sendMessage', { error_code: 429, parameters: { retry_after: 5 } }, 429);

		expect(error).toBeInstanceOf(HitRateLimitError);

		expect((error as InstanceType<typeof HitRateLimitError>).extensions.reset.getTime()).toBe(
			Date.UTC(2026, 0, 1) + 5_000,
		);
	});

	test('Makes anything else a ProviderCallError with Telegram’s answer, or the HTTP status without one', () => {
		const answer = { ok: false as const, error_code: 400, description: "Bad Request: can't parse entities" };
		const error = toTelegramError('sendMessage', answer, 400);

		expect(error).toBeInstanceOf(ProviderCallError);
		expect(error.message).toBe("telegram refused sendMessage: 400 Bad Request: can't parse entities");

		expect((error as InstanceType<typeof ProviderCallError>).extensions).toEqual({
			provider: 'telegram',
			method: 'sendMessage',
			status: 400,
			body: answer,
		});

		expect(toTelegramError('getMe', {}, 502).message).toBe('telegram refused getMe: 502');
	});
});
